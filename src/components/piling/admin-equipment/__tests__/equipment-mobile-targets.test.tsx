/**
 * R73 (экран /admin/equipment — Установки): на телефоне (<640px) ниже 44px были
 * «ТО»/«Документы» в плитке (28px), «Добавить фото» (28px), переключатель
 * «Активна» (40×24), сортировка таблицы (~32px), 5 селектов фильтра (32px),
 * чипы периода отчёта (24px) и элементы карточки установки (вкладки, разделы,
 * история, «Сбросить фильтры»). Механик работает с этого экрана с телефона.
 * Правка — только телефон: `min-h-11 … sm:min-h-0`; у переключателя растёт сам
 * <button>, видимая дорожка остаётся 40×24 (образец — workspace-settings.tsx).
 * На десктопе (sm и шире) вид не меняется.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch, loadJson: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { Wrench } from '@/components/piling/icons/unified-icons';
import { EquipmentTile } from '../equipment-tile';
import { EquipmentCardBlockContent } from '../equipment-card-block';
import { EquipmentFilters, EMPTY_FILTERS } from '../equipment-filters';
import { EquipmentTable } from '../equipment-table';
import { EquipmentForm, EMPTY_EQUIPMENT_FORM } from '../equipment-form';
import { DEFAULT_EQUIPMENT_CARD_TEMPLATE } from '../equipment-card-template';
import { HistoryTable, Section, type TimelineRow } from '../detail/equipment-detail-parts';
import { EquipmentPhotos } from '../detail/equipment-photos';
import { EquipmentReportExport } from '../detail/equipment-report-export';
import type { FleetCard } from '../fleet-types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function card(over: Partial<FleetCard> = {}): FleetCard {
  return {
    id: 'eq-1',
    name: 'СП-49',
    model: 'Liebherr LRH 100',
    manufactureYear: null,
    kind: 'PILE_DRIVER',
    inventoryNumber: null,
    serialNumber: null,
    engineHoursTotal: null,
    nextMaintenanceDate: null,
    nextMaintenanceAtHours: null,
    assignedSiteId: null,
    assignedSiteName: null,
    assignedOperatorName: null,
    assignedCrewName: null,
    status: 'idle',
    reportStatus: 'missing',
    equipmentStatus: 'idle',
    todaysReports: 0,
    todayTotals: null,
    downtimeReason: null,
    latestReport: null,
    photoUrl: null,
    ...over,
  };
}

function timelineRow(over: Partial<TimelineRow> = {}): TimelineRow {
  return {
    reportId: 'r-1',
    date: '2026-09-29',
    shiftType: 'DAY',
    status: 'SUBMITTED',
    siteName: null,
    operatorId: null,
    operatorName: null,
    updatedAt: '2026-09-29T18:00:00.000Z',
    piles: null,
    drillingMeters: null,
    downtimeHours: null,
    ...over,
  };
}

beforeEach(() => {
  mocks.authFetch.mockReset();
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/settings') return json({ timezone: 'Europe/Moscow' });
    return json({ data: [] });
  });
});

describe('плитка установки: цель нажатия на телефоне (R73)', () => {
  it('«ТО» и «Документы» в плитке — не ниже 44px, на десктопе прежние 28px', () => {
    render(<EquipmentTile card={card()} selected={false} onSelect={() => {}} />);

    for (const label of ['ТО', 'Документы']) {
      expect(screen.getByRole('link', { name: label })).toHaveClass('min-h-11', 'py-1.5', 'text-xs', 'sm:min-h-0');
    }
  });

  it('те же ссылки в раскладке «Конструктор» — не ниже 44px', () => {
    const block = DEFAULT_EQUIPMENT_CARD_TEMPLATE.blocks.find((item) => item.dataKey === 'quickLinks');
    if (!block) throw new Error('в шаблоне плитки нет блока быстрых ссылок');

    render(<EquipmentCardBlockContent block={block} card={card()} />);

    for (const label of ['ТО', 'Документы']) {
      expect(screen.getByRole('link', { name: label })).toHaveClass('min-h-11', 'py-1.5', 'text-xs', 'sm:min-h-0');
    }
  });
});

describe('фильтры, сортировка и сброс фильтров (R73)', () => {
  it('5 селектов фильтра — не ниже 44px, на десктопе прежние 32px', () => {
    render(
      <EquipmentFilters
        sites={['Объект А']}
        kinds={[{ value: 'PILE_DRIVER', label: 'Копёр' }]}
        crews={['Бр-1']}
        value={EMPTY_FILTERS}
        onChange={() => {}}
      />,
    );

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(5);
    for (const select of selects) {
      expect(select).toHaveClass('min-h-11', 'py-2', 'text-xs', 'sm:min-h-0');
    }
  });

  it('сортировка столбцов таблицы — не ниже 44px, на десктопе без изменений', () => {
    render(<EquipmentTable cards={[card()]} selectedId={null} onSelect={() => {}} />);

    // min-height на `display: table-cell` браузер не применяет — отсюда `h-11`
    // с откатом `sm:h-auto` (у ячейки height работает как минимум).
    expect(screen.getByRole('columnheader', { name: /Установка/ })).toHaveClass('h-11', 'sm:h-auto');
    expect(screen.getByRole('columnheader', { name: /Моточасы/ })).toHaveClass('h-11', 'sm:h-auto');
    // Несортируемые столбцы правки не касаются.
    expect(screen.getByRole('columnheader', { name: 'Объект' })).not.toHaveClass('h-11');
  });
});

describe('карточка установки: цель нажатия на телефоне (R73)', () => {
  it('переключатель «Активна»: растёт кнопка, дорожка остаётся 40×24', () => {
    render(<EquipmentForm state={EMPTY_EQUIPMENT_FORM} onChange={() => {}} />);

    const row = screen.getByText('Активна').closest('div');
    const toggle = row?.querySelector('button');
    expect(toggle).toHaveClass('min-h-11', 'w-11', 'place-items-center', 'sm:min-h-0');
    // Видимая дорожка не изменилась — ни на телефоне, ни на десктопе.
    expect(toggle?.firstElementChild).toHaveClass('w-10', 'h-6', 'rounded-full');
  });

  it('«Добавить фото» — не ниже 44px, на десктопе прежние 28px', () => {
    // Ответ не нужен: проверяем разметку кнопки, а не загрузку галереи
    // (незавершённый запрос заодно не будит setState после теста).
    mocks.authFetch.mockImplementation(() => new Promise(() => {}));
    render(<EquipmentPhotos equipmentId="eq-1" />);

    expect(screen.getByRole('button', { name: /Добавить фото/ }))
      .toHaveClass('min-h-11', 'items-center', 'py-1.5', 'text-xs', 'sm:min-h-0');
  });

  it('чипы периода и даты отчёта — не ниже 44px', () => {
    // Пояс организации не запрашиваем: проверяем цели нажатия, а не расчёт дня.
    mocks.authFetch.mockImplementation(() => new Promise(() => {}));
    render(<EquipmentReportExport equipmentId="eq-1" />);

    for (const label of ['Сегодня', '7 дней', '30 дней']) {
      expect(screen.getByRole('button', { name: label })).toHaveClass('min-h-11', 'py-1', 'text-xs', 'sm:min-h-0');
    }
    for (const label of ['С', 'По']) {
      expect(screen.getByLabelText(label)).toHaveClass('min-h-11', 'text-sm', 'sm:min-h-0');
    }
  });

  it('заголовок раздела паспорта и история работ — не ниже 44px', () => {
    render(
      <Section icon={Wrench} title="История работ" collapsible anchor="history">
        <HistoryTable rows={[timelineRow(), timelineRow({ reportId: 'r-2' })]} />
      </Section>,
    );

    expect(screen.getByRole('button', { name: /История работ/ })).toHaveClass('min-h-11', 'items-center', 'sm:min-h-0');
    // Шеврон раскрытия истории (20px) и подвал «Показать всю историю».
    expect(screen.getByRole('button', { name: 'Развернуть историю' }))
      .toHaveClass('min-h-11', 'min-w-11', 'sm:min-h-0', 'sm:min-w-0');
    expect(screen.getByRole('button', { name: /Показать всю историю/ })).toHaveClass('min-h-11', 'sm:min-h-0');
  });
});

describe('форма установки: подписи связаны с полями (R116)', () => {
  it('поля вкладки «Основное» находятся по подписи (getByLabelText)', () => {
    render(<EquipmentForm state={EMPTY_EQUIPMENT_FORM} onChange={() => {}} />);

    // Текстовые поля: htmlFor/id через useId в хелпере Field.
    for (const label of [
      'Название *', 'Модель', 'Инвентарный номер', 'Госномер',
      'Базовая машина / носитель', 'Серийный номер', 'Год выпуска', 'VIN',
    ]) {
      expect(screen.getByLabelText(label)).toBeInstanceOf(HTMLInputElement);
    }
    // Многострочное поле и селект Radix (SelectTrigger получает тот же id).
    expect(screen.getByLabelText('Описание')).toBeInstanceOf(HTMLTextAreaElement);
    expect(screen.getByLabelText('Тип машины')).toBeInstanceOf(HTMLButtonElement);
  });

  it('NumberField на вкладке «Тех. характеристики» тоже связан с подписью', () => {
    render(<EquipmentForm state={EMPTY_EQUIPMENT_FORM} onChange={() => {}} />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Тех. характеристики/ }));

    expect(screen.getByLabelText('Вес (т)')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Вид молота (для чек-листа)')).toBeInstanceOf(HTMLButtonElement);
  });
});

describe('фильтры парка: назначение селектов озвучивается (R116 #9)', () => {
  it('пять селектов имеют доступное имя, а не только выбранное значение', () => {
    render(
      <EquipmentFilters
        sites={['Объект А']}
        kinds={[{ value: 'PILE_DRIVER', label: 'Копёр' }]}
        crews={['Бр-1']}
        value={EMPTY_FILTERS}
        onChange={() => {}}
      />,
    );

    for (const label of [
      'Фильтр по объекту',
      'Фильтр по типу машины',
      'Фильтр по статусу техники',
      'Фильтр по статусу отчёта',
      'Фильтр по бригаде',
    ]) {
      expect(screen.getByLabelText(label)).toBeInstanceOf(HTMLSelectElement);
    }
  });
});

describe('форма установки: лимиты полей как в zod-схеме маршрута (R121)', () => {
  it('текстовые поля ограничены по длине из схемы', () => {
    render(<EquipmentForm state={EMPTY_EQUIPMENT_FORM} onChange={() => {}} />);

    expect(screen.getByLabelText('Название *')).toHaveAttribute('maxLength', '200');
    expect(screen.getByLabelText('Описание')).toHaveAttribute('maxLength', '2000');
    expect(screen.getByLabelText('VIN')).toHaveAttribute('maxLength', '50');
  });

  it('числовые поля ограничены по min/max, целые — шагом 1', () => {
    render(<EquipmentForm state={EMPTY_EQUIPMENT_FORM} onChange={() => {}} />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Тех. характеристики/ }));
    const weight = screen.getByLabelText('Вес (т)');
    expect(weight).toHaveAttribute('min', '0');
    expect(weight).toHaveAttribute('max', '2000');
    expect(weight).toHaveAttribute('step', '0.1');
    const height = screen.getByLabelText('Высота (мм)');
    expect(height).toHaveAttribute('max', '100000');
    expect(height).toHaveAttribute('step', '1');

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Эксплуатация/ }));
    const hours = screen.getByLabelText('Наработка моточасов');
    expect(hours).toHaveAttribute('min', '0');
    expect(hours).toHaveAttribute('max', '1000000');
    expect(hours).toHaveAttribute('step', '1');
  });
});

/**
 * F-R115-8: «Скачать PDF» переходил по адресу маршрута и на отказе (403/429/5xx)
 * открывал страницу с сырым JSON вместо файла. Теперь PDF тянется через
 * authFetch, а отказ объясняется русским тостом.
 */
describe('отчёт по установке: отказ выгрузки PDF объясняется по-русски (F-R115-8)', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it('403 на «Скачать PDF» → русский текст, без перехода на страницу с ответом', async () => {
    mocks.authFetch.mockImplementation(async (u: string) => {
      if (u === '/api/settings') return json({ timezone: 'Europe/Moscow' });
      return json({ error: 'Доступ запрещён' }, 403);
    });
    render(<EquipmentReportExport equipmentId="eq-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Скачать PDF/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет прав на выгрузку отчёта. Обратитесь к администратору.',
    ));
  });

  it('обрыв сети при выгрузке → русский текст, а не «Failed to fetch»', async () => {
    mocks.authFetch.mockImplementation(async (u: string) => {
      if (u === '/api/settings') return json({ timezone: 'Europe/Moscow' });
      throw new TypeError('Failed to fetch');
    });
    render(<EquipmentReportExport equipmentId="eq-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Скачать PDF/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет связи с сервером. Файл не сформирован — повторите при появлении сети.',
    ));
    expect(toast.error).not.toHaveBeenCalledWith('Failed to fetch');
  });
});

/**
 * F-R115-9: клик по фотографии установки при отказе скачивания молча ничего не
 * делал — непонятно, нет прав, файла нет или пропала связь.
 */
describe('фото установки: отказ открытия объясняется по-русски (F-R115-9)', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it('403 при открытии фото объясняется тостом, а не тишиной', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/media?entityType=equipment&entityId=eq-1') {
        return json({ data: [{ id: 'm1', fileName: 'a.png', contentType: 'image/png', thumbnailKey: 'k' }] });
      }
      if (url.startsWith('/api/media/download-batch')) return json({ urls: { m1: 'https://cdn.example/x.jpg' } });
      return json({ error: 'Доступ запрещён' }, 403);
    });
    render(<EquipmentPhotos equipmentId="eq-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть фото' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет прав на просмотр фото. Смените роль или обратитесь к администратору.',
    ));
  });
});
