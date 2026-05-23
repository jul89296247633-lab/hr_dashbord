import type { CallsSource } from '@/types';

/** Активность дня в формате, который кабинет передаёт на клиент (сериализуемо). */
export interface CabinetActivity {
  mango_calls_count: number | null;
  mango_calls_source: CallsSource;
  hh_calls_count: number | null;
  hh_calls_source: CallsSource;
  interviews_count: number;
  offers_count: number;
  notes: string | null;
  total_calls: number;
  exists: boolean;
}

/** План на день (из manager_plans или дефолт). */
export interface CabinetPlan {
  calls_per_day: number;
  interviews_per_day: number;
}
