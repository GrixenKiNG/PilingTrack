import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  P1 R78-41 (аудит 16.10.2026): инструктор провёл инструктаж и расписался, а у
  работника не было ни кнопки, ни статуса: строка показывала «✓» безусловно.
  Теперь строка, ждущая отметки работника, говорит об этом словами и несёт кнопку
  на ТУ ЖЕ запись; «✓» остаётся только там, где работник действительно подписал.
*/
const mocks = vi.hoisted(() => ({authFetch: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn()}));
vi.mock('@/lib/api', () => ({authFetch: mocks.authFetch}));
vi.mock('sonner', () => ({toast: {error: mocks.toastError, success: mocks.toastSuccess}}));
vi.mock('../equipment-permit-matrix', () => ({EquipmentPermitMatrix: () => null}));

import {MyClearanceScreen} from '../my-clearance-screen';

type Row = Record<string, unknown>;
const base = (over: Row = {}): Row => ({
  id: 'rec-1', kind: 'INSTRUCTION', recordedAt: '2026-10-16T05:00:00.000Z',
  documentTitle: 'Безопасность при свайных работах', documentVersion: '1.0', result: null, validUntil: null,
  instructorName: null, instructorSignedAt: null, employeeSignedAt: '2026-10-16T05:00:00.000Z',
  awaitingEmployeeSignature: false, ...over,
});

const view = (history: Row[]) => ({
  clearance: {cleared: true, blockers: [], warnings: [], documents: []},
  briefings: {required: [], pending: [], overdue: [], lastBriefingAt: null},
  knowledgeValidUntil: null,
  history,
});

const respond = (history: Row[]) => ({ok: true, json: async () => view(history)});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('«Мой допуск»: отметка работника под инструктажем', () => {
  const awaiting = base({
    instructorName: 'Петров П.П.', instructorSignedAt: '2026-10-16T05:00:00.000Z',
    employeeSignedAt: null, awaitingEmployeeSignature: true,
  });

  it('строка, ждущая работника, названа словами, называет инструктора и несёт кнопку', async () => {
    mocks.authFetch.mockResolvedValue(respond([awaiting]));
    render(<MyClearanceScreen />);

    expect(await screen.findByText(/ждёт вашей отметки/i)).toBeInTheDocument();
    expect(screen.getByText(/Петров П\.П\./)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Подтвердить инструктаж/})).toBeInTheDocument();
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });

  it('кнопка подписывает именно эту запись и после успеха перечитывает историю', async () => {
    mocks.authFetch
      .mockResolvedValueOnce(respond([awaiting]))
      .mockResolvedValueOnce({ok: true, json: async () => ({data: {alreadySigned: false}})})
      .mockResolvedValueOnce(respond([base({
        instructorName: 'Петров П.П.', instructorSignedAt: '2026-10-16T05:00:00.000Z',
        employeeSignedAt: '2026-10-16T06:10:00.000Z',
      })]));
    render(<MyClearanceScreen />);

    fireEvent.click(await screen.findByRole('button', {name: /Подтвердить инструктаж/}));

    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalledWith('/api/briefings/rec-1/sign', {method: 'POST'}));
    expect(await screen.findByText('✓')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /Подтвердить инструктаж/})).not.toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it('отказ сервера не прячется: кнопка остаётся, причина показана', async () => {
    mocks.authFetch
      .mockResolvedValueOnce(respond([awaiting]))
      .mockResolvedValueOnce({ok: false, status: 403, json: async () => ({error: 'Подписать эту запись может только её работник или инструктор'})});
    render(<MyClearanceScreen />);

    fireEvent.click(await screen.findByRole('button', {name: /Подтвердить инструктаж/}));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Подписать эту запись может только её работник или инструктор'));
    expect(screen.getByRole('button', {name: /Подтвердить инструктаж/})).toBeEnabled();
  });

  it('обрыв связи объясняется, а не молчит', async () => {
    mocks.authFetch.mockResolvedValueOnce(respond([awaiting])).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<MyClearanceScreen />);

    fireEvent.click(await screen.findByRole('button', {name: /Подтвердить инструктаж/}));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Нет связи с сервером. Отметка не поставлена, повторите.'));
  });

  it('«✓» стоит только у подписанных работником записей и у собственного ознакомления', async () => {
    mocks.authFetch.mockResolvedValue(respond([
      base({id: 'a', documentTitle: 'Подписано обоими', instructorName: 'Петров П.П.', instructorSignedAt: '2026-10-16T05:00:00.000Z'}),
      base({id: 'b', documentTitle: 'Сам прочитал', employeeSignedAt: null}),
      awaiting,
    ]));
    render(<MyClearanceScreen />);

    await screen.findByText('Подписано обоими');
    const row = (title: string) => screen.getByText(title).closest('div[class*="flex"]') as HTMLElement;
    expect(within(row('Подписано обоими')).getByText('✓')).toBeInTheDocument();
    expect(within(row('Сам прочитал')).getByText('✓')).toBeInTheDocument();
    expect(screen.getAllByText('✓')).toHaveLength(2);
    expect(screen.getAllByRole('button', {name: /Подтвердить инструктаж/})).toHaveLength(1);
  });

  it('проверка знаний показывает результат и кнопки не имеет', async () => {
    mocks.authFetch.mockResolvedValue(respond([base({kind: 'KNOWLEDGE', result: '8 из 8', employeeSignedAt: null})]));
    render(<MyClearanceScreen />);

    expect(await screen.findByText('8 из 8')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /Подтвердить инструктаж/})).not.toBeInTheDocument();
  });
});
