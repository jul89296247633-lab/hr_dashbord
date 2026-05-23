---
description: Правила UI/UX — компоненты, состояния, стили
globs: ["app/**/*.tsx", "components/**/*.tsx"]
---

# UI Rules

## Три обязательных состояния — ВСЕГДА

Каждая страница и компонент с данными должны иметь:

```tsx
// 1. Loading
if (isLoading) return <SkeletonLayout />;

// 2. Empty
if (!data?.length) return (
  <div className="flex flex-col items-center gap-4 py-16 text-muted-foreground">
    <Inbox size={48} className="opacity-40" />
    <p className="text-sm">Данных нет</p>
    {canCreate && <Button onClick={handleCreate}>Добавить</Button>}
  </div>
);

// 3. Error — через toast или Alert, не белый экран
```

## Цветовая схема — строго по SPEC

```tsx
// KPI статус менеджера (средний % трёх KPI)
const STATUS_STYLES = {
  on_track: 'bg-green-100 text-green-800',   // ≥90%
  behind:   'bg-yellow-100 text-yellow-800', // 70–89%
  critical: 'bg-red-100 text-red-800',       // <70%
  no_plan:  'bg-gray-100 text-gray-600',     // нет плана
};

// Укомплектованность (большое число)
// ≥80% → text-green-600 | 60–79% → text-yellow-600 | <60% → text-red-600

// ИВ менеджера
// ≥85 → зелёный | 70–84 → жёлтый | <70 → красный

// Severity аномалий
// high → red | medium → yellow | low → gray
```

## shadcn/ui — только через компоненты, не raw HTML

```tsx
// ✅
<Button variant="outline" size="sm"><RefreshCw size={14} /> Обновить</Button>
<Badge variant="secondary">На стажировке</Badge>

// ❌
<button className="border rounded px-3 py-1">Обновить</button>
```

## Toast — sonner, не браузерный alert

```tsx
import { toast } from 'sonner';
toast.success('Данные сохранены');
toast.error('Ошибка синхронизации. Попробуйте позже.');
```

## Таблицы — горизонтальный скролл на mobile

```tsx
<div className="overflow-x-auto">
  <Table>...</Table>
</div>
```

## Формы — disabled кнопки во время отправки

```tsx
const [isSubmitting, setIsSubmitting] = useState(false);
// ...
<Button disabled={isSubmitting}>
  {isSubmitting ? <><Loader2 size={14} className="animate-spin mr-2" /> Сохранение…</> : 'Сохранить'}
</Button>
```

## Иконки — только Lucide React

```tsx
import { Phone, Users, UserCheck, Briefcase, Star, Sparkles,
         RefreshCw, Download, Pencil, Save, AlertTriangle,
         TrendingUp, TrendingDown, Inbox, Loader2, Check, X,
         Clock, Building2, GraduationCap, Zap, Globe, Bot } from 'lucide-react';
// Размер по умолчанию: size={16} для inline, size={20} для кнопок, size={48} для empty state
```

## Responsive — mobile-first breakpoints

```tsx
// KPI карточки
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

// Таблицы на мобиле — скролл, не collapse
<div className="overflow-x-auto rounded-md border">
  <Table>...</Table>
</div>
```

## Даты — всегда форматируй для RU локали

```tsx
// Отображение: DD.MM.YYYY
const displayDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU');

// Отображение с временем: DD.MM.YYYY HH:MM
const displayDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
```

## react-markdown — для AI-отчётов

```tsx
import ReactMarkdown from 'react-markdown';
<div className="prose prose-sm max-w-none">
  <ReactMarkdown>{insight.body_md}</ReactMarkdown>
</div>
```

## Светлая тема — не добавляй dark mode

Проект использует только светлую тему. Не добавляй `dark:` классы.
