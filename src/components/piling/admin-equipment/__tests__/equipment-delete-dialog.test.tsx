/**
 * F-R113-2: окно удаления установки говорило только «Удаление может повлиять на
 * связанные записи», хотя `DELETE /api/equipment/[id]` отказывается удалять
 * установку с историей (409, «выведите её из эксплуатации») и жёстко удаляет
 * только запись без истории. Теперь окно прямо говорит, что будет с данными,
 * а на время запроса заблокированы обе кнопки — повторное нажатие не отправит
 * второй запрос.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreateEquipmentDialog, DeleteEquipmentDialog, EditEquipmentDialog } from '../equipment-dialogs';
import type { EquipmentDTO } from '@/lib/types';

const item: EquipmentDTO = {
  id: 'eq-1',
  name: 'СП-49',
  model: '',
  qty: 1,
  isActive: true,
  description: '',
};

function renderDialog(onConfirm: (id: string) => Promise<void>, crewCount = 0) {
  render(
    <DeleteEquipmentDialog
      open
      item={item}
      crewCount={crewCount}
      onOpenChange={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
}

describe('DeleteEquipmentDialog — удаление установки (F-R113-2)', () => {
  it('окно объясняет, что будет с данными: с историей удаление отклонят', () => {
    renderDialog(vi.fn());

    const text = screen.getByText(/без возможности восстановления/).textContent ?? '';
    expect(text).toMatch(/за которой нет истории/);
    expect(text).toMatch(/удаление отклонится, а данные/);
    expect(text).toMatch(/вывести из эксплуатации/);
  });

  it('предупреждение о бригадах говорит про отказ, а не «может повлиять»', () => {
    renderDialog(vi.fn(), 2);

    expect(screen.getByText(/используется в/)).toBeInTheDocument();
    expect(screen.getByText(/Удаление будет отклонено/)).toBeInTheDocument();
    expect(screen.queryByText(/может повлиять на связанные записи/)).not.toBeInTheDocument();
  });

  it('пока запрос идёт, кнопки заблокированы, а второй клик не шлёт второй запрос', () => {
    const onConfirm = vi.fn(() => new Promise<void>(() => {}));
    renderDialog(onConfirm);

    const confirm = screen.getByRole('button', { name: 'Удалить навсегда' });
    const cancel = screen.getByRole('button', { name: 'Отмена' });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
  });
});

/*
  F-R119-3: диалоги создания/правки установки закрывались по Esc, клику вне окна
  и «Отмена» без вопроса — введённые, но не сохранённые данные терялись молча.
  Теперь, пока форма «грязная» (состояние отличается от загруженного), закрытие
  просит подтверждение, а уход со страницы перехватывает beforeunload
  (образец — layout-editor.tsx, F-R108-2; без правок вопроса нет).
*/
describe('диалоги установки: защита от потери несохранённых правок (F-R119-3)', () => {
  let confirmMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderEdit(onOpenChange = vi.fn()) {
    render(<EditEquipmentDialog open item={item} onOpenChange={onOpenChange} onSubmit={vi.fn()} />);
    return onOpenChange;
  }

  function renderCreate(onOpenChange = vi.fn()) {
    render(<CreateEquipmentDialog open onOpenChange={onOpenChange} onSubmit={vi.fn()} />);
    return onOpenChange;
  }

  it('правка: без изменений «Отмена» закрывает без вопроса', () => {
    const onOpenChange = renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(confirmMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('правка: изменённое поле — «Отмена» спрашивает и при отказе не закрывает', () => {
    const onOpenChange = renderEdit();

    fireEvent.change(screen.getByLabelText('Название *'), { target: { value: 'СП-49 (ремонт)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('правка: при подтверждении диалог закрывается', () => {
    const onOpenChange = renderEdit();

    fireEvent.change(screen.getByLabelText('Название *'), { target: { value: 'СП-49 (ремонт)' } });
    confirmMock.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('создание: введённое название защищено вопросом', () => {
    const onOpenChange = renderCreate();

    fireEvent.change(screen.getByLabelText('Название *'), { target: { value: 'Новая установка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('правка: уход со страницы перехватывается, пока есть правки', () => {
    renderEdit();

    const clean = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(clean)).toBe(true);

    fireEvent.change(screen.getByLabelText('Название *'), { target: { value: 'СП-49 (ремонт)' } });

    const dirty = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(dirty)).toBe(false);
    expect(dirty.defaultPrevented).toBe(true);
  });
});