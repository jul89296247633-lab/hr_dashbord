/**
 * Генератор internal_ref для конфиденциальных вакансий без hh_vacancy_id.
 * Формат: CONF-ГГГГ-NNNN (например CONF-2026-0042).
 *
 * Retry на UNIQUE violation (23505): при гонке двух одновременных apply
 * один получит конфликт и сгенерирует следующий номер.
 * Максимум MAX_RETRIES попыток, после чего выбрасывает ошибку.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_RETRIES = 10;

export async function generateInternalRef(supabase: SupabaseClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CONF-${year}-`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Считаем сколько CONF-ГГГГ-* уже в БД → следующий номер
    const { count } = await supabase
      .from('vacancies')
      .select('*', { count: 'exact', head: true })
      .like('internal_ref', `${prefix}%`);

    const seq = String((count ?? 0) + 1 + attempt).padStart(4, '0');
    const ref = `${prefix}${seq}`;

    // Проверяем, что этот конкретный ref ещё не занят
    const { data: existing } = await supabase
      .from('vacancies')
      .select('id')
      .eq('internal_ref', ref)
      .maybeSingle();

    if (!existing) return ref;
    // Уже занят — цикл повторит с attempt+1 (seq+1)
  }

  throw new Error(`Не удалось сгенерировать internal_ref после ${MAX_RETRIES} попыток`);
}
