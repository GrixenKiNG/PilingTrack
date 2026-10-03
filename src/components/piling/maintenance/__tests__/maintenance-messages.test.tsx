/**
 * F-R94 (находки «важно» 1, 2, 4, 6): сообщения модуля ТО на исходах
 * 401/403/404/5xx/обрыв сети. Раньше мутации показывали английское
 * «Unauthorized» как есть, отказ по правам и сбой сервера выглядели как «наряд
 * не найден», «Закрыть ТО» выполнялось одним кликом, а 409 советовал обновить
 * страницу, которую экран не перечитывал.
 *
 * Тексты вынесены в maintenance-helpers (проверены отдельно) — здесь проверяем,
 * что каждый экран выбирает нужный текст и что закрытие требует подтверждения.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), loadJson: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch, loadJson: mocks.loadJson }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Подтверждение подменяем лёгкой заглушкой: тест про то, что закрытие вообще
// спрашивает, а не про вёрстку диалога.
vi.mock('@/components/piling/confirm-action-dialog', () => ({
  ConfirmActionDialog: ({ open, title, confirmLabel, onConfirm }: {
    open: boolean; title: string; confirmLabel: string; onConfirm: () => void;
  }) => (open ? (
    <div>
      <span>{title}</span>
      <button type="button" onClick={() => void onConfirm()}>{confirmLabel}</button>
    </div>
  ) : null),
}));

import { MaintenanceBoard } from '../maintenance-board';
import { WorkOrderDetail } from '../work-order-detail';
import { WorkOrderFormDialog } from '../work-order-form-dialog';
import { WorkOrderPhotos } from '../work-order-photos';
import type { WorkOrderRow } from '../maintenance-board-model';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function record(): WorkOrderRow {
  return {
    id: 'wo-1',
    equipmentId: 'eq-1',
    type: 'TO1',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    title: 'ТО-1 СП-49',
    description: '',
    scheduledAt: '2026-09-29T09:00:00.000Z',
    startedAt: null,
    completedAt: null,
    acceptedAt: null,
    assigneeId: null,
    faultCause: null,
    workDone: 'Замена фильтров',
    partsUsedText: null,
    engineHoursAtService: 1200,
    laborHours: null,
    cost: null,
    equipment: {
      id: 'eq-1',
      name: 'СП-49',
      model: null,
      engineHoursTotal: 1200,
      nextMaintenanceAtHours: 1250,
      nextMaintenanceDate: null,
      crews: [],
    },
  };
}

beforeEach(() => {
  mocks.authFetch.mockReset();
  mocks.loadJson.mockReset();
  mocks.loadJson.mockResolvedValue({});
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe('карточка наряда ТО: отказ чтения различается по статусу (F-R94-2)', () => {
  // Сбой чтения наряда; справочник исполнителей отвечает отдельно.
  function mockRecordLoad(status: number) {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/maintenance/assignees') return json({ users: [] });
      return json({ error: 'x' }, status);
    });
  }

  it('403 → про права, без «Наряд не найден» и без кнопки повтора', async () => {
    mockRecordLoad(403);
    render(<WorkOrderDetail recordId="wo-1" />);

    expect(await screen.findByText('Нет прав на обслуживание. Смените роль или обратитесь к администратору.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('404 → «наряд не найден», а не общий сбой', async () => {
    mockRecordLoad(404);
    render(<WorkOrderDetail recordId="wo-1" />);

    expect(await screen.findByText('Наряд не найден (возможно, удалён).')).toBeInTheDocument();
  });

  it('5xx → временная недоступность с кнопкой «Повторить»', async () => {
    mockRecordLoad(500);
    render(<WorkOrderDetail recordId="wo-1" />);

    expect(await screen.findByText('Сервер временно недоступен — повторите позже.')).toBeInTheDocument();
    const before = mocks.authFetch.mock.calls.filter(([u]) => u === '/api/maintenance/wo-1').length;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(mocks.authFetch.mock.calls.filter(([u]) => u === '/api/maintenance/wo-1').length).toBeGreaterThan(before),
    );
  });

  it('обрыв сети → русский текст вместо «Failed to fetch»', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/maintenance/assignees') return json({ users: [] });
      throw new TypeError('Failed to fetch');
    });
    render(<WorkOrderDetail recordId="wo-1" />);

    expect(await screen.findByText('Нет связи с сервером — повторите при появлении сети.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

describe('карточка наряда ТО: мутации (F-R94-1, F-R94-6)', () => {
  function mockRecord(handlers: { method?: string; status: number; body?: unknown }) {
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/maintenance/assignees') return json({ users: [] });
      if (url.startsWith('/api/media')) return json({ data: [] });
      if (init?.method === 'PUT') return json(handlers.body ?? {}, handlers.status);
      return json({ record: record() });
    });
  }

  it('401 на сохранении → «Сессия истекла», а не серверное «Unauthorized»', async () => {
    mockRecord({ status: 401, body: { error: 'Unauthorized' } });
    render(<WorkOrderDetail recordId="wo-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Приостановлено' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Сессия истекла — войдите снова.'));
  });

  it('409 → наряд перечитан, без совета «обновите страницу»', async () => {
    mockRecord({ status: 409, body: { error: 'Наряд уже изменён или принят — обновите страницу' } });
    render(<WorkOrderDetail recordId="wo-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Приостановлено' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Запись изменилась — данные обновлены, повторите действие.'));
    // Карточка перечитала наряд (GET после PUT), чтобы повтор не упёрся в тот же конфликт.
    await waitFor(() =>
      expect(mocks.authFetch.mock.calls.filter(([u]) => u === '/api/maintenance/wo-1').length).toBeGreaterThanOrEqual(2),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Наряд уже изменён или принят — обновите страницу');
  });
});

describe('доска нарядов ТО: отказ чтения (F-R94-2)', () => {
  it('403 → текст про права, а не «Не удалось загрузить наряды ТО»', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/media')) return json({ data: [] });
      return json({ error: 'Доступ запрещён' }, 403);
    });
    render(<MaintenanceBoard />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет прав на обслуживание. Смените роль или обратитесь к администратору.',
    ));
  });

  it('5xx → «сервер временно недоступен», без технического кода', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/media')) return json({ data: [] });
      return json({ error: 'x' }, 503);
    });
    render(<MaintenanceBoard />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Сервер временно недоступен — повторите позже.'));
  });
});

describe('доска нарядов ТО: закрытие с подтверждением (F-R94-4)', () => {
  beforeEach(() => {
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/media')) return json({ data: [] });
      if (init?.method === 'PUT') return json({ record: record() });
      return json({ records: [record()] });
    });
  });

  it('«Закрыть наряд ТО» сначала спрашивает и только потом пишет', async () => {
    render(<MaintenanceBoard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Закрыть наряд ТО' }));

    // Подтверждение появилось, но PUT ещё не ушёл.
    expect(screen.getByText('Закрыть наряд ТО?')).toBeInTheDocument();
    expect(mocks.authFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть наряд' }));

    await waitFor(() =>
      expect(mocks.authFetch.mock.calls.some(([u, init]) =>
        (init as RequestInit | undefined)?.method === 'PUT' && u === '/api/equipment/eq-1/maintenance/wo-1',
      )).toBe(true),
    );
  });
});

describe('доска нарядов ТО: 409 обещает обновление только после удачного перечитывания (F-M4-MAINT)', () => {
  /** 409 на PUT; журнал отдаётся первым GET и падает на повторном. */
  it('сбой перечитывания → «данные обновил другой пользователь», без «данные обновлены»', async () => {
    let getCalls = 0;
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/media')) return json({ data: [] });
      if (init?.method === 'PUT') return json({ error: 'Наряд уже изменён' }, 409);
      getCalls += 1;
      if (getCalls === 1) return json({ records: [record()] });
      return json({ error: 'x' }, 503);
    });
    render(<MaintenanceBoard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Закрыть наряд ТО' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть наряд' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Данные изменил другой пользователь, обновите страницу.'),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Запись изменилась — данные обновлены, повторите действие.');
  });

  it('удачное перечитывание → «данные обновлены, повторите действие»', async () => {
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/media')) return json({ data: [] });
      if (init?.method === 'PUT') return json({ error: 'Наряд уже изменён' }, 409);
      return json({ records: [record()] });
    });
    render(<MaintenanceBoard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Закрыть наряд ТО' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть наряд' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Запись изменилась — данные обновлены, повторите действие.'),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Данные изменил другой пользователь, обновите страницу.');
  });
});

describe('контур ТО: моменты времени — дата и время по Москве (F-R114-2)', () => {
  /*
    00:30 МСК 26.09 — это 21:30 UTC 25.09. formatRuDate режет UTC-день, поэтому
    закрытие, начало работ и приёмка датировались вчерашним «25.09.2026»; момент
    должен идти через форматтер с явным поясом (общий @/lib/timezone) и показывать
    время. Плановая дата (scheduledAt) — это день, её сдвигать не нужно.
  */
  const MOMENT = '2026-09-25T21:30:00.000Z';
  const MSK_MOMENT = '26 сент. 2026 г., 00:30';

  function momentRecord() {
    return {
      ...record(),
      status: 'DONE',
      createdAt: MOMENT,
      completedAt: MOMENT,
      acceptedAt: MOMENT,
      createdById: 'u1',
      closedById: 'u1',
      acceptedById: 'u1',
      people: { u1: 'Иванов' },
    };
  }

  function mockMoment() {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/maintenance/assignees') return json({ users: [] });
      if (url.startsWith('/api/media')) return json({ data: [] });
      if (url === '/api/maintenance/wo-1') return json({ record: momentRecord() });
      return json({ records: [momentRecord()] });
    });
  }

  it('карточка: «факт», приёмка и «кто и когда» — по Москве, а не UTC-днём', async () => {
    mockMoment();
    render(<WorkOrderDetail recordId="wo-1" />);

    expect(await screen.findByText(`факт ${MSK_MOMENT}`)).toBeInTheDocument();
    expect(screen.getByText(`✓ Принято ${MSK_MOMENT}`)).toBeInTheDocument();
    // Заявку открыл / Закрыл наряд / Принял работу — каждый с моментом по Москве.
    expect(screen.getAllByText(MSK_MOMENT)).toHaveLength(3);
    // Прежний вывод брал UTC-день и печатал 25.09.
    expect(screen.queryByText('факт 25.09.2026')).toBeNull();
  });

  it('панель наряда: закрытие — моментом по Москве, UTC-дня на экране нет', async () => {
    mockMoment();
    render(<MaintenanceBoard />);

    expect(await screen.findByText('Закрыто')).toBeInTheDocument();
    expect(await screen.findAllByText(MSK_MOMENT)).not.toHaveLength(0);
    // Прежде «Закрыто» и таймлайн несли UTC-день 25.09.
    expect(screen.queryByText(/25\.09\.2026/)).toBeNull();
  });
});

describe('форма наряда ТО: моточасы — целое, не меньше 0 (F-R121-2)', () => {
  /*
    Схема маршрута требует engineHoursAtService: int ≥ 0
    (app/api/equipment/[id]/maintenance/route.ts). Поле ничего не проверяло:
    механик вписывал дробное показание счётчика («12345.5») и получал 400
    «Некорректные данные» без имени поля. Теперь дробь/минус отклоняются до
    отправки с понятным текстом, а не уходят на сервер.
  */
  function mockDialog() {
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/maintenance/assignees') return json({ users: [] });
      if (init?.method === 'POST') return json({ record: record() }, 201);
      return json({});
    });
  }

  const postCalls = () =>
    mocks.authFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

  async function fillDialog(hours?: string) {
    mockDialog();
    render(<WorkOrderFormDialog open onOpenChange={() => {}} equipmentId="eq-1" onSaved={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Название *'), { target: { value: 'ТО-1' } });
    if (hours !== undefined) {
      fireEvent.change(screen.getByLabelText('Моточасы'), { target: { value: hours } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
  }

  it('дробные моточасы не уходят на сервер и объясняются до отправки', async () => {
    await fillDialog('12345.5');

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Моточасы — целое число, без дробной части'));
    expect(postCalls()).toHaveLength(0);
  });

  it('отрицательные моточасы отклоняются до отправки', async () => {
    await fillDialog('-1');

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Моточасы не могут быть отрицательными'));
    expect(postCalls()).toHaveLength(0);
  });

  it('целые неотрицательные моточасы уходят на сервер', async () => {
    await fillDialog('12345');

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(toast.error).not.toHaveBeenCalledWith('Моточасы — целое число, без дробной части');
  });
});

describe('фото наряда ТО: обрыв сети объясняется по-русски (F-R112-2)', () => {
  it('загрузка фото без связи — русский текст, а не «Failed to fetch»', async () => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new TypeError('Failed to fetch');
      return json({ data: [] });
    });
    const { container } = render(<WorkOrderPhotos recordId="wo-1" />);
    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalled());

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Нет связи с сервером — повторите при появлении сети.'),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Failed to fetch');
  });
});
