'use client';
import { useAbility } from '@/lib/use-ability';
import { OpsHistoryList, useEntityHistory } from '@/components/piling/ops-shell';

type Props = { scope: string; targetId: string; title: string };
export function PermittedEntityHistory(props: Props) {
  const mayRead = useAbility('system.read');
  return mayRead ? <EntityHistory {...props} /> : <p className="text-xs text-muted-foreground">Журнал изменений доступен администратору и диспетчеру.</p>;
}
function EntityHistory({ scope, targetId, title }: Props) {
  const history = useEntityHistory(scope, targetId);
  return <OpsHistoryList entries={history.entries} loading={history.loading} error={history.error} title={title} />;
}
