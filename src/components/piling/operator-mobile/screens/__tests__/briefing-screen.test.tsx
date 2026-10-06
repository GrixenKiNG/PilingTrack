import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {BriefingScreen} from '../briefing-screen';

describe('экран инструктажа', () => {
  it('показывает отказ сервера — иначе машинист не знает, почему не попал в допуск', () => {
    render(
      <BriefingScreen
        busy={false}
        error="Смена ещё не открыта"
        onAcknowledge={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Смена ещё не открыта')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Прочитал и ознакомлен'})).toBeInTheDocument();
  });

  it('без отказа заметки не рисует', () => {
    render(<BriefingScreen busy={false} error={null} onAcknowledge={vi.fn()} onBack={vi.fn()} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
