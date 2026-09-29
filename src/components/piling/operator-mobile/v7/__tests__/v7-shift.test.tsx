import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import type {ProductionEntryInput} from '../../api';
import {CloseFlow, ProductionFlow} from '../v7-shift';

/**
 * F-R43-1: смену нельзя закрыть, пока на телефоне лежат неотправленные записи.
 *
 * Закрытая смена отвечает отложенной выработке 409 «Смена уже закрыта», и в
 * отчёт она не попадает: сначала очередь, потом закрытие.
 */
const ready = {
  checklists: [{stage: 'EO_AFTER', done: true}],
} as unknown as OperatorMobileState;

describe('закрытие смены v7 при непустой очереди', () => {
  it('держит закрытие и предлагает отправить записи', () => {
    const onClose = vi.fn();
    const onFlush = vi.fn();
    render(
      <CloseFlow state={ready} busy={false} onChecklist={() => {}} onClose={onClose}
        onBack={() => {}} unsent={3} onFlush={onFlush} />,
    );

    expect(screen.getByText('Сначала отправьте записи с телефона: 3 не отправлено')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Закрыть смену'})).toBeDisabled();

    fireEvent.click(screen.getByRole('button', {name: 'Отправить сейчас'}));
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('закрывает смену, когда очередь пуста', () => {
    const onClose = vi.fn();
    render(
      <CloseFlow state={ready} busy={false} onChecklist={() => {}} onClose={onClose}
        onBack={() => {}} unsent={0} onFlush={() => {}} />,
    );

    expect(screen.queryByText(/Сначала отправьте записи/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Закрыть смену'}));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * F-R43-3c: паспорт сваи чистится по ответу сервера, а не по факту нажатия.
 *
 * Отказ 400/409 иначе уничтожал набранный журнал забивки — полтора десятка
 * полей по СП 45.13330, которые восстанавливают только по бумаге.
 */
const dictionaries = {
  dictionaries: {
    pileGrades: [{id: 'g1', name: 'С-300', lengthMm: 12000}],
    drillingTypes: [],
    downtimeReasons: [],
  },
} as unknown as OperatorMobileState;

describe('паспорт сваи v7 и отказ сервера', () => {
  const fill = async (onSubmit: (entry: ProductionEntryInput) => Promise<boolean>) => {
    render(
      <ProductionFlow state={dictionaries} busy={false} kind="PASSPORT"
        onSubmit={onSubmit} onBack={() => {}} />,
    );
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-130'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать сваю с паспортом'}));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  };

  it('отказ сервера оставляет форму заполненной', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    await fill(onSubmit);

    expect(screen.getByPlaceholderText('С-130')).toHaveValue('С-130');
  });

  it('принятую запись форма очищает', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    await fill(onSubmit);

    await waitFor(() => expect(screen.getByPlaceholderText('С-130')).toHaveValue(''));
  });
});