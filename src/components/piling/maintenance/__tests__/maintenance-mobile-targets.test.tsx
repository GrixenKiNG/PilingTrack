/**
 * R73 (экран /admin/maintenance — ТО): чипы быстрого фильтра (32px), 5 селектов
 * фильтра и кнопки наряда (36px), «Закрыть ТО»/«Печать» (36px), пагинация
 * (32px) и ссылка «Показать все события» (~16px) были ниже 44px на телефоне.
 * Механик ведёт наряд с телефона, а отмена наряда необратима — промах по паре
 * кнопок стоит неверного действия. Правка — только телефон: `min-h-11 … sm:…`
 * (чипу — `sm:min-h-8`, кнопкам фиксированной высоты — `h-11 … sm:h-9`).
 * Селектам нужен именно `min-h-*`: `h-11` проигрывает CSS-классу
 * `data-[size=default]:h-9` самого SelectTrigger (у него выше специфичность).
 * На десктопе (sm и шире) вид не меняется.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), loadJson: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch, loadJson: mocks.loadJson }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MaintenanceBoard } from '../maintenance-board';
import { MaintenanceDetailPanel } from '../maintenance-detail-panel';
import { WorkOrderDetail } from '../work-order-detail';
import { WorkOrderTable } from '../work-order-table';
import { STATUS_LABEL } from '../maintenance-labels';
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
});

describe('журнал ТО: цель нажатия на телефоне (R73)', () => {
  beforeEach(() => {
    mocks.loadJson.mockResolvedValue({});
    mocks.authFetch.mockResolvedValue(json({ records: [] }));
  });

  it('чипы, селекты фильтра и кнопки наряда — не ниже 44px на телефоне', async () => {
    render(<MaintenanceBoard />);
    await screen.findByText(/Нарядов по выбранным фильтрам не найдено/);

    // Чипы быстрого фильтра (QuickChip): 32px → 44px, на десктопе прежние 32px.
    expect(screen.getByRole('button', { name: 'Все' })).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-8');

    // 5 селектов фильтра + «Показать по» — все с откатом на десктоп.
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(6);
    for (const combo of selects) {
      expect(combo).toHaveClass('min-h-11', 'sm:min-h-0');
    }

    expect(screen.getByRole('button', { name: /Задача ТО/ })).toHaveClass('h-11', 'sm:h-9');

    // F-R94-3: мёртвая ссылка «План-график» убрана — она вела на экран без
    // регламентов ТО (панель регламентов из интерфейса недостижима).
    expect(screen.queryByRole('link', { name: /План-график/ })).toBeNull();

    // Пагинация: номера страниц выравниваются по соседним «‹/›» (те уже 44px).
    expect(screen.getByRole('button', { name: '1' })).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
  });
});

describe('журнал ТО: строка пагинации переносится на телефоне (F-R126-1)', () => {
  beforeEach(() => {
    mocks.loadJson.mockResolvedValue({});
    mocks.authFetch.mockResolvedValue(json({ records: [] }));
  });

  it('блок «Показать по:» и номера страниц переносятся (flex-wrap) — страница не расширяется', async () => {
    render(<MaintenanceBoard />);
    await screen.findByText(/Нарядов по выбранным фильтрам не найдено/);

    // Ряд пагинации — родитель блока «Показать по:». До правки он был
    // `flex … justify-between` без переноса: 375 px экрана против 503 px
    // содержимого, вся страница уезжала вбок.
    const pagination = screen.getByText('Показать по:').parentElement?.parentElement;
    expect(pagination).toHaveClass('flex-wrap', 'gap-2');
  });
});

describe('журнал ТО: назначение фильтров озвучивается (R116 #10)', () => {
  beforeEach(() => {
    mocks.loadJson.mockResolvedValue({});
    mocks.authFetch.mockResolvedValue(json({ records: [] }));
  });

  it('пять селектов фильтра имеют доступное имя, а не только placeholder', async () => {
    render(<MaintenanceBoard />);
    await screen.findByText(/Нарядов по выбранным фильтрам не найдено/);

    for (const label of [
      'Фильтр по установке',
      'Фильтр по объекту',
      'Фильтр по исполнителю',
      'Фильтр по типу ТО',
      'Фильтр по приоритету',
    ]) {
      expect(screen.getByLabelText(label)).toBeInstanceOf(HTMLButtonElement);
    }
  });
});

describe('таблица нарядов ТО: выбор с клавиатуры (R116 #14)', () => {
  it('строка фокусируется и выбирает наряд клавишами Enter и Space', () => {
    const onSelect = vi.fn();
    render(
      <WorkOrderTable
        records={[record()]}
        selectedId="wo-1"
        crewByEquipment={new Map()}
        busyAction={null}
        onSelect={onSelect}
        onEdit={vi.fn()}
        onDone={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const row = screen.getByText('СП-49').closest('tr');
    if (!row) throw new Error('Строка наряда не найдена');
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith('wo-1');
  });
});

describe('панель наряда ТО: цель нажатия на телефоне (R73)', () => {
  it('«Закрыть ТО» / «Печать» / «Показать все события» — не ниже 44px', () => {
    render(
      <MaintenanceDetailPanel
        record={record()}
        crew={null}
        assigneeName="—"
        busyAction={null}
        onClose={async () => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /Закрыть ТО/ })).toHaveClass('h-11', 'sm:h-9');
    expect(screen.getByRole('button', { name: /Печать/ })).toHaveClass('h-11', 'sm:h-9');

    expect(screen.getByRole('link', { name: 'Показать все события' }))
      .toHaveClass('min-h-11', 'items-center', 'sm:min-h-0');
  });
});

describe('карточка наряда ТО: цель нажатия на телефоне (R73)', () => {
  beforeEach(() => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/maintenance/assignees') return json({ users: [] });
      return json({ record: record() });
    });
  });

  it('кнопки стадий наряда, «Полное редактирование» и «Сохранить» — не ниже 44px', async () => {
    render(<WorkOrderDetail recordId="wo-1" />);

    // IN_PROGRESS → стадии ON_HOLD / DONE / CANCELLED.
    for (const label of [STATUS_LABEL.ON_HOLD, STATUS_LABEL.DONE, STATUS_LABEL.CANCELLED]) {
      expect(await screen.findByRole('button', { name: label })).toHaveClass('min-h-11', 'sm:min-h-0');
    }

    expect(screen.getByRole('button', { name: 'Полное редактирование' })).toHaveClass('min-h-11', 'sm:min-h-0');
    expect(screen.getByRole('button', { name: /Сохранить/ })).toHaveClass('min-h-11', 'sm:min-h-0');
  });
});

describe('журнал ТО: заголовок вкладки браузера (F-R136-TOP, №1)', () => {
  beforeEach(() => {
    mocks.loadJson.mockResolvedValue({});
    mocks.authFetch.mockResolvedValue(json({ records: [] }));
  });

  it('заголовок вкладки браузера назван по экрану', async () => {
    render(<MaintenanceBoard />);
    await screen.findByText(/Нарядов по выбранным фильтрам не найдено/);

    expect(document.title).toBe('Наряды ТО — PilingTrack');
  });
});

/*
  F-R136-TOP №2: карточка наряда ТО показывала одну ссылку «← К списку
  нарядов» — пути «Наряды ТО → наряд» не было видно.
*/
describe('наряд ТО: хлебные крошки (F-R136-TOP, №2)', () => {
  beforeEach(() => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/maintenance/assignees') return json({ users: [] });
      return json({ record: record() });
    });
  });

  it('карточка наряда показывает путь «Наряды ТО → ТО-1 СП-49»', async () => {
    render(<WorkOrderDetail recordId="wo-1" />);

    const crumb = await screen.findByRole('navigation', { name: 'Путь к экрану' });
    expect(within(crumb).getByRole('link', { name: 'Наряды ТО' })).toHaveAttribute('href', '/admin/maintenance');
    expect(within(crumb).getByText('ТО-1 СП-49')).toBeInTheDocument();
  });
});
