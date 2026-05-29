import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiSuccess,
  apiError,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateInternalRef } from '@/lib/templates/internal-ref';
import { uuidSchema } from '@/lib/validations';
import type { DiffRow } from '@/lib/templates/diff-builder';

/**
 * POST /api/templates/upload/[upload_id]/apply
 * Применяет превью к БД. Авторизация: head | admin.
 *
 * Условие: status='previewed'. Иначе 409 UPLOAD_EXPIRED.
 *
 * Транзакционность (ревью must-fix):
 *   INSERT'ы собираются в массивы и выполняются одним вызовом per-table.
 *   Supabase/Postgres выполняет INSERT(array) атомарно — если одна строка
 *   в батче падает, весь батч откатывается. UPDATE'ы — по одному (по id).
 *   Между таблицами транзакция не гарантирована: ошибка в bonus_rates
 *   не откатывает уже залитые vacancies. Для полной XA-транзакции нужен RPC.
 *
 * 23505 retry (ревью should-fix):
 *   Если batch INSERT вакансий падает с 23505 — проверяем что это именно
 *   internal_ref (по тексту ошибки), а не hh_vacancy_id или другой constraint.
 *   Только тогда перегенерируем все internal_ref в батче и повторяем.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ upload_id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const { upload_id } = await params;
    if (!uuidSchema.safeParse(upload_id).success) {
      return apiError('UPLOAD_NOT_FOUND', 'Загрузка не найдена', 404);
    }

    const supabase = await createClient();
    const db = createAdminClient();

    const { data: upload, error: fetchError } = await supabase
      .from('template_uploads')
      .select('id, status, preview_data, template_type')
      .eq('id', upload_id)
      .single();

    if (fetchError || !upload) {
      return apiError('UPLOAD_NOT_FOUND', 'Загрузка не найдена', 404);
    }
    if (upload.status !== 'previewed') {
      return apiError('UPLOAD_EXPIRED', 'Превью устарело или уже применено. Загрузите файл заново.', 409);
    }

    const preview = (upload.preview_data ?? {}) as {
      data?: DiffRow[];
      bonus_rates?: DiffRow[];
      hr_list?: DiffRow[];
      staffing_plan?: DiffRow[];
    };

    // Открываем sync_log
    const { data: syncLog } = await db
      .from('sync_logs')
      .insert({ source: 'sheets', status: 'running', triggered_by: user.id })
      .select('id, started_at')
      .single();

    let totalInserted = 0;
    let totalUpdated = 0;

    try {
      // ── Типы записей ────────────────────────────────────────────────────────
      type VacancyRec = {
        existing_id: string | null;
        title: string;
        hh_vacancy_id: string | null;
        needs_internal_ref: boolean;
        location: string | null;
        opened_at: string;
        closed_at: string | null;
        status: string;
        confidentiality: 'open' | 'confidential';
        manager_id: string | null;
        subdivision: string | null;
        priority: string | null;
      };
      type BonusRec = {
        existing_id: string | null;
        position_name: string;
        amount_kopecks: number;
        group_name: string | null;
      };
      type HrRec = {
        existing_sync_id: string | null;
        existing_profile_id: string | null;
        full_name: string;
        email: string;
        role: string;
        hh_manager_id: string | null;
      };
      type StaffingRec = {
        existing_id: string | null;
        city: string;
        position_name: string;
        planned_units: number;
        occupied_units: number;
        comment: string | null;
      };

      // ── 1. vacancies ────────────────────────────────────────────────────────
      // Pre-pass: generate all internal_refs, split into inserts/updates.
      type VacancyInsertPayload = {
        title: string;
        hh_vacancy_id: string | null;
        internal_ref: string | null;
        location: string | null;
        opened_at: string;
        closed_at: string | null;
        status: string;
        confidentiality: 'open' | 'confidential';
        manager_id: string | null;
        subdivision: string | null;
        priority: string | null;
      };
      const vacancyInserts: VacancyInsertPayload[] = [];
      const vacancyUpdates: { id: string; payload: Omit<VacancyInsertPayload, 'hh_vacancy_id' | 'internal_ref'> }[] = [];

      for (const row of preview.data ?? []) {
        const r = row.record as VacancyRec;
        if (row.action === 'update' && r.existing_id) {
          vacancyUpdates.push({
            id: r.existing_id,
            payload: {
              title: r.title,
              location: r.location,
              opened_at: r.opened_at,
              closed_at: r.closed_at,
              status: r.status,
              confidentiality: r.confidentiality,
              manager_id: r.manager_id,
              subdivision: r.subdivision,
              priority: r.priority,
            },
          });
        } else {
          vacancyInserts.push({
            title: r.title,
            hh_vacancy_id: r.hh_vacancy_id,
            internal_ref: r.needs_internal_ref ? await generateInternalRef(db) : null,
            location: r.location,
            opened_at: r.opened_at,
            closed_at: r.closed_at,
            status: r.status,
            confidentiality: r.confidentiality,
            manager_id: r.manager_id,
            subdivision: r.subdivision,
            priority: r.priority,
          });
        }
      }

      // Batch INSERT vacancies — атомарен на уровне Postgres.
      // Retry только при 23505 на internal_ref (не на hh_vacancy_id и др.).
      if (vacancyInserts.length > 0) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const { error } = await db.from('vacancies').insert(vacancyInserts);
          if (!error) { totalInserted += vacancyInserts.length; break; }

          const isRefConflict =
            error.code === '23505' &&
            (error.message.includes('internal_ref') ||
              (error.details ?? '').includes('internal_ref'));

          if (!isRefConflict || attempt === 4) {
            throw new ApiError(500, 'DB_ERROR', `vacancies batch INSERT: ${error.message}`);
          }
          // Перегенерируем internal_ref для всех строк в батче
          for (const rec of vacancyInserts) {
            if (rec.internal_ref !== null) {
              rec.internal_ref = await generateInternalRef(db);
            }
          }
        }
      }

      for (const { id, payload } of vacancyUpdates) {
        const { error } = await db.from('vacancies').update(payload).eq('id', id);
        if (error) throw new ApiError(500, 'DB_ERROR', `vacancies UPDATE: ${error.message}`);
        totalUpdated++;
      }

      // ── 2. bonus_rates ─────────────────────────────────────────────────────
      const bonusInserts: { position_name: string; amount_kopecks: number; group_name: string | null }[] = [];
      const bonusUpdates: { id: string; amount_kopecks: number; group_name: string | null }[] = [];

      for (const row of preview.bonus_rates ?? []) {
        const r = row.record as BonusRec;
        if (row.action === 'update' && r.existing_id) {
          bonusUpdates.push({ id: r.existing_id, amount_kopecks: r.amount_kopecks, group_name: r.group_name });
        } else {
          bonusInserts.push({ position_name: r.position_name, amount_kopecks: r.amount_kopecks, group_name: r.group_name });
        }
      }

      if (bonusInserts.length > 0) {
        const { error } = await db.from('bonus_rates').insert(bonusInserts);
        if (error) throw new ApiError(500, 'DB_ERROR', `bonus_rates batch INSERT: ${error.message}`);
        totalInserted += bonusInserts.length;
      }
      for (const { id, amount_kopecks, group_name } of bonusUpdates) {
        const { error } = await db.from('bonus_rates').update({ amount_kopecks, group_name }).eq('id', id);
        if (error) throw new ApiError(500, 'DB_ERROR', `bonus_rates UPDATE: ${error.message}`);
        totalUpdated++;
      }

      // ── 3. hr_list → hr_manager_syncs + user_profiles ─────────────────────
      const hrInserts: { sheet_full_name: string; email_sheet: string; hh_manager_id: string | null; user_profile_id: string | null; is_active_sheet: boolean }[] = [];
      const hrUpdates: { id: string; sheet_full_name: string; email_sheet: string; hh_manager_id: string | null; user_profile_id: string | null }[] = [];
      const profileUpdates: { id: string; full_name: string; role: string }[] = [];

      for (const row of preview.hr_list ?? []) {
        const r = row.record as HrRec;
        if (row.action === 'update' && r.existing_sync_id) {
          hrUpdates.push({
            id: r.existing_sync_id,
            sheet_full_name: r.full_name,
            email_sheet: r.email,
            hh_manager_id: r.hh_manager_id,
            user_profile_id: r.existing_profile_id,
          });
        } else {
          hrInserts.push({
            sheet_full_name: r.full_name,
            email_sheet: r.email,
            hh_manager_id: r.hh_manager_id,
            user_profile_id: r.existing_profile_id,
            is_active_sheet: true,
          });
        }
        if (r.existing_profile_id) {
          profileUpdates.push({ id: r.existing_profile_id, full_name: r.full_name, role: r.role });
        }
      }

      if (hrInserts.length > 0) {
        const seenHhIds = new Set<string>();
        const dedupedInserts = hrInserts.filter((r) => {
          if (!r.hh_manager_id) return true;
          if (seenHhIds.has(r.hh_manager_id)) return false;
          seenHhIds.add(r.hh_manager_id);
          return true;
        });
        const { error } = await db.from('hr_manager_syncs').insert(dedupedInserts);
        if (error) throw new ApiError(500, 'DB_ERROR', `hr_manager_syncs batch INSERT: ${error.message}`);
        totalInserted += dedupedInserts.length;
      }
      for (const { id, ...payload } of hrUpdates) {
        const { error } = await db
          .from('hr_manager_syncs')
          .update({ ...payload, is_active_sheet: true, synced_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw new ApiError(500, 'DB_ERROR', `hr_manager_syncs UPDATE: ${error.message}`);
        totalUpdated++;
      }
      for (const { id, full_name, role } of profileUpdates) {
        await db.from('user_profiles').update({ full_name, role }).eq('id', id);
      }

      // ── 4. staffing_plan ───────────────────────────────────────────────────
      const staffingInserts: { city: string; position_name: string; planned_units: number; occupied_units: number; comment: string | null; created_by: string }[] = [];
      const staffingUpdates: { id: string; planned_units: number; occupied_units: number; comment: string | null }[] = [];

      for (const row of preview.staffing_plan ?? []) {
        const r = row.record as StaffingRec;
        if (row.action === 'update' && r.existing_id) {
          staffingUpdates.push({ id: r.existing_id, planned_units: r.planned_units, occupied_units: r.occupied_units, comment: r.comment });
        } else {
          staffingInserts.push({
            city: r.city,
            position_name: r.position_name,
            planned_units: r.planned_units,
            occupied_units: r.occupied_units,
            comment: r.comment,
            created_by: user.id,
          });
        }
      }

      if (staffingInserts.length > 0) {
        const { error } = await db.from('staffing_plan').insert(staffingInserts);
        if (error) throw new ApiError(500, 'DB_ERROR', `staffing_plan batch INSERT: ${error.message}`);
        totalInserted += staffingInserts.length;
      }
      for (const { id, planned_units, occupied_units, comment } of staffingUpdates) {
        const { error } = await db.from('staffing_plan').update({ planned_units, occupied_units, comment }).eq('id', id);
        if (error) throw new ApiError(500, 'DB_ERROR', `staffing_plan UPDATE: ${error.message}`);
        totalUpdated++;
      }

      // ── Успешно применено ─────────────────────────────────────────────────
      const finishedAt = new Date().toISOString();

      await supabase
        .from('template_uploads')
        .update({ status: 'applied', rows_inserted: totalInserted, rows_updated: totalUpdated })
        .eq('id', upload_id);

      if (syncLog) {
        await db
          .from('sync_logs')
          .update({
            status: 'ok',
            records_total: totalInserted + totalUpdated,
            records_updated: totalUpdated,
            finished_at: finishedAt,
          })
          .eq('id', syncLog.id);
      }

      return apiSuccess({
        data: {
          applied: true,
          inserted: totalInserted,
          updated: totalUpdated,
          sync_log_id: syncLog?.id ?? null,
        },
      });
    } catch (err) {
      await supabase
        .from('template_uploads')
        .update({ status: 'failed' })
        .eq('id', upload_id);

      if (syncLog) {
        await db
          .from('sync_logs')
          .update({
            status: 'error',
            error_code: 'TEMPLATE_APPLY_ERROR',
            error_message: err instanceof Error ? err.message.slice(0, 1000) : 'Unknown error',
            finished_at: new Date().toISOString(),
          })
          .eq('id', syncLog.id);
      }

      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
