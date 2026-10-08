import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReferenceView } from '../readiness-reference-ui';
import { ModuleTabList } from './module-tab-list';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * Утверждённый порядок и состав вкладок модуля зафиксирован в тесте списком, а
 * не длиной `MODULE_TABS`: иначе правка константы (перестановка, лишняя или
 * пропавшая вкладка) прошла бы молча — тест сверялся бы сам с собой.
 */
const APPROVED_TABS = [
  'Центр готовности',
  'Готовность парка',
  'Смены',
  'Обслуживание ТО',
  'Отчёты',
  'Настройки',
];

function ControlledTabs() {
  const [activeView, setActiveView] = useState<ReferenceView>('readiness');
  return <ModuleTabList activeView={activeView} onViewChange={setActiveView} />;
}

describe('ModuleTabList', () => {
  it('renders the module tab contract in the approved order', () => {
    render(<ControlledTabs />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(APPROVED_TABS.length);
    expect(tabs.map((tab) => tab.textContent)).toEqual(APPROVED_TABS);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-controls', 'view-panel-readiness');
  });

  it('moves focus without selection and activates only with Enter or Space', () => {
    render(<ControlledTabs />);

    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tabs[1], { key: 'Enter' });
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveFocus();

    const last = tabs.length - 1;
    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(tabs[last]).toHaveFocus();
    fireEvent.keyDown(tabs[last], { key: ' ' });
    expect(tabs[last]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[last]).toHaveFocus();

    fireEvent.keyDown(tabs[last], { key: 'Home' });
    expect(tabs[0]).toHaveFocus();
  });
});
