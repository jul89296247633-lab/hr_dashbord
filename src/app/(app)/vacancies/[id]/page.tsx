import { VacancyDetailView } from '@/components/vacancies/VacancyDetailView';

/** Воронка по вакансии (US-002). */
export default async function VacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VacancyDetailView id={id} />;
}
