/**
 * Детектор латинских омоглифов в кириллическом контексте.
 * Омоглиф = латинский символ, визуально неотличимый от кириллического аналога.
 * Пример: 'C' (U+0043 LATIN) выглядит как 'С' (U+0421 CYRILLIC).
 *
 * Стратегия: если строка содержит кириллицу, любой латинский символ из
 * этого набора подозрителен — пользователь мог случайно переключить раскладку.
 * Результат: список человекочитаемых описаний нарушений.
 * Строка с омоглифами → warning, не error (HR решает сам).
 */

const CYRILLIC_RE = /[Ѐ-ӿ]/;

/** Latin → «looks like» Cyrillic (для сообщений об ошибках). */
const HOMOGLYPHS: ReadonlyMap<string, string> = new Map([
  // Uppercase
  ['A', 'А'], ['B', 'В'], ['C', 'С'], ['E', 'Е'], ['H', 'Н'],
  ['I', 'І'], ['K', 'К'], ['M', 'М'], ['O', 'О'], ['P', 'Р'],
  ['T', 'Т'], ['X', 'Х'], ['Y', 'У'],
  // Lowercase
  ['a', 'а'], ['c', 'с'], ['e', 'е'], ['o', 'о'], ['p', 'р'],
  ['x', 'х'], ['y', 'у'],
]);

export interface HomoglyphHit {
  char: string;
  position: number; // 1-based
  looks_like: string;
}

/**
 * Возвращает список найденных омоглифов.
 * Пустой массив = строка чистая (или не содержит кириллицы → не анализируем).
 */
export function detectHomoglyphs(text: string): HomoglyphHit[] {
  if (!text || !CYRILLIC_RE.test(text)) return [];
  const hits: HomoglyphHit[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const looksLike = HOMOGLYPHS.get(ch);
    if (looksLike) {
      hits.push({ char: ch, position: i + 1, looks_like: looksLike });
    }
  }
  return hits;
}

/** Форматирует список хитов в одну строку для error_report. */
export function formatHomoglyphWarning(hits: HomoglyphHit[]): string {
  return hits
    .map((h) => `Латинский '${h.char}' в позиции ${h.position} (похож на '${h.looks_like}')`)
    .join('; ');
}
