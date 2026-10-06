/**
 * F-R99 №10: при отказе добавления узла иерархии набранное название стиралось
 * из поля. Теперь оно очищается только при успехе.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { AddHierarchyDialog } from '../add-hierarchy-dialog';

describe('AddHierarchyDialog — имя сохраняется при отказе (находка 10)', () => {
  it('отказ → введённое название остаётся в поле', async () => {
    const onAdd = vi.fn().mockResolvedValue(false);
    render(<AddHierarchyDialog open onOpenChange={vi.fn()} type="picket" onAdd={onAdd} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ПК-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('ПК-12'));
    expect(screen.getByRole('textbox')).toHaveValue('ПК-12');
  });

  it('успех → поле очищается', async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<AddHierarchyDialog open onOpenChange={vi.fn()} type="picket" onAdd={onAdd} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ПК-13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });
});

describe('AddHierarchyDialog — доступное имя поля (F-R116-3)', () => {
  it('подпись «Название» связана с полем ввода', () => {
    render(<AddHierarchyDialog open onOpenChange={vi.fn()} type="picket" onAdd={vi.fn().mockResolvedValue(true)} />);

    // Прежде Label рисовался рядом без htmlFor — поле не имело имени для СР.
    expect(screen.getByLabelText('Название')).toBe(screen.getByRole('textbox'));
  });
});

/**
 * R121 №14: «Название» пикета/куста/поля не имело maxLength, хотя
 * createSiteHierarchySchema (src/lib/validation-schemas.ts) ограничивает его
 * 200 символами. Длинное название уходило на сервер и возвращало 400 без
 * имени поля, а форма проверяла только «не пусто».
 */
describe('AddHierarchyDialog — предел длины названия как в схеме (R121)', () => {
  it('название узла ограничено 200 знаками', () => {
    render(<AddHierarchyDialog open onOpenChange={vi.fn()} type="picket" onAdd={vi.fn().mockResolvedValue(true)} />);

    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '200');
  });
});