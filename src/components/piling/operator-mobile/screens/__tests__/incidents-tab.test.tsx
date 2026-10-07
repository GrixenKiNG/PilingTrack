import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {IncidentView, OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {IncidentsTab} from '../incidents-tab';

const state = {incidents: []} as unknown as OperatorMobileState;

function openForm() {
  const onReport = vi.fn();
  render(
    <IncidentsTab
      state={state}
      busy={false}
      error={null}
      commandId="test-command"
      onReport={onReport}
    />,
  );
  fireEvent.click(screen.getByRole('button', {name: 'Записать происшествие'}));
  return onReport;
}

describe('форма происшествия', () => {
  // Кнопка отправки гаснет, пока не выбрана категория, и молчит: человек
  // пишет описание и не находит, чем отправить.
  it('до выбора категории называет шаг и причину неактивной кнопки', () => {
    openForm();

    expect(screen.getByText('Шаг 1 из 2: выберите, что произошло')).toBeInTheDocument();
    expect(screen.getByText('Сначала выберите, что произошло')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Записать происшествие'})).toBeDisabled();
  });

  it('после выбора категории подсказка уходит, кнопка отправки остаётся', () => {
    openForm();

    fireEvent.click(screen.getByRole('button', {name: /С человеком/}));

    expect(screen.queryByText('Сначала выберите, что произошло')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Записать происшествие'})).toBeInTheDocument();
  });
});

describe('журнал происшествий', () => {
  // Экран не только форма: записанные происшествия смены остаются на виду до
  // разбора. Пустой фикстуры для этого мало — нужна непустая запись.
  it('показывает записанное происшествие, а не только форму', () => {
    const incident: IncidentView = {
      id: 'inc-1',
      category: 'PEOPLE',
      severity: 'HIGH',
      state: 'OPEN',
      description: 'Придавило руку помощнику при подъёме сваи.',
      signs: ['UNUSUAL_NOISE'],
      injured: true,
      stopRequired: true,
      occurredAt: '2026-10-01T08:15:00.000Z',
      photos: 2,
      reviewedAt: null,
    };

    render(
      <IncidentsTab
        state={{incidents: [incident]} as unknown as OperatorMobileState}
        busy={false}
        error={null}
        commandId="test-command"
        onReport={vi.fn()}
      />,
    );

    expect(screen.getByText('С человеком')).toBeInTheDocument();
    expect(screen.getByText('Придавило руку помощнику при подъёме сваи.')).toBeInTheDocument();
    expect(screen.getByText(/Серьёзно/)).toBeInTheDocument();
    expect(screen.getByText(/есть пострадавшие/)).toBeInTheDocument();
    expect(screen.getByText(/Правило требует прекратить работы/)).toBeInTheDocument();
    expect(screen.queryByText('Происшествий на смене нет')).not.toBeInTheDocument();
  });
});
