'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { KpiBar } from '@/components/cabinet/KpiBar';
import { DatePicker } from '@/components/cabinet/DatePicker';
import { ActivityForm } from '@/components/cabinet/ActivityForm';
import type { CabinetActivity, CabinetPlan } from '@/components/cabinet/types';

export function CabinetClient({
  date,
  editable,
  mangoActive,
  hhActive,
  plan,
  activity: initialActivity,
}: {
  date: string;
  editable: boolean;
  mangoActive: boolean;
  hhActive: boolean;
  plan: CabinetPlan;
  activity: CabinetActivity;
}) {
  const [activity, setActivity] = useState(initialActivity);

  const mangoPending = mangoActive && activity.mango_calls_source === 'pending';
  const hhPending = hhActive && activity.hh_calls_source === 'pending';
  const showCallsAlert = mangoPending || hhPending;

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Кабинет</h1>
        <DatePicker date={date} />
      </div>

      {/* KPI-панель */}
      <Card>
        <CardContent>
          <KpiBar
            callsFact={activity.total_calls}
            callsPlan={plan.calls_per_day}
            mangoCalls={activity.mango_calls_count}
            hhCalls={activity.hh_calls_count}
            interviewsFact={activity.interviews_count}
            interviewsPlan={plan.interviews_per_day}
            offersFact={activity.offers_count}
          />
        </CardContent>
      </Card>

      {/* Предупреждение: звонки ещё не получены */}
      {showCallsAlert && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Данные о звонках ещё не получены</AlertTitle>
          <AlertDescription>
            {mangoPending && hhPending
              ? 'Манго синхронизируется в 20:00, HH — после загрузки CSV. Введите вручную.'
              : mangoPending
                ? 'Звонки из Манго ещё не синхронизированы (обновление в 20:00).'
                : 'Звонки из HH не получены. Введите вручную.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Форма */}
      <Card>
        <CardHeader>
          <CardTitle>Активности за день</CardTitle>
        </CardHeader>
        <CardContent>
          {!editable && (
            <p className="text-muted-foreground mb-4 text-sm">
              Запись доступна только для просмотра (дата старше 30 дней или из будущего).
            </p>
          )}
          <ActivityForm
            key={date}
            date={date}
            editable={editable}
            hhActive={hhActive}
            activity={activity}
            onSaved={setActivity}
          />
        </CardContent>
      </Card>
    </div>
  );
}
