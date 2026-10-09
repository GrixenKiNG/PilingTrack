import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { push, authFetch, fetchWorkPermits, fetchReadinessShifts, fetchCurrentReadiness, fetchReadinessDefects } = vi.hoisted(() => ({
  push: vi.fn(), authFetch: vi.fn(),
  fetchWorkPermits: vi.fn(), fetchReadinessShifts: vi.fn(), fetchCurrentReadiness: vi.fn(), fetchReadinessDefects: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api', () => ({ authFetch }));
vi.mock('../to/readiness/api/client', () => ({ fetchWorkPermits, fetchReadinessShifts, fetchCurrentReadiness, fetchReadinessDefects }));

import { DashboardAttention } from '../dashboard-attention';

const noDocs = { ok: true, json: async () => ({ documents: [] }) };
const names = (id: string) => id;

beforeEach(() => {
  [push, authFetch, fetchWorkPermits, fetchReadinessShifts, fetchCurrentReadiness, fetchReadinessDefects].forEach((fn) => fn.mockReset());
  fetchWorkPermits.mockResolvedValue([]);
  fetchReadinessShifts.mockResolvedValue([]);
  fetchCurrentReadiness.mockResolvedValue([]);
  fetchReadinessDefects.mockResolvedValue([]);
  authFetch.mockResolvedValue(noDocs);
});
afterEach(cleanup);

describe('DashboardAttention — «Требует решения сейчас»', () => {
  it('показывает строки с ролью и действием; нажатие ведёт на нужную вкладку', async () => {
    fetchReadinessDefects.mockResolvedValue([{ id: 'd1', equipmentId: 'eq-9', severity: 'CRITICAL', status: 'OPEN' }]);
    render(<DashboardAttention equipmentName={names} refreshKey={0} />);

    const row = await screen.findByRole('button', { name: /eq-9: критический дефект/ });
    expect(row).toHaveTextContent('Механик · Взять в работу');
    expect(screen.getByRole('region', { name: 'Требует решения сейчас' })).toHaveTextContent('· 1');

    fireEvent.click(row);
    expect(push).toHaveBeenCalledWith('/admin/to?view=maintenance&equipmentId=eq-9');
  });

  it('без срочных проблем показывает спокойную строку', async () => {
    render(<DashboardAttention equipmentName={names} refreshKey={0} />);
    expect(await screen.findByText('Срочных решений нет')).toBeInTheDocument();
  });

  it('роль без доступа ни к одному источнику не видит блока вовсе', async () => {
    fetchWorkPermits.mockRejectedValue(new Error('403'));
    fetchReadinessShifts.mockRejectedValue(new Error('403'));
    fetchCurrentReadiness.mockRejectedValue(new Error('403'));
    fetchReadinessDefects.mockRejectedValue(new Error('403'));
    authFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    const { container } = render(<DashboardAttention equipmentName={names} refreshKey={0} />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('при более чем пяти строках показывает пять и число остальных', async () => {
    fetchReadinessDefects.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({ id: `d${index}`, equipmentId: `eq-${index}`, severity: 'CRITICAL', status: 'OPEN' })),
    );
    render(<DashboardAttention equipmentName={names} refreshKey={0} />);
    await screen.findAllByRole('button');
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.getByText(/Ещё 2/)).toBeInTheDocument();
  });
});
