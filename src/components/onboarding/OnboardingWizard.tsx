'use client';

import { useState } from 'react';
import { CheckCircle2, Rocket } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TemplateDownloadCard } from '@/components/onboarding/TemplateDownloadCard';
import { TemplateUploadZone } from '@/components/onboarding/TemplateUploadZone';
import { DiffPreviewTable } from '@/components/onboarding/DiffPreviewTable';
import type { UploadPreviewResult } from '@/components/onboarding/TemplateUploadZone';

type WizardStep = 'prepare' | 'preview' | 'done';

const STEP_LABELS: Record<WizardStep, string> = {
  prepare: 'Подготовка',
  preview: 'Просмотр',
  done: 'Готово',
};
const STEP_ORDER: WizardStep[] = ['prepare', 'preview', 'done'];

/**
 * Мастер онбординга компании через XLSX-шаблоны.
 * FEATURE_SPEC_template_upload.md §4.
 *
 * Шаги:
 *   1. prepare — скачать шаблоны + загрузить заполненный файл.
 *   2. preview — просмотреть diff и подтвердить запись в БД.
 *   3. done    — успех.
 */
export function OnboardingWizard() {
  const [step, setStep] = useState<WizardStep>('prepare');
  const [previewResult, setPreviewResult] = useState<UploadPreviewResult | null>(null);
  const [appliedCounts, setAppliedCounts] = useState<{ inserted: number; updated: number } | null>(null);

  function handlePreviewReady(result: UploadPreviewResult) {
    setPreviewResult(result);
    setStep('preview');
  }

  function handleApplied(inserted: number, updated: number) {
    setAppliedCounts({ inserted, updated });
    setStep('done');
  }

  function handleReset() {
    setPreviewResult(null);
    setStep('prepare');
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      {/* Заголовок страницы */}
      <div className="flex items-center gap-3">
        <Rocket className="text-primary size-6" />
        <div>
          <h1 className="text-2xl font-semibold">Запуск компании</h1>
          <p className="text-muted-foreground text-sm">
            Загрузите данные через XLSX-шаблоны — один раз при запуске системы
          </p>
        </div>
      </div>

      {/* Индикатор шагов */}
      <div className="flex items-center gap-2 text-sm">
        {STEP_ORDER.map((s, idx) => {
          const pos = STEP_ORDER.indexOf(step);
          const isPast = idx < pos;
          const isCurrent = s === step;
          return (
            <div key={s} className="flex items-center gap-2">
              {idx > 0 && <div className={`h-px w-8 ${isPast ? 'bg-primary' : 'bg-border'}`} />}
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : isPast
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {isPast ? <CheckCircle2 className="size-4" /> : idx + 1}
              </div>
              <span
                className={
                  isCurrent
                    ? 'font-medium'
                    : isPast
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground'
                }
              >
                {STEP_LABELS[s]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Контент по шагу */}
      {step === 'prepare' && (
        <>
          <TemplateDownloadCard />
          <TemplateUploadZone onPreviewReady={handlePreviewReady} />
        </>
      )}

      {step === 'preview' && previewResult && (
        <DiffPreviewTable
          result={previewResult}
          onApplied={handleApplied}
          onReset={handleReset}
        />
      )}

      {step === 'done' && appliedCounts && (
        <div className="flex flex-col items-center gap-4 rounded-lg border py-16 text-center">
          <CheckCircle2 className="size-12 text-green-600" />
          <div>
            <p className="text-xl font-semibold">Данные успешно загружены!</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Добавлено: {appliedCounts.inserted} · Обновлено: {appliedCounts.updated}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleReset}>
              Загрузить ещё
            </Button>
            <Button asChild>
              <a href="/dashboard">Перейти к дашборду</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
