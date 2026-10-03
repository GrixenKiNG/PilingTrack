/**
 * F-R113-2: окно удаления установки говорило только «Удаление может повлиять на
 * связанные записи», хотя `DELETE /api/equipment/[id]` отказывается удалять
 * установку с историей (409, «выведите её из эксплуатации») и жёстко удаляет
 * только запись без истории. Теперь окно прямо говорит, что будет с данными,
 * а на время запроса заблокированы обе кнопки — повторное нажатие не отправит
 * второй запрос.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DeleteEquipmentDialog } from '../equipment-dialogs';
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