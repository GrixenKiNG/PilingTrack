import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

// Экран тянет оформление обзора; в тестах подменяем CSS пустышкой — так же,
// как в operator-work-overview.test.tsx.
vi.mock('../../operator-concept.css', () => ({}));

import {WorkScreen} from '../work-screen';

/*
  Аудит R82, находки 3 и 8: введённое в форме выработки и черновик паспорта
  сваи обязаны переживать отказ сервера и возврат «← К смене».
*/

const state = {
  phase: 'WORK',
  productionDate: '2026-09-30',
  shift: {id: 's1', productionDate: '2026-09-30'},
  assignment: {equipmentId: 'e1', equipmentName: 'Liebherr LRH 100 №1', siteName: 'Площадка-1'},
  permit: {allowed: true, blocks: []},
  warnings: [],
  weather: null,
  entries: [],
  production: {piles: {count: 0, meters: 0}, drilling: {count: 0, meters: 0}, downtimeHours: 0},
  dictionaries: {
    pileGrades: [{id: 'g1', name: 'С 100.30-8', lengthMm: 3000}],
    drillingTypes: [],
    downtimeReasons: [],
  },
  checklists: [
    {stage: 'PRESHIFT_INSPECTION', done: true},
    {stage: 'SITE_READY', done: true},
    {stage: 'EO_BEFORE', done: true},
    {stage: 'TB_PILING', done: true},
  ],
  identity: {
    ppe: {confirmed: true, missing: []},
    briefing: {ok: true},
    knowledge: {ok: true},
    documents: [],
  },
} as unknown as OperatorMobileState;

const baseProps = {
  state,
  busy: false,
  onLog: vi.fn().mockResolvedValue(true),
  onFinish: vi.fn(),
  onOpenSafety: vi.fn(),
  error: null as string | null,
  errorDetails: [],
  onCorrect: vi.fn().mockResolvedValue(true),
};

describe('рабочий экран: черновик при отказе сервера', () => {
  it('сохраняет введённое количество после отказа, «← К смене» и повторного входа', () => {
    const onLog = vi.fn().mockResolvedValue(true);
    const {rerender} = render(<WorkScreen {...baseProps} onLog={onLog} error={null} />);

    fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));
    fireEvent.change(screen.getByLabelText('Марка сваи'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByLabelText('Свай, шт'), {target: {value: '12'}});

    rerender(<WorkScreen {...baseProps} onLog={onLog} error="Смена уже закрыта" />);

    fireEvent.click(screen.getByRole('button', {name: '← К смене'}));
    fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));

    expect(screen.getByLabelText('Марка сваи')).toHaveValue('g1');
    expect(screen.getByLabelText('Свай, шт')).toHaveValue(12);
  });

  it('черновик паспорта сваи переживает «← К смене» и возврат', () => {
    render(<WorkScreen {...baseProps} />);

    fireEvent.click(screen.getByRole('button', {name: 'Свая с паспортом'}));
    fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-130'}});

    fireEvent.click(screen.getByRole('button', {name: '← К смене'}));
    fireEvent.click(screen.getByRole('button', {name: 'Свая с паспортом'}));

    expect(screen.getByPlaceholderText('С-130')).toHaveValue('С-130');
  });

  it('после успешной записи поля пусты', async () => {
    const onLog = vi.fn().mockResolvedValue(true);
    render(<WorkScreen {...baseProps} onLog={onLog} />);

    fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));
    fireEvent.change(screen.getByLabelText('Марка сваи'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByLabelText('Свай, шт'), {target: {value: '12'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    await waitFor(() => expect(onLog).toHaveBeenCalled());
    await waitFor(() => {
      expect((screen.getByLabelText('Свай, шт') as HTMLInputElement).value).toBe('');
    });
  });
});
