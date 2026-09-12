import { requirePageAbility } from '@/lib/require-page-ability';

export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requirePageAbility('crews.read');
  return <>{children}</>;
}
