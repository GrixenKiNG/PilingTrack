/**
 * F-R93-5: «Скачать PDF» была обычной ссылкой <a href> на API. При 403/404/429/500
 * браузер уходил на JSON-тело ответа, и человек не понимал, где файл. Теперь
 * скачивание идёт через authFetch, а отказ показывается тостом с русским текстом.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import type { ReportDTO } from '@/lib/types';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('lucide-react', async (importActual) => ({
  ...(await importActual<typeof import('lucide-react')>()),
  CheckCircle2: () => null,
  Clock: () => null,
  Download: () => null,
  Drill: () => null,
  FileDown: () => null,
  FileText: () => null,
  HardHat: () => null,
  History: () => null,
  Pencil: () => null,
  Printer: () => null,
  X: () => null,
}));
vi.mock('@/components/piling/report-form/photo-section', () => ({
  PhotoSection: () => null,
}));

import { ReportEvidencePreview } from '../report-evidence-preview';

const report = {
  reportId: 'r1',
  date: '2026-09-01',
  status: 'submitted',
  shiftStart: '07:00',
  shiftEnd: '19:00',
  updatedAt: '2026-09-01T19:00:00.000Z',
  piles: [],
  drillings: [],
  downtimes: [],
} as unknown as ReportDTO;

function renderPreview() {
  render(
    <ReportEvidencePreview
      report={report}
      history={{ data: null, loading: false, error: false }}
      formatDate={(d) => d}
      onClose={vi.fn()}
      onPreviewPdf={vi.fn()}
      onPrint={vi.fn()}
    />,
  );
}

describe('ReportEvidencePreview — скачивание PDF (F-R93-5)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('429 от сервера показывается текстом, а не JSON в браузере', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Слишком много выгрузок подряд. Подождите пару минут.' }),
    });

    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: /Скачать/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Слишком много выгрузок подряд. Подождите пару минут.',
    ));
  });

  it('5xx без текста сервера — читаемый русский фолбэк', async () => {
    authFetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: /Скачать/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Не удалось скачать PDF (код 500).'));
  });

  it('обрыв сети — русский текст вместо «Failed to fetch»', async () => {
    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: /Скачать/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет связи с сервером. PDF не скачан — повторите при появлении сети.',
    ));
  });
});
