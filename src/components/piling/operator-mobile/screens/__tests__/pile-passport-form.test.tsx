import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {PilePassportForm} from '../pile-passport-form';

const grades = [{id: 'g1', name: 'С 100.30-8', lengthMm: 3000}];

describe('форма паспорта сваи', () => {
  it('без номера сваи называет недостающее под неактивной кнопкой', () => {
    render(<PilePassportForm grades={grades} busy={false} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'g1'}});

    expect(screen.getByRole('button', {name: 'Записать сваю с паспортом'})).toBeDisabled();
    expect(screen.getByText(/Не заполнено:/)).toHaveTextContent('номер сваи');
  });

  it('когда марка и номер сваи заполнены — строки с недостающим нет', () => {
    render(<PilePassportForm grades={grades} busy={false} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-130'}});

    expect(screen.getByRole('button', {name: 'Записать сваю с паспортом'})).toBeEnabled();
    expect(screen.queryByText(/Не заполнено:/)).not.toBeInTheDocument();
  });

  it('показывает отказ и подробности над кнопкой записи', () => {
    render(<PilePassportForm grades={grades} busy={false} onSubmit={vi.fn()}
      error="Паспорт заполнен не полностью" errorDetails={['Номер сваи не заполнен']} />);

    const note = screen.getByText('Паспорт заполнен не полностью');
    expect(screen.getByText('Номер сваи не заполнен')).toBeInTheDocument();

    const button = screen.getByRole('button', {name: 'Записать сваю с паспортом'});
    expect(note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('без error отказ не рисуется', () => {
    render(<PilePassportForm grades={grades} busy={false} onSubmit={vi.fn()} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
