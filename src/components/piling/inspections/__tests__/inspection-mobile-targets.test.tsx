/**
 * R73 (экран /inspections — осмотры): ответ на пункт чек-листа — самая частая
 * полевая цель в продукте. «Да»/«Нет» были 32px, «Исправно/Замечание/
 * Неисправно/Не проверено» — 28px: машинист жмёт их десятки раз за осмотр,
 * стоя у машины. Ниже 44px были и шаги разделов (36px), «+ замечание / фото»
 * (~18px), возврат «← К смене»/«Осмотры» (~20px) и главные кнопки экрана.
 * Правка — только телефон: `min-h-11 … sm:min-h-0`; шагам разделов (есть
 * фиксированная высота) — `h-9 … sm:min-h-0 sm:min-w-9`. Одного `sm:h-*` мало:
 * `min-height` сильнее `height`. На десктопе (sm и шире) вид не меняется.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (state: { currentUser: null }) => unknown) => selector({ currentUser: null }),
}));

import { Status4Control, YesNoControl } from '../inspection-controls';
import { InspectionItemPhotos } from '../inspection-item-photos';
import { RunInspection } from '../run-inspection';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const item = (id: string, sectionTitle: string, answerType: string) => ({
  id,
  sectionTitle,
  text: `Пункт ${id}`,
  answerType,
  unit: null,
  norm: null,
  provenance: null,
  required: true,
  photoRequired: false,
});

function detail(templateSnapshot: unknown[]) {
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
    templateSnapshot,
    answers: [],
  };
}

async function renderInspection(templateSnapshot: unknown[]) {
  mocks.authFetch.mockResolvedValue(json({ inspection: detail(templateSnapshot) }));
  render(<RunInspection inspectionId="insp-1" />);
  return screen.findByRole('button', { name: /Сохранить черновик/ });
}

beforeEach(() => {
  mocks.authFetch.mockReset();
});

describe('контролы ответа осмотра: цель нажатия на телефоне (R73)', () => {
  it('«Да»/«Нет» — 44px на телефоне, прежняя высота на десктопе', () => {
    render(<YesNoControl value="" onChange={() => {}} disabled={false} />);

    expect(screen.getByRole('button', { name: 'Да' })).toHaveClass('min-h-11', 'text-sm', 'sm:min-h-0');
    expect(screen.getByRole('button', { name: 'Нет' })).toHaveClass('min-h-11', 'text-sm', 'sm:min-h-0');
  });

  it('«Исправно/Замечание/Неисправно/Не проверено» — 44px на телефоне', () => {
    render(<Status4Control value="" onChange={() => {}} disabled={false} />);

    for (const label of ['Исправно', 'Замечание', 'Неисправно', 'Не проверено']) {
      expect(screen.getByRole('button', { name: label })).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-0');
    }
  });
});

describe('экран осмотра: цель нажатия на телефоне (R73)', () => {
  it('шаги разделов, возврат и «+ замечание / фото» — не ниже 44px', async () => {
    await renderInspection([item('i1', 'Двигатель', 'YES_NO'), item('i2', 'Гидравлика', 'STATUS4')]);

    // Пошаговый обход: номера разделов листаются пальцем.
    const nav = screen.getByRole('navigation', { name: 'Разделы осмотра' });
    const steps = within(nav).getAllByRole('button');
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step).toHaveClass('h-9', 'min-h-11', 'min-w-11', 'sm:min-h-0', 'sm:min-w-9');
    }

    // Возврат к смене/списку — ссылка-действие ниже минимума WCAG была.
    expect(screen.getByRole('link', { name: /Осмотры/ })).toHaveClass('min-h-11', 'items-center', 'sm:min-h-0');

    expect(screen.getByRole('button', { name: '+ замечание / фото' }))
      .toHaveClass('min-h-11', 'items-center', 'sm:min-h-0');

    expect(screen.getByRole('button', { name: /Сохранить черновик/ }))
      .toHaveClass('min-h-11', 'w-full', 'sm:min-h-0');
  });

  it('главные кнопки осмотра и подпись — не ниже 44px', async () => {
    // Один раздел — обход не пошаговый, и «Завершить осмотр» видно сразу.
    await renderInspection([item('i1', 'Двигатель', 'YES_NO'), item('i2', 'Двигатель', 'STATUS4')]);

    expect(screen.getByRole('button', { name: 'Исправно' })).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-0');

    const finish = screen.getByRole('button', { name: 'Завершить осмотр' });
    expect(finish).toHaveClass('min-h-11', 'w-full', 'sm:min-h-0');

    fireEvent.click(finish);

    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveClass('min-h-11', 'flex-1', 'sm:min-h-0');
    expect(screen.getByRole('button', { name: 'Подтвердить' })).toHaveClass('min-h-11', 'flex-1', 'sm:min-h-0');
  });
});

/*
  F-R136-TOP №2: экран осмотра показывал одну ссылку «← Осмотры» — пути
  «Осмотры → установка» не было видно.
*/
describe('экран осмотра: хлебные крошки (F-R136-TOP, №2)', () => {
  it('осмотр показывает путь «Осмотры → СП-49»', async () => {
    await renderInspection([item('i1', 'Двигатель', 'YES_NO')]);

    const crumb = screen.getByRole('navigation', { name: 'Путь к экрану' });
    expect(within(crumb).getByRole('link', { name: 'Осмотры' })).toHaveAttribute('href', '/inspections');
    expect(within(crumb).getByText('СП-49')).toBeInTheDocument();
  });
});

/*
  F-R137-TOP №1: «Добавить фото» у пункта осмотра было ≈20px — фото это
  обязательное доказательство (пункт с photoRequired без фото не закрыть), а
  на телефоне в перчатке в кнопку было почти не попасть. Галерея установки
  уже получила 44px в R73.
*/
describe('фото пункта осмотра: цель нажатия на телефоне (F-R137-TOP, №1)', () => {
  it('«Добавить фото» — не ниже 44px на телефоне, прежняя высота на десктопе', async () => {
    mocks.authFetch.mockResolvedValue(json({ data: [] }));
    render(<InspectionItemPhotos inspectionId="insp-1" itemId="i1" />);

    const btn = await screen.findByRole('button', { name: 'Добавить фото' });
    expect(btn).toHaveClass('min-h-11', 'items-center', 'sm:min-h-0');
  });
});
