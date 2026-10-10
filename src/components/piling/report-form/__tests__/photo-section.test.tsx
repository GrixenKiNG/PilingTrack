/**
 * AU77: сбой загрузки и удаления фото отчёта показывал обезличенные «Ошибка
 * загрузки» / «Ошибка удаления» (а при отказе без поля `error` — «Загрузка не
 * удалась») — человек не понимал, что произошло и что делать. Теперь тост
 * называет действие и подсказывает повторить. Серверную причину (`error`)
 * по-прежнему показываем как есть.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  authFetch: mocks.authFetch,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { PhotoSection } from '../photo-section';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  mocks.authFetch.mockReset();
  vi.mocked(toast.error).mockClear();
});

describe('PhotoSection — понятные тексты отказов (AU77)', () => {
  it('500 на выдаче ссылки без поля error → тост объясняет действие', async () => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json({}, 500) : json({ data: [] }),
    );

    const { container } = render(<PhotoSection reportId="rep-1" />);
    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalled());

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не удалось загрузить фото. Проверьте связь и повторите.',
    ));
  });

  it('500 на удалении без поля error → тост объясняет действие', async () => {
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return json({}, 500);
      if (url.includes('/download')) return json({ url: 'https://cdn.example/x.jpg' });
      return json({ data: [{ id: 'm1', fileName: 'a.png', contentType: 'image/png', thumbnailKey: null }] });
    });

    render(<PhotoSection reportId="rep-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить фото' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не удалось удалить фото. Проверьте связь и повторите.',
    ));
  });
});
