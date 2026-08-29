import {Button} from '@/components/ui/button';
import {PilingIcon} from '@/components/piling/icons/piling-icon';
import type {OperatorAction} from './api/contracts';

/**
 * Единственное главное действие экрана и сноска под ним.
 *
 * Сноска — это не подпись к кнопке, а требование спецификации: последствие
 * называется до нажатия, а не после. «Это критичный пункт: после фиксации смена
 * будет заблокирована» человек должен прочитать, пока ещё может передумать.
 *
 * Карточки вокруг кнопки больше нет. Область и так закреплена над навигацией,
 * отделена рамкой и подложкой — рамка внутри рамки на 430 px просто съедала
 * ширину, которой у главной кнопки экрана и так немного.
 */
export function OperatorActionDock({action, busy, onAction}: {
  action: OperatorAction | null;
  busy: boolean;
  onAction: (action: OperatorAction) => void;
}) {
  if (!action) {
    return (
      <section data-testid="operator-primary-action" aria-label="Главное действие">
        <p className="text-sm font-medium">Действий сейчас нет</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Обновите рабочее место или обратитесь к ответственному сотруднику
        </p>
      </section>
    );
  }

  return (
    <section data-testid="operator-primary-action" aria-label="Главное действие">
      <Button
        size="lg"
        className="min-h-14 w-full text-base"
        disabled={busy}
        aria-busy={busy}
        onClick={() => onAction(action)}
      >
        <PilingIcon name="shift-start" size={18} decorative />
        {busy ? `${action.label} — выполняется` : action.label}
      </Button>
      {action.confirmation && (
        <p className="mt-2 text-center text-sm text-muted-foreground">{action.confirmation}</p>
      )}
    </section>
  );
}
