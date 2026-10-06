/**
 * R73 №51–№53 (общие компоненты): на телефоне (<640px) ниже 44px были
 * «Повторить» в общем баннере ошибки (`size="sm"` = 32px), «Печать» в общем
 * диалоге просмотра PDF (`h-8` = 32px) и «Закрыть панель» в панели деталей
 * (32×32). Правка — только телефон: `min-h-11 … sm:min-h-*`; на десктопе
 * (sm и шире) размеры прежние — `min-height` сильнее `height`, поэтому одного
 * `sm:h-*` для сброса мало.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { QueryErrorBanner } from '../async-ui';
import { PdfPreviewDialog } from '../pdf-preview-dialog';
import { OpsDetailPanel } from '../ops-shell/ops-detail-panel';

describe('общий баннер ошибки: цель нажатия на телефоне (R73 №51)', () => {
  it('«Повторить» — не ниже 44px, на десктопе штатные 32px', () => {
    render(<QueryErrorBanner message="Не удалось загрузить данные" onRetry={() => {}} />);

    expect(screen.getByRole('button', { name: 'Повторить' })).toHaveClass('min-h-11', 'sm:min-h-0');
  });
});

describe('диалог просмотра PDF: цель нажатия на телефоне (R73 №52)', () => {
  it('«Печать» — не ниже 44px, на десктопе прежние 32px', () => {
    // reportId без значения — iframe не создаётся (happy-dom тянет по нему
    // fetch); проверяем только размеры кнопки.
    render(<PdfPreviewDialog open onOpenChange={() => {}} reportId={null} />);

    const print = screen.getByRole('button', { name: 'Печать' });
    expect(print).toHaveClass('min-h-11', 'sm:min-h-8');
    // Шрифт на телефоне не уменьшаем — размер текста прежний.
    expect(print).toHaveClass('text-xs');
  });
});

describe('панель деталей: цель нажатия на телефоне (R73 №53)', () => {
  it('«Закрыть панель» — не ниже 44×44, на десктопе прежние 32×32', () => {
    render(
      <OpsDetailPanel title="Установка" onClose={() => {}}>
        тело панели
      </OpsDetailPanel>,
    );

    expect(screen.getByRole('button', { name: 'Закрыть панель' })).toHaveClass(
      'min-h-11',
      'min-w-11',
      'sm:min-h-0',
      'sm:min-w-0',
    );
  });
});
