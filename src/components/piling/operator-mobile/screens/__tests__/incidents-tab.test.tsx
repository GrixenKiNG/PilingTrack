import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
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
