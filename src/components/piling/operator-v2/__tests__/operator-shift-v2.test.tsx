import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

// Экран тянет рабочий обзор оператора, а тот — стили PostCSS; в тесте они не нужны.
vi.mock('@/components/piling/operator-mobile/operator-concept.css', () => ({}));

const api = vi.hoisted(() => ({
  sendCommand: vi.fn<(arg: {command: string}) => Promise<unknown>>(async () => ({ok: true})),
  fetchState: vi.fn<() => Promise<unknown>>(),
  queued: [] as unknown[],
  flush: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/components/piling/operator-mobile/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/piling/operator-mobile/api')>()),
  sendCommand: api.sendCommand,
  fetchState: api.fetchState,
}));

vi.mock('@/components/piling/operator-mobile/use-offline-queue', () => ({
  useOfflineQueue: () => ({
    queued: api.queued,
    flush: api.flush,
    retry: vi.fn(),
    retryFailed: vi.fn(),
    discard: vi.fn(),
  }),
}));

const authFetch = vi.hoisted(() => vi.fn<(url: string) => Promise<unknown>>());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  authFetch,
}));

import {OperatorShiftV2} from '../operator-shift-v2';

/**
 * D-20260927-005: у бригады нет сменщиков, и передача смены в v2 оставляла
 * смену в HANDOVER_PENDING до авто-закрытия через пять часов.
 *
 * Отчёт и закрытие — одно нажатие и одна команда `close-shift`, как в остальных
 * модулях. Передачи (`handover`) экран не шлёт вовсе.
 */
const mobileState = {
  phase: 'CLOSING',
  productionDate: '2026-09-27',
  shift: {id: 'shift-1'},
  assignment: {equipmentId: 'eq-1'},
  receipt: null,
  production: {
    piles: {count: 12, meters: 168},
    drilling: {count: 0, meters: 0},
    downtimeHours: 0,
  },
  entries: [],
  checklists: [{stage: 'EO_AFTER', done: true}],
  dictionaries: {pileGrades: [], drillingTypes: [], downtimeReasons: []},
} as unknown as OperatorMobileState;

const facts = {
  shift: {id: 'shift-1', state: 'STARTED', startedAt: '2026-09-27T04:00:00.000Z'},
  clearance: {blockers: [], documents: []},
  assignments: [{equipmentId: 'eq-1', siteId: 'site-1'}],
  equipment: {id: 'eq-1', name: 'LRH 100'},
  meterCurrent: 1240,
  report: {status: 'draft'},
  incomingHandover: null,
};

const closeButton = () => screen.findByRole('button', {name: 'Закрыть смену и отправить отчёт'});

describe('закрытие смены v2 одной командой (D-20260927-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.queued = [];
    api.fetchState.mockResolvedValue(mobileState);
    authFetch.mockResolvedValue({ok: true, json: async () => facts});
  });

  it('закрывает смену командой close-shift и не шлёт передачу', async () => {
    render(<OperatorShiftV2 />);
    fireEvent.click(await closeButton());

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith({
      command: 'close-shift', shiftId: 'shift-1', comment: '',
    }));
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    expect(authFetch.mock.calls.every(([url]) => !String(url).includes('handover'))).toBe(true);
  });

  it('держит кнопку выключенной, пока очередь на телефоне не пуста', async () => {
    api.queued = [{
      clientCommandId: 'cmd-1',
      state: 'PENDING',
      label: 'Свая',
      command: {command: 'log-production'},
      queuedAt: new Date().toISOString(),
      attempts: 1,
      lastError: null,
    }];

    render(<OperatorShiftV2 />);
    const button = await closeButton();
    expect(button).toBeDisabled();

    expect(screen.getByText(/Сначала отправьте записи с телефона: 1 не отправлено/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });
});