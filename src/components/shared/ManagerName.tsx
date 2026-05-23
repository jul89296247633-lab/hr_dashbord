import { cn } from '@/lib/utils';

/**
 * Имя менеджера с бейджем «Уволен», если `is_active === false`.
 * Бизнес-правило (EC-08, уточнение 2026-05-23): уволенных НЕ фильтруем из списков —
 * историческая статистика должна быть видна, но визуально помечаем серым бейджем.
 *
 * `isActive === undefined` (бэкенд не вернул поле) → бейдж не показываем
 * (считаем активным по умолчанию для обратной совместимости).
 */
export function ManagerName({
  name,
  isActive,
  className,
}: {
  name: string | null | undefined;
  isActive?: boolean | null;
  className?: string;
}) {
  if (!name) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {name}
      {isActive === false && (
        <span
          className="bg-muted text-muted-foreground inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium"
          title="Менеджер деактивирован (уволен). Историческая статистика сохраняется."
        >
          Уволен
        </span>
      )}
    </span>
  );
}
