import type {ReactNode} from 'react';

/**
 * Закреплённая область главного действия.
 *
 * Отступ снизу зависит от навигации: она есть не на каждом экране, и жёстко
 * зашитые 3.75rem поднимали кнопку над пустотой там, где вкладок нет.
 */
export function OperatorPrimaryAction({children, aboveNavigation}: {
  children: ReactNode;
  aboveNavigation: boolean;
}) {
  return (
    <div
      data-testid="operator-primary-action-region"
      className="fixed inset-x-0 z-20 mx-auto w-full max-w-[430px] border-t bg-background/95 px-4 py-3 backdrop-blur"
      style={{
        bottom: aboveNavigation
          ? 'calc(3.75rem + env(safe-area-inset-bottom))'
          : 'env(safe-area-inset-bottom)',
      }}
    >
      {children}
    </div>
  );
}
