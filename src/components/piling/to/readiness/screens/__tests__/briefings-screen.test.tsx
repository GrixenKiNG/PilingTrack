/**
 * F-R115-13: «Печатная форма» журнала инструктажей открывается через
 * window.open без проверки результата. Если браузер блокирует всплывающее окно,
 * вызов возвращает null и нажатие молча ничего не делало. Теперь отказ
 * объясняется сообщением.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';
import type { ReferenceUiProps } from '../types';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import { BriefingsScreen } from '../briefings-screen';

const journalRow = {
  id: 'b1',
  recordedAt: '2026-10-01T08:00:00.000Z',
  kind: 'INSTRUCTION',
  userId: 'u1',
  userName: 'Иван',
  userRole: 'OPERATOR',
  documentCode: 'ИОТ-001',
  documentTitle: 'Инструкция по охране труда',
  documentVersion: '2',
  result: null,
  validUntil: null,
  type: 'PRIMARY',
  instructorId: 'u2',
  instructorName: 'Пётр',
  reason: 'Приём на работу',
  employeeSignedAt: '2026-10-01T08:00:00.000Z',
  instructorSignedAt: '2026-10-01T08:00:00.000Z',
  status: 'signed',
};

beforeEach(() => {
  mocks.authFetch.mockReset();
  vi.mocked(toast.error).mockClear();
});

describe('журнал инструктажей: печать при заблокированном окне (F-R115-13)', () => {
  it('заблокированное всплывающее окно объясняется, а не молчит', async () => {
    mocks.authFetch.mockResolvedValue({ ok: true, json: async () => ({ rows: [journalRow], truncated: false }) });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      render(<BriefingsScreen {...({ bootstrap: null } as unknown as ReferenceUiProps)} />);

      const button = await screen.findByRole('button', { name: 'Печатная форма' });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      expect(toast.error).toHaveBeenCalledWith(
        'Браузер заблокировал окно печати. Разрешите всплывающие окна и повторите.',
      );
    } finally {
      open.mockRestore();
    }
  });
});
it('opens a blank window first, clears its opener and then navigates without a false blocked toast', async () => {
  mocks.authFetch.mockResolvedValue({ ok: true, json: async () => ({ rows: [journalRow], truncated: false }) });
  const popup = { opener: window, location: { href: '' } };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  try {
    render(<BriefingsScreen {...({ bootstrap: null } as unknown as ReferenceUiProps)} />);
    const button = await screen.findByRole('button', { name: 'Печатная форма' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toMatch(/^\/print\/briefing-journal\?/);
    expect(toast.error).not.toHaveBeenCalled();
  } finally { open.mockRestore(); }
});


describe('журнал инструктажей: подсчёт сегодняшних событий по часовому поясу тенанта (F-R114-8)', () => {
  const previousTimezone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-03T01:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  });

  it('считает «сегодня» и «вчера» в зоне тенанта, а не браузера', async () => {
    const rows = [
      { ...journalRow, id: 'yesterday', recordedAt: '2026-10-02T06:00:00.000Z' },
      { ...journalRow, id: 'today-1', recordedAt: '2026-10-02T17:00:00.000Z' },
      { ...journalRow, id: 'today-2', recordedAt: '2026-10-02T18:00:00.000Z' },
      { ...journalRow, id: 'tomorrow', recordedAt: '2026-10-03T07:00:00.000Z' },
    ];
    mocks.authFetch.mockResolvedValue({ ok: true, json: async () => ({ rows, truncated: false }) });
    render(<BriefingsScreen {...({ bootstrap: { tenant: { timezone: 'America/Los_Angeles' } } } as unknown as ReferenceUiProps)} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('в сравнении со вчера: +1')).toBeInTheDocument();
  });
});
