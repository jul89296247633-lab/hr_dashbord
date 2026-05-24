import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Авто-создание менеджеров (`auth.users` + `user_profiles`) при синхронизации.
 *
 * Используется в:
 *   - `/api/sync/sheets` (листы «HR_менеджеры» и «Data» — колонка «Менеджеры»)
 *   - `/api/sync/hh-csv?type=politeness_managers` (ФИО из HH-отчёта)
 *
 * Идемпотентно: сначала ищем существующий профиль по обоим email-кандидатам
 * (sheetEmail + детерминированный fallback `<translit(name)>@hr.local`),
 * только потом зовём `admin.createUser`. `user_profiles` материализуется
 * триггером `handle_new_user` из `user_metadata`.
 *
 * SPEC §5.6 / §1 (раздел про автосоздание учётных записей).
 */

const RU_TO_EN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
};

/** Простая транслитерация ФИО кириллица→латиница для генерации fallback-email. */
export function transliterate(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => RU_TO_EN[ch] ?? ch)
    .join('');
}

/** «Иванов Иван Иванович» → «ivanov.ivan.ivanovich@hr.local». */
export function emailFromName(name: string): string {
  const slug = transliterate(name)
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${slug || 'user'}@hr.local`;
}

export interface ProvisionResult {
  /** id из user_profiles (= auth.users.id). null — если createUser упал. */
  userProfileId: string | null;
  /** true — если был вызван createUser (новый юзер). false — нашли существующий. */
  created: boolean;
  /** email, под которым лежит/создан профиль. */
  email: string;
}

/**
 * Возвращает `user_profile_id` для менеджера по ФИО.
 *
 * Алгоритм:
 *   1. Кандидаты email = unique([sheetEmail.toLowerCase(), emailFromName(name)]).
 *   2. Для каждого — lookup `user_profiles.email ILIKE candidate` (регистронезависимо).
 *   3. Если ни один не нашёлся — `auth.admin.createUser({ email, password=randomUUID,
 *      email_confirm: true, user_metadata: { full_name: name, role: 'manager' } })`.
 *   4. Триггер `handle_new_user` создаст соответствующий `user_profiles` ряд.
 */
export async function provisionManager(
  db: ReturnType<typeof createAdminClient>,
  name: string,
  sheetEmail?: string | null,
): Promise<ProvisionResult> {
  const fallbackEmail = emailFromName(name);
  const candidates = Array.from(
    new Set(
      [sheetEmail?.toLowerCase(), fallbackEmail].filter((e): e is string => Boolean(e)),
    ),
  );

  for (const candidate of candidates) {
    const { data: existing } = await db
      .from('user_profiles')
      .select('id')
      .ilike('email', candidate)
      .maybeSingle();
    if (existing?.id) {
      return { userProfileId: existing.id, created: false, email: candidate };
    }
  }

  const createEmail = (sheetEmail || fallbackEmail).toLowerCase();
  const { data: created, error } = await db.auth.admin.createUser({
    email: createEmail,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: name, role: 'manager' },
  });
  if (error || !created?.user?.id) {
    return { userProfileId: null, created: false, email: createEmail };
  }
  return { userProfileId: created.user.id, created: true, email: createEmail };
}
