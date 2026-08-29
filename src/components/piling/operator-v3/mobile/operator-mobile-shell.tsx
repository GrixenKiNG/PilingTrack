import type {ReactNode} from 'react';

interface OperatorMobileShellProps {
  statusStrip: ReactNode;
  header: ReactNode;
  progress: ReactNode;
  children: ReactNode;
  primaryAction: ReactNode;
  navigation: ReactNode;
  /** Есть ли навигация — от этого зависит нижний отступ прокрутки. */
  hasNavigation: boolean;
  /** Есть ли закреплённое действие — оно тоже перекрывает низ содержимого. */
  hasPrimaryAction: boolean;
}

/**
 * Каркас телефонного экрана: порядок сверху вниз — связь, машина, этап,
 * содержимое, главное действие, вкладки.
 *
 * Полоса связи стоит первой намеренно. Раньше состояние очереди лежало отдельной
 * панелью ниже навигации, вне этой области: чтобы узнать, ушли ли записи,
 * оператор пролистывал экран до конца и находил панель за нижними вкладками.
 *
 * Обёртка здесь — div, а не main: главную область страницы уже объявляет
 * раскладка приложения. Две вложенные main давали скринридеру два ориентира
 * «основное содержимое» и ни одного признака, какой из них настоящий.
 *
 * Нижний отступ считается, а не задаётся раз и навсегда. Прежние `pb-64` были
 * рассчитаны на «действие плюс вкладки всегда»; когда чего-то из двух нет,
 * внизу оставался пустой провал в треть экрана.
 */
export function OperatorMobileShell({
  statusStrip,
  header,
  progress,
  children,
  primaryAction,
  navigation,
  hasNavigation,
  hasPrimaryAction,
}: OperatorMobileShellProps) {
  const bottomGap = 16 + (hasPrimaryAction ? 96 : 0) + (hasNavigation ? 60 : 0);

  return (
    <div data-testid="operator-v3-workplace" className="min-h-[calc(100dvh-4rem)] bg-muted/30">
      <div className="mx-auto min-h-[calc(100dvh-4rem)] w-full max-w-[430px] bg-background shadow-sm">
        {statusStrip}
        {header}
        {progress}
        <div
          className="space-y-4 px-4 pt-4"
          style={{paddingBottom: `calc(${bottomGap}px + env(safe-area-inset-bottom))`}}
        >
          {children}
        </div>
        {primaryAction}
        {navigation}
      </div>
    </div>
  );
}
