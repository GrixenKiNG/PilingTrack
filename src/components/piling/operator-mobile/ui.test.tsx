import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {OperatorStatusStrip} from './operator-status-strip';
import {PhaseBar} from './ui';
import {admissionBlockers, admissionSteps} from './safety/admission-steps';

const progress = [
  {phase: 'IDENTITY', label: 'Допуск', done: true, current: false},
  {phase: 'ADMISSION', label: 'Приём', done: false, current: true},
  {phase: 'PRESHIFT_INSPECTION', label: 'Осмотр', done: false, current: false},
] as const;

describe('рабочая оболочка машиниста', () => {
  it('объясняет текущий этап словами, а не только цветом', () => {
    render(<PhaseBar progress={[...progress]} />);

    expect(screen.getByText('Шаг 2 из 3')).toBeInTheDocument();
    expect(screen.getByRole('listitem', {name: 'Приём — текущий этап'})).toBeInTheDocument();
    expect(screen.getByRole('listitem', {name: 'Допуск — выполнено'})).toBeInTheDocument();
  });

  it('показывает завершённую смену как семь из семи, а не как первый шаг', () => {
    const completed = Array.from({length: 7}, (_, index) => ({
      phase: `PHASE_${index}`,
      label: `Этап ${index + 1}`,
      done: true,
      current: false,
    }));

    render(<PhaseBar progress={completed} />);

    expect(screen.getByText('7 из 7')).toBeInTheDocument();
    expect(screen.getByText('Смена завершена')).toBeInTheDocument();
    expect(screen.queryByText('Шаг 1 из 7')).not.toBeInTheDocument();
  });

  it('явно показывает, где находятся записи при потере связи', () => {
    const {rerender} = render(<OperatorStatusStrip online items={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Синхронизировано');
    expect(screen.getByRole('status')).toHaveTextContent('Сервер доступен');

    rerender(<OperatorStatusStrip online={false} items={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Офлайн');
    expect(screen.getByRole('status')).toHaveTextContent('Выработка и события сохранятся на устройстве');
  });

  it('отличает ожидающие записи от отклонённых сервером', () => {
    const pending = [{
      clientCommandId: 'p1', label: 'Выработка', command: {}, queuedAt: '', attempts: 0,
      state: 'PENDING' as const, lastError: null,
    }];
    const failed = [{
      ...pending[0], clientCommandId: 'f1', state: 'FAILED' as const, lastError: 'смена закрыта',
    }];

    const {rerender} = render(<OperatorStatusStrip online items={pending} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ожидает отправки: 1');

    rerender(<OperatorStatusStrip online items={failed} />);
    expect(screen.getByRole('status')).toHaveTextContent('Нужно проверить: 1');
  });
});

/*
 * Шаги допуска решают, что человек прочитает о своём праве выйти на площадку.
 * Две проверки ниже держат ровно то, что нельзя сломать молча: допуск
 * объявляет сервер, а подпись без отметки о ознакомлении не существует.
 */
describe('шаги допуска к смене', () => {
  const identity = {
    documents: [],
    ppe: {confirmed: true, items: [], missing: [], confirmedAt: '2026-09-17T05:00:00.000Z'},
    briefing: {
      code: 'И-СМ-04', title: 'Инструкция', version: '2.4',
      acknowledgedVersion: '2.4', acknowledgedAt: '2026-09-17T05:01:00.000Z', ok: true,
    },
    knowledge: {validUntil: '2027-01-01T00:00:00.000Z', lastResult: '4 из 4', ok: true},
  };

  it('не объявляет допуск, пока сервер держит фазу «допуск»', () => {
    const steps = admissionSteps({phase: 'IDENTITY', identity} as never);
    const admission = steps.find((step) => step.id === 'ADMISSION');

    expect(admission?.done).toBe(false);
    expect(admission?.note).toBe('Ожидает');
    expect(admissionBlockers(steps)).toEqual([]);
  });

  it('не считает подпись поставленной без отметки об ознакомлении', () => {
    const steps = admissionSteps({
      phase: 'WORK',
      identity: {...identity, briefing: {...identity.briefing, acknowledgedAt: null}},
    } as never);

    expect(steps.find((step) => step.id === 'SIGNATURE')?.done).toBe(false);
    expect(steps.find((step) => step.id === 'ADMISSION')?.done).toBe(true);
  });
});
