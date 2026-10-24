import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetch, toast } = vi.hoisted(() => ({
  authFetch: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ authFetch }));
vi.mock('sonner', () => ({ toast }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/piling/ops-shell', () => ({ useDocumentTitle: () => undefined }));

import { TemplateList } from '../template-list';

const active = { id: 'a1', name: 'ЕО — установка Liebherr LRH 100', level: 'EO', appliesToModel: 'LRH 100', isActive: true };
const off = { id: 'o1', name: 'ТО-1 (100 ч) — Liebherr LRH 100', level: 'TO1', appliesToModel: 'LRH 100', isActive: false };

const answer = (templates: unknown[], ok = true, status = 200) => ({ ok, status, json: async () => ({ templates }) });

beforeEach(() => {
  authFetch.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

describe('TemplateList — отключённые шаблоны', () => {
  it('показывает отключённые шаблоны отдельным списком с кнопкой «Включить»', async () => {
    authFetch.mockImplementation(async (url: string) => (url.includes('inactive=1') ? answer([off]) : answer([active])));
    render(<TemplateList />);

    expect(await screen.findByText('Отключённые шаблоны (1)')).toBeInTheDocument();
    expect(screen.getByText('ТО-1 (100 ч) — Liebherr LRH 100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Включить шаблон «ТО-1/ })).toBeInTheDocument();
  });

  it('«Включить» вызывает POST и перечитывает списки', async () => {
    authFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return url.includes('inactive=1') ? answer([off]) : answer([active]);
    });
    render(<TemplateList />);
    fireEvent.click(await screen.findByRole('button', { name: /Включить шаблон/ }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/checklist-templates/o1/activate', { method: 'POST' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Шаблон включён'));
  });

  it('отказ сервера (409) показывает его текст, а не общий', async () => {
    const text = 'Для этой модели и вида ТО уже действует шаблон «Новый ТО-1».';
    authFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return { ok: false, status: 409, json: async () => ({ error: text }) };
      return url.includes('inactive=1') ? answer([off]) : answer([active]);
    });
    render(<TemplateList />);
    fireEvent.click(await screen.findByRole('button', { name: /Включить шаблон/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(text));
  });

  it('если отключённые не прочитались, блока нет, а основной список на месте', async () => {
    authFetch.mockImplementation(async (url: string) => (url.includes('inactive=1') ? answer([], false, 500) : answer([active])));
    render(<TemplateList />);

    expect(await screen.findByText('ЕО — установка Liebherr LRH 100')).toBeInTheDocument();
    expect(screen.queryByText(/Отключённые шаблоны/)).not.toBeInTheDocument();
  });
});
