import { vi } from 'vitest';

/**
 * Создаёт chainable mock Supabase query builder.
 * Все методы цепочки возвращают сам builder.
 * При await возвращает finalResult.
 */
export function makeQueryBuilder(
  finalResult: { data?: unknown; count?: number | null; error?: unknown } = {},
) {
  const resolved = {
    data: finalResult.data ?? null,
    count: finalResult.count ?? null,
    error: finalResult.error ?? null,
  };

  // Proxy: любой вызов метода возвращает builder; await → finalResult
  const builder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(resolved),
    maybeSingle: vi.fn().mockResolvedValue(resolved),
    // Для прямого await (select без single)
    then: (resolve: (v: unknown) => void) =>
      Promise.resolve(resolved).then(resolve),
  };

  // Методы цепочки тоже возвращают builder
  for (const key of ['select', 'eq', 'neq', 'order', 'range', 'limit', 'ilike', 'insert', 'update', 'delete']) {
    (builder[key] as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  }

  return builder;
}

/** Создаёт mock Supabase client с одним result для всех from()-вызовов. */
export function makeSupabaseClient(
  result: { data?: unknown; count?: number | null; error?: unknown } = {},
) {
  const qb = makeQueryBuilder(result);
  return { from: vi.fn().mockReturnValue(qb) };
}

/** Создаёт mock с разными результатами по имени таблицы. */
export function makeSupabaseMulti(
  results: Record<string, { data?: unknown; count?: number | null; error?: unknown }>,
) {
  return {
    from: vi.fn().mockImplementation((table: string) =>
      makeQueryBuilder(results[table] ?? {}),
    ),
  };
}
