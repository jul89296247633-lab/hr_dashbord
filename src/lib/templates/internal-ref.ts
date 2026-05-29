/**
 * Генератор internal_ref для конфиденциальных вакансий без hh_vacancy_id.
 * Формат: CONF-ГГГГ-NNNN (например CONF-2026-0042).
 *
 * Единственный источник номеров — PostgreSQL sequence conf_vacancy_seq
 * через gen_internal_ref() RPC. nextval() атомарен — коллизии исключены.
 * Sequence инициализирован по MAX существующих internal_ref (миграция
 * 20260529000000_vacancy_request.sql), поэтому пересечения с ранее
 * созданными рефами (template_upload) невозможны.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function generateInternalRef(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.rpc('gen_internal_ref');
  if (error || !data) {
    throw new Error(
      `Не удалось сгенерировать internal_ref: ${error?.message ?? 'пустой ответ RPC'}`,
    );
  }
  return data as string;
}
