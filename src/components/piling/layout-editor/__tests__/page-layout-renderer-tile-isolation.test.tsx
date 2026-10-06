import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageLayoutRenderer, type RenderablePageWidget } from '../page-layout-renderer';
import type { PageLayoutTemplate } from '../page-layout-template';

/*
  F-R109-4: раньше бросок внутри render() одной плитки уносил весь экран —
  единственным предохранителем был общий AppErrorBoundary на всю оболочку.
  Теперь каждая плитка обёрнута в локальный error boundary: упавшая плитка
  показывает «Блок не загрузился», а остальные остаются видимыми.
*/
function BrokenTile(): never {
  throw new Error('tile failed');
}

const TEMPLATE: PageLayoutTemplate = {
  version: 1,
  widgets: [
    { id: 'broken', visible: true, size: 'sm', order: 0 },
    { id: 'ok', visible: true, size: 'sm', order: 1 },
  ],
};

const widgets: Record<string, RenderablePageWidget> = {
  broken: { id: 'broken', title: 'Сломанная', render: () => <BrokenTile /> },
  ok: { id: 'ok', title: 'Рабочая', render: () => <span>Плитка с данными</span> },
};

describe('PageLayoutRenderer — изоляция упавшей плитки (F-R109-4)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ошибка одной плитки показывает «Блок не загрузился», остальные плитки видны', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<PageLayoutRenderer template={TEMPLATE} widgets={widgets} />);

    expect(screen.getByText('Блок не загрузился')).toBeInTheDocument();
    expect(screen.getByText('Плитка с данными')).toBeInTheDocument();
  });
});