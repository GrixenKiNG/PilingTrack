/**
 * Экран осмотра — версия осмотра в сохранении (находка Codex XP42).
 *
 * saveAnswers заменяет набор ответов целиком. Экран присылает updatedAt
 * осмотра, на котором основан набор, и после каждого успешного сохранения берёт
 * новую версию из ответа сервера: иначе второе сохранение из той же вкладки
 * спорило бы с собственным первым и получало бы ложный конфликт.
 * Перекрывающиеся сохранения идут по очереди, каждое со свежей версией.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  push: vi.fn(),
  user: { id: 'u1', name: 'Иванов И.И.' },
}));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (state: { currentUser: { id: string; name: string } }) => unknown) =>
    selector({ currentUser: mocks.user }),
}));

import { RunInspection } from '../run-inspection';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const T0 = '2026-10-01T09:00:00.000Z';
const T1 = '2026-10-01T09:00:05.000Z';
const T2 = '2026-10-01T09:00:10.000Z';

function detail(updatedAt: string) {
  return {
    id: 'insp-1',
    status: 'DRAFT',
    level: 'EO',
    inspectionDate: '2026-09-30',
    shift: null,
    engineHours: null,
    healthScore: null,
    equipment: { id: 'eq-1', name: 'СП-49', model: 'PVE 50PR' },
    phase: 'PRE_SHIFT',
    updatedAt,
    templateSnapshot: [{
      id: 'i1', sectionTitle: 'Двигатель', text: 'Уровень масла', answerType: 'YES_NO',
      unit: null, norm: null, provenance: null, required: true, photoRequired: false,
    }],
    answers: [],
  };
}

type Call = [string, { method?: string; body?: string } | undefined];

const putBodies = () => (mocks.authFetch.mock.calls as Call[])
  .filter(([, init]) => init?.method === 'PUT')
  .map(([, init]) => JSON.parse(init?.body ?? '{}') as { expectedUpdatedAt?: string });

/** GET отдаёт осмотр с версией T0; каждый PUT отвечает следующей версией из очереди. */
function install(putResponses: Array<Response | (() => Promise<Response>)>) {
  const queue = [...putResponses];
  mocks.authFetch.mockImplementation(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'PUT') {
      const next = queue.shift();
      if (!next) throw new Error('неожиданный PUT');
      return typeof next === 'function' ? next() : next;
    }
    return json({ inspection: detail(T0) });
  });
}

async function openScreen() {
  render(<RunInspection inspectionId="insp-1" />);
  return screen.findByRole('button', { name: /Сохранить черновик/ });
}

beforeEach(() => {
  mocks.authFetch.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe('RunInspection: версия осмотра при сохранении', () => {
  it('присылает updatedAt, прочитанный при открытии', async () => {
    install([json({ inspection: detail(T1) })]);
    const save = await openScreen();

    fireEvent.click(save);

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0].expectedUpdatedAt).toBe(T0);
  });

  it('второе сохранение несёт версию из ответа на первое, а не прежнюю', async () => {
    install([json({ inspection: detail(T1) }), json({ inspection: detail(T2) })]);
    const save = await openScreen();

    fireEvent.click(save);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /Сохранить черновик/ }));

    await waitFor(() => expect(putBodies()).toHaveLength(2));
    expect(putBodies().map((b) => b.expectedUpdatedAt)).toEqual([T0, T1]);
  });

  it('перекрывающиеся сохранения идут по очереди, второе со свежей версией', async () => {
    let finishFirst!: (r: Response) => void;
    install([
      () => new Promise<Response>((resolve) => { finishFirst = resolve; }),
      json({ inspection: detail(T2) }),
    ]);
    const save = await openScreen();

    // Два вызова в одном такте: кнопка ещё не успела заблокироваться.
    await act(async () => { fireEvent.click(save); fireEvent.click(save); });
    // Второй PUT не уходит, пока первый не завершён.
    expect(putBodies()).toHaveLength(1);

    await act(async () => { finishFirst(json({ inspection: detail(T1) })); });

    await waitFor(() => expect(putBodies()).toHaveLength(2));
    expect(putBodies().map((b) => b.expectedUpdatedAt)).toEqual([T0, T1]);
  });

  it('конфликт версии показывает сообщение сервера', async () => {
    install([json({ error: 'Осмотр изменён другим запросом. Обновите осмотр и повторите.' }, 409)]);
    const save = await openScreen();

    fireEvent.click(save);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Осмотр изменён другим запросом'),
    ));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
