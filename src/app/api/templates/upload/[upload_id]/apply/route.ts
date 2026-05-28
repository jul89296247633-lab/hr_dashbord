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
 * Body: { "skip_errors": true } — ошибочные строки уже исключены при preview.
 *
 * Запись идёт через adminClient (service_role):
 *   • bonus_rates — только service_role может писать (RLS hr_manager_syncs тоже)
 *   • vacancies / staffing_plan — head/admin могут, но adminClient проще единообразно
 *
 * sync_logs пишется с source='sheets' (шаблонный онбординг = разновидность sheets-sync).
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

    // Загружаем запись
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
      // ── 1. vacancies (Data) ────────────────────────────────────────────────
      for (const row of preview.data ?? []) {
        const r = row.record as {
          existing_id: string | null;
          title: string;
          hh_vacancy_id: string | null;
          needs_internal_ref: boolean;
          location: string | null;
          opened_at: string;
          closed_at: string | null;
          status: string;
          confidentiality: string;
          manager_id: string | null;
          subdivision: string | null;
          priority: string | null;
        };

        if (row.action === 'update' && r.existing_id) {
          const { error } = await db
            .from('vacancies')
            .update({
              title: r.title,
              location: r.location,
              opened_at: r.opened_at,
              closed_at: r.closed_at,
              status: r.status,
              confidentiality: r.confidentiality,
              manager_id: r.manager_id,
              subdivision: r.subdivision,
              priority: r.priority,
            })
            .eq('id', r.existing_id);
          if (error) throw new ApiError(500, 'DB_ERROR', `vacancies UPDATE: ${error.message}`);
          totalUpdated++;
        } else {
          // INSERT с retry на 23505 для internal_ref
          let internalRef: string | null = null;
          if (r.needs_internal_ref) {
            internalRef = await generateInternalRef(db);
          }

          let inserted = false;
          for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
            const { error } = await db.from('vacancies').insert({
              title: r.title,
              hh_vacancy_id: r.hh_vacancy_id,
              internal_ref: internalRef,
              location: r.location,
              opened_at: r.opened_at,
              closed_at: r.closed_at,
              status: r.status,
              confidentiality: r.confidentiality,
              manager_id: r.manager_id,
              subdivision: r.subdivision,
              priority: r.priority,
            });
            if (!error) {
              inserted = true;
            } else if (error.code === '23505' && internalRef) {
              internalRef = await generateInternalRef(db);
            } else {
              throw new ApiError(500, 'DB_ERROR', `vacancies INSERT: ${error.message}`);
            }
          }
          if (!inserted) throw new ApiError(500, 'DB_ERROR', 'Не удалось вставить вакансию после 5 попыток (internal_ref conflict)');
          totalInserted++;
        }
      }

      // ── 2. bonus_rates ─────────────────────────────────────────────────────
      for (const row of preview.bonus_rates ?? []) {
        const r = row.record as {
          existing_id: string | null;
          position_name: string;
          amount_kopecks: number;
          group_name: string | null;
        };

        if (row.action === 'update' && r.existing_id) {
          const { error } = await db
            .from('bonus_rates')
            .update({ amount_kopecks: r.amount_kopecks, group_name: r.group_name })
            .eq('id', r.existing_id);
          if (error) throw new ApiError(500, 'DB_ERROR', `bonus_rates UPDATE: ${error.message}`);
          totalUpdated++;
        } else {
          const { error } = await db.from('bonus_rates').insert({
            position_name: r.position_name,
            amount_kopecks: r.amount_kopecks,
            group_name: r.group_name,
          });
          if (error && error.code !== '23505') {
            throw new ApiError(500, 'DB_ERROR', `bonus_rates INSERT: ${error.message}`);
          }
          if (error?.code === '23505') {
            await db
              .from('bonus_rates')
              .update({ amount_kopecks: r.amount_kopecks, group_name: r.group_name })
              .eq('position_name', r.position_name);
            totalUpdated++;
          } else {
            totalInserted++;
          }
        }
      }

      // ── 3. hr_list → hr_manager_syncs + user_profiles ─────────────────────
      for (const row of preview.hr_list ?? []) {
        const r = row.record as {
          existing_sync_id: string | null;
          existing_profile_id: string | null;
          full_name: string;
          email: string;
          role: string;
          hh_manager_id: string | null;
        };

        if (row.action === 'update' && r.existing_sync_id) {
          const { error } = await db
            .from('hr_manager_syncs')
            .update({
              sheet_full_name: r.full_name,
              email_sheet: r.email,
              hh_manager_id: r.hh_manager_id,
              user_profile_id: r.existing_profile_id,
              is_active_sheet: true,
              synced_at: new Date().toISOString(),
            })
            .eq('id', r.existing_sync_id);
          if (error) throw new ApiError(500, 'DB_ERROR', `hr_manager_syncs UPDATE: ${error.message}`);
          totalUpdated++;
        } else {
          const { error } = await db.from('hr_manager_syncs').insert({
            sheet_full_name: r.full_name,
            email_sheet: r.email,
            hh_manager_id: r.hh_manager_id,
            user_profile_id: r.existing_profile_id,
            is_active_sheet: true,
          });
          if (error && error.code !== '23505') {
            throw new ApiError(500, 'DB_ERROR', `hr_manager_syncs INSERT: ${error.message}`);
          }
          if (error?.code === '23505') {
            totalUpdated++;
          } else {
            totalInserted++;
          }
        }

        // Обновляем user_profiles если пользователь найден
        if (r.existing_profile_id) {
          await db
            .from('user_profiles')
            .update({ full_name: r.full_name, role: r.role })
            .eq('id', r.existing_profile_id);
        }
      }

      // ── 4. staffing_plan ───────────────────────────────────────────────────
      for (const row of preview.staffing_plan ?? []) {
        const r = row.record as {
          existing_id: string | null;
          city: string;
          position_name: string;
          planned_units: number;
          comment: string | null;
        };

        if (row.action === 'update' && r.existing_id) {
          const { error } = await db
            .from('staffing_plan')
            .update({ planned_units: r.planned_units, comment: r.comment })
            .eq('id', r.existing_id);
          if (error) throw new ApiError(500, 'DB_ERROR', `staffing_plan UPDATE: ${error.message}`);
          totalUpdated++;
        } else {
          const { error } = await db.from('staffing_plan').insert({
            city: r.city,
            position_name: r.position_name,
            planned_units: r.planned_units,
            comment: r.comment,
            created_by: user.id,
          });
          if (error && error.code !== '23505') {
            throw new ApiError(500, 'DB_ERROR', `staffing_plan INSERT: ${error.message}`);
          }
          if (error?.code === '23505') {
            await db
              .from('staffing_plan')
              .update({ planned_units: r.planned_units, comment: r.comment })
              .eq('city', r.city)
              .eq('position_name', r.position_name);
            totalUpdated++;
          } else {
            totalInserted++;
          }
        }
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
      // Фиксируем провал
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
