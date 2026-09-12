import { requirePageAbility } from '@/lib/require-page-ability';

export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requirePageAbility('reports.read_all');
  return <>{children}</>;
}
