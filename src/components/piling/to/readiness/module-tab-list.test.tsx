import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReferenceView } from '../readiness-reference-ui';
import { MODULE_TABS, ModuleTabList } from './module-tab-list';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function ControlledTabs() {
  const [activeView, setActiveView] = useState<ReferenceView>('readiness');
  return <ModuleTabList activeView={activeView} onViewChange={setActiveView} />;
}

describe('ModuleTabList', () => {
  // Восьмая вкладка — «Документы» (контроль сроков документов работников,
  // роль диспетчера в утверждённом порядке). Длина сверяется с MODULE_TABS, а
  // не с числом в тесте: смысл проверки — порядок и полнота списка, а не то,
  // что вкладок ровно семь навсегда.
  it('renders the module tab contract in the approved order', () => {
    render(<ControlledTabs />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(MODULE_TABS.length);
    expect(tabs.map((tab) => tab.textContent)).toEqual(MODULE_TABS.map((tab) => tab.label));
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
