import { CabinetView } from '@/components/cabinet/CabinetView';

/** Кабинет за конкретную дату YYYY-MM-DD (US-001). */
export default async function CabinetDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return <CabinetView date={date} />;
}
