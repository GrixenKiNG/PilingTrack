/**
 * AU73: сбой загрузки фото установки показывал обезличенное «Ошибка загрузки»
 * (а удаления — «Ошибка удаления») — человек не понимал, что произошло и что
 * делать. Теперь тост называет действие и подсказывает повторить. Серверную
 * причину (`error`) по-прежнему показываем как есть.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  authFetch: mocks.authFetch,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { EquipmentPhotos } from '../equipment-photos';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  mocks.authFetch.mockReset();
  vi.mocked(toast.error).mockClear();
});

describe('EquipmentPhotos — понятные тексты отказов (AU73)', () => {
  it('500 на выдаче ссылки без поля error → тост объясняет действие', async () => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json({}, 500) : json({ data: [] }),
    );

    const { container } = render(createElement(EquipmentPhotos, { equipmentId: 'eq-1' }));
    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalled());

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не удалось загрузить фото. Проверьте связь и повторите.',
    ));
  });
});
