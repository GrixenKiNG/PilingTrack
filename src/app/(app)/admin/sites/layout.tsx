import { requirePageAbility } from '@/lib/require-page-ability';

export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requirePageAbility('sites.read_all');
  return <>{children}</>;
}
