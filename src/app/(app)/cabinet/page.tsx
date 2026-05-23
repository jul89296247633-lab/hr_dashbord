import { CabinetView } from '@/components/cabinet/CabinetView';

/** Кабинет на сегодня (US-001). */
export default function CabinetPage() {
  const today = new Date().toISOString().slice(0, 10);
  return <CabinetView date={today} />;
}
