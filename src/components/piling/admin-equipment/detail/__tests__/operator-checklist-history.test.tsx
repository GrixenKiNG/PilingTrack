import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch }));

import { OperatorChecklistHistory } from '../operator-checklist-history';

const row = (id: string, templateKey: string, label: string, counts = { ok: 9, remark: 0, fault: 0, na: 0 }) => ({
  id, shiftId: 's1', templateKey, label, completedAt: '2026-10-09T04:37:22.000Z', performerName: 'Иванов И.', counts,
});
const respond = (records: unknown[]) => authFetch.mockResolvedValue({ ok: true, json: async () => ({ records }) });

beforeEach(() => authFetch.mockReset());
afterEach(cleanup);

describe('OperatorChecklistHistory — ЕО машиниста в карточке установки', () => {
  it('показывает вид осмотра, исполнителя и счёт ответов; неисправности выделены', async () => {
    respond([row('e1', 'EO_BEFORE', 'ЕО до смены', { ok: 8, remark: 1, fault: 1, na: 0 })]);
    render(<OperatorChecklistHistory equipmentId="eq-1" title="Осмотры машиниста по сменам" />);

    expect(await screen.findByText('ЕО до смены')).toBeInTheDocument();
    expect(screen.getByText('Иванов И.')).toBeInTheDocument();
    expect(screen.getByText('Норма: 8')).toBeInTheDocument();
    expect(screen.getByText('Замечаний: 1')).toBeInTheDocument();
    expect(screen.getByText('Неисправностей: 1')).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledWith('/api/equipment/eq-1/operator-checklists');
  });

  it('в журнале ТО (onlyEo) предсменный осмотр не показывается', async () => {
    respond([row('e1', 'EO_AFTER', 'ЕО после смены'), row('e2', 'PRESHIFT_INSPECTION', 'Предсменный осмотр')]);
    render(<OperatorChecklistHistory equipmentId="eq-1" onlyEo title="ЕО машиниста по сменам" />);

    expect(await screen.findByText('ЕО после смены')).toBeInTheDocument();
    expect(screen.queryByText('Предсменный осмотр')).not.toBeInTheDocument();
  });

  it('пустой список объясняется, сбой загрузки не выдаётся за «записей нет»', async () => {
    respond([]);
    const { unmount } = render(<OperatorChecklistHistory equipmentId="eq-1" title="Осмотры" />);
    expect(await screen.findByText('Записей пока нет.')).toBeInTheDocument();
    unmount();

    authFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<OperatorChecklistHistory equipmentId="eq-1" title="Осмотры" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить');
    expect(screen.queryByText('Записей пока нет.')).not.toBeInTheDocument();
  });
});
