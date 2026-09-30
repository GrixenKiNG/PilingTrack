/**
 * v1 машиниста: отказ сервера — не обрыв связи (R76, находка 4).
 *
 * Раньше любой сбой загрузки состояния, кроме 401/403, рисовался под заголовком
 * «Нет связи» с советом «восстановите связь». На 500/503 это дезинформация:
 * связь есть, сломан сервер, и чинить его будет механик или администратор, а не
 * машинист с выключенным и включённым Wi-Fi.
 */
import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

const api = vi.hoisted(() => ({
  fetchState: vi.fn(),
  sendCommand: vi.fn(),
}));

vi.mock('@/components/piling/operator-mobile/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/piling/operator-mobile/api')>();
  return {
    ...actual,
    fetchState: api.fetchState,
    sendCommand: api.sendCommand,
    currentPosition: vi.fn(async () => null),
  };
});
vi.mock('@/components/piling/operator-mobile/use-offline-queue', () => ({
  useOfflineQueue: () => ({queued: [], flush: vi.fn(), retry: vi.fn(), retryFailed: vi.fn(), discard: vi.fn()}),
}));
vi.mock('../operator-type.css', () => ({}));
vi.mock('../operator-concept.css', () => ({}));

import {ApiError} from '@/components/piling/operator-mobile/api';
import {OperatorMobileApp} from '../operator-mobile-app';

beforeEach(() => {
  api.fetchState.mockReset();
  api.sendCommand.mockReset();
});

describe('v1: загрузка состояния не удалась', () => {
  it('503 показывает «Сервер не отвечает» и не велит восстанавливать связь', async () => {
    api.fetchState.mockRejectedValue(new ApiError(503, 'Сервис временно недоступен'));

    render(<OperatorMobileApp />);

    expect(await screen.findByText('Сервер не отвечает')).toBeInTheDocument();
    expect(screen.getByText(/Связь есть, но сервер временно не работает/)).toBeInTheDocument();
    expect(screen.queryByText(/Восстановите связь и повторите/)).not.toBeInTheDocument();
    // Кнопка повтора остаётся: сервер может подняться сам.
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
  });

  it('обрыв сети по-прежнему «Нет связи» с советом восстановить связь', async () => {
    api.fetchState.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<OperatorMobileApp />);

    expect(await screen.findByText('Нет связи')).toBeInTheDocument();
    expect(screen.getByText(/Восстановите связь и повторите/)).toBeInTheDocument();
    // Текст браузера («Failed to fetch») на экран не попадает — вместо него
    // русская строка (R76, находка 5).
    expect(screen.getByText('Нет связи с сервером. Проверьте интернет и повторите.')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.queryByText('Сервер не отвечает')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
  });
});

/**
 * Отказ команды с подробностями (R76, находка 10).
 *
 * Общая фраза сервера без перечня полей бесполезна: машинист после «Паспорт
 * заполнен не полностью» не знает, какое из пятнадцати полей править. Здесь
 * проверяется вся цепочка — отказ команды → `details` у `ApiError` → плашка
 * над экраном со списком.
 */
const workState = {
  phase: 'WORK',
  productionDate: '2026-09-20',
  shift: {id: 'shift-1', productionDate: '2026-09-20'},
  assignment: {equipmentId: 'eq-1', equipmentName: 'Установка 12', siteName: 'Площадка А', lastMeter: null},
  identity: {
    ppe: {confirmed: true, missing: []},
    briefing: {ok: true, acknowledgedAt: '2026-09-20T05:00:00.000Z'},
    knowledge: {ok: true}, documents: [],
  },
  checklists: ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE'].map((stage) => ({stage, done: true})),
  permit: {allowed: true, blocks: []},
  dictionaries: {pileGrades: [], drillingTypes: [], downtimeReasons: []},
  production: {
    piles: {count: 12, meters: 60},
    drilling: {count: 4, meters: 24},
    downtimeHours: 0,
  },
  entries: [], warnings: [], defects: [], incidents: [], progress: [],
} as unknown as OperatorMobileState;

async function finishWork(failure: unknown) {
  api.fetchState.mockResolvedValue(workState);
  api.sendCommand.mockRejectedValue(failure);

  render(<OperatorMobileApp />);

  fireEvent.click((await screen.findAllByRole('button', {name: 'Завершить работу'}))[0]);
  fireEvent.click(screen.getByRole('button', {name: 'Да, работа завершена'}));

  return screen.findAllByRole('alert');
}

describe('v1: отказ команды с подробностями', () => {
  it('показывает, что именно не заполнено', async () => {
    const alerts = await finishWork(new ApiError(400, 'Паспорт заполнен не полностью', [
      {field: 'pileNumber', message: 'Укажите номер сваи по проекту'},
    ]));

    const note = alerts.find((node) => node.textContent?.includes('Укажите номер сваи по проекту'));
    expect(note).toHaveTextContent('Паспорт заполнен не полностью');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent))
      .toContain('Укажите номер сваи по проекту');
  });

  it('разбор схемы запроса машинисту не показывается', async () => {
    const alerts = await finishWork(new ApiError(400, 'Паспорт заполнен не полностью', [
      {code: 'invalid_type', path: ['entry'], message: 'Invalid input: expected object'},
    ]));

    expect(alerts.some((node) => node.textContent?.includes('Invalid input'))).toBe(false);
    expect(alerts.some((node) => node.textContent?.includes('Паспорт заполнен не полностью'))).toBe(true);
  });
});

/**
 * Тихое перечитывание после принятой команды (R76, находка 9).
 *
 * Команда уже принята сервером; сбой следующего за ней чтения значит лишь
 * несвежий экран. Раньше он заменял экран полноэкранным «Нет связи», и машинист
 * читал это как «моя свая не записалась».
 */
describe('v1: перечитывание после успешной команды', () => {
  it('сбой перечитывания не заменяет экран, а показывает уведомление', async () => {
    api.fetchState.mockResolvedValueOnce(workState);
    api.fetchState.mockRejectedValueOnce(new ApiError(503, 'Сервис временно недоступен'));
    api.sendCommand.mockResolvedValue(undefined);

    render(<OperatorMobileApp />);

    fireEvent.click((await screen.findAllByRole('button', {name: 'Завершить работу'}))[0]);
    fireEvent.click(screen.getByRole('button', {name: 'Да, работа завершена'}));

    expect(await screen.findByText(/Записано\. Не удалось обновить экран/)).toBeInTheDocument();
    // Экран прежний: полноэкранного отказа нет ни под каким заголовком.
    expect(screen.queryByText('Сервер не отвечает')).not.toBeInTheDocument();
    expect(screen.queryByText('Нет связи')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Повторить'})).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', {name: 'Завершить работу'}).length).toBeGreaterThan(0);
  });
});
