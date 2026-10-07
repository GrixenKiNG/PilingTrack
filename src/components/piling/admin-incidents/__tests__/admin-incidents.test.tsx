/**
 * R104 (важно №1–№9): экран происшествий.
 *
 * Экран ходил сырым `fetch`: 401 не разлогинивал, заголовок «Действую как» не
 * отправлялся, а обрыв связи и не-JSON ответ прокси печатались английскими
 * строками. Плюс не было «Повторить», при сбое смены вкладки оставался старый
 * список, при 409 форма загоняла в круг, а шапка при ошибке врала «всё
 * разобрано». Проверяем поведение через `authFetch` и русские тексты.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (s: { currentUser: { role: string }; actingAs: string | null }) => unknown) =>
    selector({ currentUser: { role: 'ADMIN' }, actingAs: null }),
}));
vi.mock('@/services/auth/authorization-service', () => ({ can: () => true }));

import { AdminIncidents } from '../admin-incidents';

const incident = {
  id: 'i1',
  category: 'NEAR_MISS',
  severity: 'HIGH',
  state: 'REPORTED',
  description: 'Чуть не задели стрелой',
  signs: [],
  injured: false,
  stopRequired: false,
  occurredAt: '2026-09-01T10:00:00.000Z',
  photos: 0,
  reviewedAt: null,
  reviewNote: null,
  reportedBy: 'Иван',
  equipmentName: 'СП-49',
  siteName: 'Объект 1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

const NOTE_PLACEHOLDER = 'Разобрали с бригадой, зону оградили, инструктаж повторили';

describe('AdminIncidents — загрузка (F-R104-1,2,3,4,5,9,11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('читает список через authFetch (заголовок исполняемой роли и разлогин на 401)', async () => {
    authFetch.mockResolvedValueOnce(jsonResponse({data: [incident]}));

    render(<AdminIncidents />);
    await screen.findByText('Иван');

    expect(authFetch).toHaveBeenCalledWith('/api/admin/incidents?scope=open');
  });

  it('обрыв сети → русский текст и кнопка «Повторить», счёт в шапке неизвестен', async () => {
    authFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({data: [incident]}));

    render(<AdminIncidents />);

    expect(await screen.findByText('Нет связи с сервером. Проверьте интернет и повторите.')).toBeInTheDocument();
    expect(screen.getByText('Не удалось загрузить — счёт неизвестен')).toBeInTheDocument();
    expect(screen.queryByText('Неразобранных происшествий нет')).toBeNull();

    fireEvent.click(screen.getByRole('button', {name: 'Повторить'}));
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Иван')).toBeInTheDocument();
  });

  it('не-JSON ответ прокси → понятный текст вместо английского SyntaxError', async () => {
    authFetch.mockResolvedValueOnce(
      new Response('<!DOCTYPE html><title>502</title>', {
        status: 502,
        headers: {'content-type': 'text/html'},
      }),
    );

    render(<AdminIncidents />);

    expect(await screen.findByText('Сервер вернул неожиданный ответ. Повторите попытку.')).toBeInTheDocument();
  });

  it('при сбое смены вкладки старый список не выдаётся за новый', async () => {
    authFetch
      .mockResolvedValueOnce(jsonResponse({data: [incident]}))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<AdminIncidents />);
    await screen.findByText('Иван');

    fireEvent.click(screen.getByRole('button', {name: 'Все'}));

    expect(await screen.findByText('Нет связи с сервером. Проверьте интернет и повторите.')).toBeInTheDocument();
    // Строки отбора «Ждут разбора» больше не показываются под ошибкой «Все».
    expect(screen.queryByText('Иван')).toBeNull();
  });
});

describe('AdminIncidents — запись разбора (F-R104-6,7,8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authFetch.mockResolvedValueOnce(jsonResponse({data: [incident]}));
  });

  it('409 (уже разобрали) закрывает форму, обновляет список и объясняет причину', async () => {
    authFetch
      .mockResolvedValueOnce(jsonResponse({error: 'Происшествие не найдено либо уже разобрано'}, 409))
      .mockResolvedValueOnce(jsonResponse({data: []}));

    render(<AdminIncidents />);
    fireEvent.click(await screen.findByRole('button', {name: 'Разобрать'}));
    fireEvent.change(screen.getByPlaceholderText(NOTE_PLACEHOLDER), {target: {value: 'Разобрали с бригадой'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать разбор'}));

    expect(await screen.findByText('Это происшествие уже разобрали — список обновлён')).toBeInTheDocument();
    // Форма закрыта — повторное нажатие не упрётся в тот же отказ по кругу.
    expect(screen.queryByRole('button', {name: 'Записать разбор'})).toBeNull();
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(3));
  });

  it('отказ записи виден рядом с формой, форма остаётся открытой', async () => {
    authFetch.mockResolvedValueOnce(jsonResponse({error: 'Доступ запрещён'}, 403));

    render(<AdminIncidents />);
    fireEvent.click(await screen.findByRole('button', {name: 'Разобрать'}));
    fireEvent.change(screen.getByPlaceholderText(NOTE_PLACEHOLDER), {target: {value: 'Разобрали с бригадой'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать разбор'}));

    expect(await screen.findByText('Доступ запрещён')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(NOTE_PLACEHOLDER)).toBeInTheDocument();
  });

  it('поле вывода ограничено верхней границей сервера (4000 знаков)', async () => {
    render(<AdminIncidents />);
    fireEvent.click(await screen.findByRole('button', {name: 'Разобрать'}));

    expect(screen.getByPlaceholderText(NOTE_PLACEHOLDER)).toHaveAttribute('maxlength', '4000');
  });

  /** W75: кнопка «Записать разбор» серая до 10 знаков, но минимум нигде не был указан. */
  it('под полем разбора показан минимум знаков (W75)', async () => {
    render(<AdminIncidents />);
    fireEvent.click(await screen.findByRole('button', {name: 'Разобрать'}));

    expect(screen.getByText('Нужно не меньше 10 знаков.')).toBeInTheDocument();
  });
});
