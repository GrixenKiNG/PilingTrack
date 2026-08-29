import {Button} from '@/components/ui/button';
import {PilingIcon} from '@/components/piling/icons/piling-icon';
import type {OperatorAction} from './api/contracts';

export function OperatorActionDock({action, busy, onAction}: {action: OperatorAction | null; busy: boolean; onAction: (action: OperatorAction) => void}) {
  return <section data-testid="operator-primary-action" aria-label="Главное действие" className="rounded-xl border bg-card p-5 shadow-sm">
    {action ? <><p className="text-sm font-medium text-muted-foreground">Следующее действие</p><Button size="lg" className="mt-3 min-h-12 w-full text-base md:w-auto" disabled={busy} aria-busy={busy} onClick={() => onAction(action)}><PilingIcon name="shift-start" size={18} decorative />{busy ? `${action.label} — выполняется` : action.label}</Button>{action.confirmation && <p className="mt-3 text-sm text-muted-foreground">{action.confirmation}</p>}</> : <><h2 className="font-semibold">Действий сейчас нет</h2><p className="mt-2 text-sm text-muted-foreground">Обновите рабочее место или обратитесь к ответственному сотруднику</p></>}
  </section>;
}
