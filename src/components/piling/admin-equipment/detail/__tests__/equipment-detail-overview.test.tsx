/**
 * F-R114-1: «Обзор» карточки техники печатал даты сырым ISO — «Ближайшее ТО:
 * 2026-10-26» и «Последний отчёт: 2026-09-25» (`String(...).slice(0,10)` и
 * `timeline[0]?.date` без форматтера). Это были единственные такие места в
 * админке. Теперь обе строки идут через formatRuDate из @/lib/format, который
 * режет дату без `new Date()` — то есть дата без времени не съезжает на сутки
 * в поясе западнее UTC.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  authFetch: mocks.authFetch,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { OverviewTiles } from '../equipment-detail-overview';
import { EquipmentDetail } from '../equipment-detail';
import { EquipmentDocuments } from '../equipment-documents';
import { usePilingStore } from '@/lib/store';
import type { TimelineRow } from '../equipment-detail-parts';
import { KIND_LABEL } from '../../equipment-status';
import type { EquipmentDTO } from '@/lib/types';

const stats = {
  reportCount: 1,
  piles: 10,
  pileMeters: 100,
  drillingCount: 0,
  drillingMeters: 0,
  downtimeHours: 0,
};

function equipment(p: Record<string, unknown> = {}): EquipmentDTO & Record<string, unknown> {
  return {
    id: 'eq-1',
    name: 'СГ-1',
    kind: 'PILE_DRIVER',
    isActive: true,
    model: null,
    inventoryNumber: '001',
    engineHoursTotal: 1200,
    nextMaintenanceAtHours: 1500,
    ...p,
  } as unknown as EquipmentDTO & Record<string, unknown>;
}

function row(date: string): TimelineRow {
  return {
    reportId: `r-${date}`,
    date,
    shiftType: 'DAY',
    status: 'submitted',
    siteName: null,
    operatorId: null,
    operatorName: null,
    updatedAt: '2026-09-25T18:00:00.000Z',
    piles: null,
    drillingMeters: null,
    downtimeHours: null,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Ответ GET /api/equipment/:id/details — минимум, нужный карточке. */
function detailsResponse(id: string, name: string) {
  return {
    equipment: { id, name, kind: 'PILE_DRIVER', isActive: true, model: null, inventoryNumber: null },
    crew: null,
    telematicsDevices: [],
    documents: [],
    stats30d: { reportCount: 0, piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0 },
    timeline: [],
  };
}

describe('OverviewTiles — даты обзора (F-R114-1)', () => {
  it('«Ближайшее ТО» и «Последний отчёт» печатаются как ДД.ММ.ГГГГ', () => {
    render(
      <OverviewTiles
        eq={equipment({ nextMaintenanceDate: '2026-10-26T00:00:00.000Z' })}
        crew={null}
        stats={stats}
        timeline={[row('2026-09-25')]}
        devicesCount={0}
      />,
    );

    expect(screen.getByText('26.10.2026')).toBeInTheDocument();
    expect(screen.getByText('25.09.2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-10-26')).toBeNull();
    expect(screen.queryByText('2026-09-25')).toBeNull();
  });

  it('дата без времени не съезжает на сутки: 26.10.2026 при сроке в 00:00 UTC', () => {
    render(
      <OverviewTiles
        eq={equipment({ nextMaintenanceDate: '2026-10-26' })}
        crew={null}
        stats={stats}
        timeline={[]}
        devicesCount={0}
      />,
    );

    expect(screen.getByText('26.10.2026')).toBeInTheDocument();
    expect(screen.queryByText('25.10.2026')).toBeNull();
  });

  it('без данных — прочерк, а не пустая строка', () => {
    render(
      <OverviewTiles eq={equipment()} crew={null} stats={stats} timeline={[]} devicesCount={0} />,
    );

    // Обе ячейки (Ближайшее ТО, Последний отчёт) — прочерк.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});

/*
  R119 №13: при переключении установок правая панель до ответа `/details`
  показывала паспорт, статус и имя ПРЕДЫДУЩЕЙ машины — loading выставлялся
  только при монтировании, а смена `equipmentId` его не поднимала.
*/
describe('EquipmentDetail — смена установки (F-R119-13)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    usePilingStore.setState({ currentUser: { role: 'ADMIN' } as never });
  });

  it('пока грузится новая установка, данные прежней не показываются', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/equipment/eq-1/details') return json(detailsResponse('eq-1', 'СГ-1'));
      return new Promise(() => {}); // eq-2 ещё грузится
    });

    const { rerender } = render(<EquipmentDetail equipmentId="eq-1" embedded />);
    expect((await screen.findAllByText('СГ-1')).length).toBeGreaterThan(0);

    rerender(<EquipmentDetail equipmentId="eq-2" embedded />);

    expect(screen.queryAllByText('СГ-1')).toHaveLength(0);
  });
});

/*
  R119 №5: после успешной правки обновлялась только правая карточка, а список
  парка кормится снимком GET /api/monitoring/fleet — переименованная установка
  оставалась в плитке слева со старым именем до перезагрузки страницы.
*/
describe('EquipmentDetail — обновление списка парка после правки (F-R119-5)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    usePilingStore.setState({ currentUser: { role: 'ADMIN' } as never });
  });

  it('после успешного сохранения зовёт onSaved (перечитать снимок)', async () => {
    const onSaved = vi.fn();
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return json({ equipment: { id: 'eq-1' } });
      return json(detailsResponse('eq-1', 'СГ-1'));
    });

    render(<EquipmentDetail equipmentId="eq-1" embedded onSaved={onSaved} />);
    await screen.findAllByText('СГ-1');

    fireEvent.click(screen.getByRole('button', { name: /Редактировать/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});

/*
  R119 №7 (повтор R97 №10) и №6 (повтор R97 №9): отказ сохранения карточки
  показывался как есть — английское «Unauthorized» и «CSRF validation failed: …»
  на русском экране, а построчные `details` 400-ответа отбрасывались, читалось
  только «Некорректные данные».
*/
describe('EquipmentDetail — текст отказа сохранения (F-R119-6, F-R119-7)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.error).mockClear();
    usePilingStore.setState({ currentUser: { role: 'ADMIN' } as never });
  });

  /** Открывает карточку, жмёт «Редактировать» → «Сохранить» с заданным ответом PUT. */
  async function save(putResponse: () => Response) {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return putResponse();
      return json(detailsResponse('eq-1', 'СГ-1'));
    });

    render(<EquipmentDetail equipmentId="eq-1" embedded />);
    await screen.findAllByText('СГ-1');
    fireEvent.click(screen.getByRole('button', { name: /Редактировать/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
  }

  it('401 → «Сессия истекла», а не серверное «Unauthorized»', async () => {
    await save(() => json({ error: 'Unauthorized' }, 401));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Сессия истекла — войдите снова.'));
    expect(toast.error).not.toHaveBeenCalledWith('Unauthorized');
  });

  it('CSRF-403 → русский текст про проверку безопасности', async () => {
    await save(() => json({ error: 'CSRF validation failed: origin mismatch' }, 403));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Запрос отклонён проверкой безопасности. Обновите страницу и повторите.',
    ));
  });

  it('400 с построчными details показывает причину поля, а не только «Некорректные данные»', async () => {
    await save(() => json({ error: 'Некорректные данные', details: [{ field: 'name', message: 'Required' }] }, 400));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Поле name: обязательное поле'),
    ));
  });
});

/*
  F-R126-6: диалог документа установки («Новый документ») не ограничивал высоту
  — на коротком экране обрезался сверху и снизу, крестик уходил за кадр.
  Добавлены `max-h-[90vh]` и прокрутка.
*/
describe('EquipmentDocuments — диалог ограничен по высоте (F-R126-6)', () => {
  it('содержимое диалога ограничено 90vh и прокручивается', async () => {
    render(<EquipmentDocuments equipmentId="eq-1" documents={[]} canManage onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Добавить/ }));

    const dialog = (await screen.findByText('Новый документ')).closest('[data-slot="dialog-content"]');
    expect(dialog).toHaveClass('max-h-[90vh]', 'overflow-y-auto');
  });
});

/*
  F-R136-TOP №2: карточка установки показывала одну ссылку «← К списку
  установок» — пути «Установки → СГ-1» не было видно.
*/
describe('EquipmentDetail — хлебные крошки (F-R136-TOP, №2)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    usePilingStore.setState({ currentUser: { role: 'ADMIN' } as never });
  });

  it('карточка показывает путь «Установки → СГ-1»', async () => {
    mocks.authFetch.mockImplementation(async () => json(detailsResponse('eq-1', 'СГ-1')));

    render(<EquipmentDetail equipmentId="eq-1" />);

    const crumb = await screen.findByRole('navigation', { name: 'Путь к экрану' });
    expect(within(crumb).getByRole('link', { name: 'Установки' })).toHaveAttribute('href', '/admin/equipment');
    expect(within(crumb).getByText('СГ-1')).toBeInTheDocument();
  });
});

/*
  F-R138-TOP №1: тип техники назывался по-разному — список подписывал
  «Копёр/Бур/Вибро», шапка карточки — «Забивная установка/…», а тип OTHER в
  списке печатался голым «—» (неотличимо от незаполненного поля). Теперь
  список и карточка берут один словарь (equipment-status.ts), и OTHER подписан
  словом.
*/
describe('EquipmentDetail — название типа техники (F-R138-TOP, №1)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    usePilingStore.setState({ currentUser: { role: 'ADMIN' } as never });
  });

  function mockDetails(kind: string) {
    mocks.authFetch.mockImplementation(async () => json({
      ...detailsResponse('eq-1', 'СГ-1'),
      equipment: { id: 'eq-1', name: 'СГ-1', kind, isActive: true, model: null, inventoryNumber: null },
    }));
  }

  it('карточка подписывает тип тем же словом, что и список', async () => {
    mockDetails('PILE_DRIVER');
    render(<EquipmentDetail equipmentId="eq-1" embedded />);
    await screen.findAllByText('СГ-1');

    expect(screen.getAllByText(KIND_LABEL.PILE_DRIVER).length).toBeGreaterThan(0);
  });

  it('тип OTHER подписан словом, а не прочерком', async () => {
    mockDetails('OTHER');
    render(<EquipmentDetail equipmentId="eq-1" embedded />);
    await screen.findAllByText('СГ-1');

    expect(KIND_LABEL.OTHER).not.toBe('—');
    expect(screen.getAllByText(KIND_LABEL.OTHER).length).toBeGreaterThan(0);
  });
});

/*
  F-R138-TOP №2: состояние выведенной из эксплуатации установки называлось
  «Неактивна» в бейдже у имени, но «Списана» — в герое и плитке «Текущее
  состояние». Одно слово на оба места.
*/
describe('EquipmentDetail — статус списанной установки (F-R138-TOP, №2)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    usePilingStore.setState({ currentUser: { role: 'ADMIN' } as never });
  });

  it('списанная установка подписана «Списана», а не «Неактивна»', async () => {
    mocks.authFetch.mockImplementation(async () => json({
      ...detailsResponse('eq-1', 'СГ-1'),
      equipment: { id: 'eq-1', name: 'СГ-1', kind: 'PILE_DRIVER', isActive: false, model: null, inventoryNumber: null },
    }));

    render(<EquipmentDetail equipmentId="eq-1" embedded />);
    await screen.findAllByText('СГ-1');

    expect(screen.getAllByText('Списана').length).toBeGreaterThan(0);
    expect(screen.queryByText('Неактивна')).toBeNull();
  });
});