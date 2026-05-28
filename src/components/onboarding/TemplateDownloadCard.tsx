'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface TemplateInfo {
  type: string;
  title: string;
  description: string;
}

const TEMPLATES: TemplateInfo[] = [
  {
    type: 'combined',
    title: 'Всё вместе (рекомендуется)',
    description: 'Один файл с четырьмя листами: вакансии, бонусы, HR-список, штатное расписание',
  },
  {
    type: 'data',
    title: 'Вакансии',
    description: 'Лист Data — вакансии с городом, статусом, датами и менеджерами',
  },
  {
    type: 'bonus_rates',
    title: 'Бонусы_HR',
    description: 'Справочник тарифов: должность → сумма бонуса за закрытие',
  },
  {
    type: 'hr_list',
    title: 'Список HR',
    description: 'HR-менеджеры: ФИО, email, роль, HH Manager ID',
  },
  {
    type: 'staffing_plan',
    title: 'Штатное расписание',
    description: 'Плановые единицы по городам и должностям',
  },
];

/**
 * Шаг 1: скачать пустые XLSX-шаблоны.
 * Кнопки открывают GET /api/templates/[type]/download — браузер скачивает файл,
 * cookies отправляются автоматически (same-origin).
 */
export function TemplateDownloadCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Шаг 1 — Скачайте шаблоны</CardTitle>
        <CardDescription>
          Заполните шаблоны данными вашей компании и загрузите обратно на шаге 2.
          Заголовки колонок менять нельзя — система распознаёт их автоматически.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {TEMPLATES.map(({ type, title, description }) => (
          <div key={type} className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-muted-foreground truncate text-xs">{description}</p>
            </div>
            <Button variant="outline" size="sm" asChild className="shrink-0">
              <a href={`/api/templates/${type}/download`} download>
                <Download className="size-4" />
                Скачать
              </a>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
