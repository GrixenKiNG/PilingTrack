/**
 * F-R93-7 и F-R93-8: в разделе отчётов админки отказ удаления показывался как
 * «Ошибка удаления (403): {"error":"Доступ запрещён"}» (служебный JSON с кодом),
 * а обрыв сети при выгрузке — как браузерное «Failed to fetch». Проверяем
 * русские тексты и что 404 («уже удалён») отличается от 403.
 *
 * Тяжёлые дочерние компоненты подменены лёгкими заглушками: тест про сообщения
 * AdminReports, а не про вёрстку.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import type { ReportDTO } from '@/lib/types';

const { authFetchMock, reportsState } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
  reportsState: { current: {} as Record<string, unknown> },
}));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (s: { currentUser: { role: string }; actingAs: string | null }) => unknown) =>
    selector({ currentUser: { role: 'ADMIN' }, actingAs: null }),
}));
vi.mock('@/services/auth/authorization-service', () => ({ can: () => true }));
vi.mock('../use-reports-data', () => ({ useReportsData: () => reportsState.current }));
vi.mock('../use-report-history', () => ({
  useReportHistory: () => ({ data: null, loading: false, error: false }),
}));
vi.mock('../report-filters', () => ({ ReportFilters: () => null }));
vi.mock('../report-detail-dialog', () => ({ ReportDetailDialog: () => null }));
vi.mock('../report-form-dialog', () => ({ ReportFormDialog: () => null }));
vi.mock('../report-evidence-preview', () => ({ ReportEvidencePreview: () => null }));
vi.mock('@/components/piling/pdf-preview-dialog', () => ({ PdfPreviewDialog: () => null }));
vi.mock('@/components/piling/confirm-action-dialog', () => ({
  ConfirmActionDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button type="button" onClick={() => void onConfirm()}>Удалить отчёт</button> : null,
}));
vi.mock('../report-evidence-row', () => ({
  ReportsHeader: ({ onExport, onExportXlsx }: { onExport?: () => void; onExportXlsx?: () => void }) => (
    <div>
      <button type="button" onClick={onExport}>CSV</button>
      <button type="button" onClick={onExportXlsx}>Excel</button>
    </div>
  ),
  EvidenceSummary: () => null,
  EvidenceReportRow: ({ report, onDelete }: { report: ReportDTO; onDelete?: (r: ReportDTO) => void }) => (
    <div>
      <span>{report.reportId}</span>
      {onDelete ? <button type="button" onClick={() => onDelete(report)}>Удалить</button> : null}
    </div>
  ),
}));

import { AdminReports } from '../admin-reports';

const report = {
  id: 'r1',
  reportId: 'r1',
  date: '2026-09-01',
  status: 'submitted',
  piles: [],
  drillings: [],
  downtimes: [],
  user: { name: 'Иван' },
} as unknown as ReportDTO;

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    reports: [report],
    sites: [], operators: [], pileGrades: [], drillingTypes: [], downtimeReasons: [], equipment: [],
    filterSiteId: 'all', setFilterSiteId: vi.fn(),
    filterUserId: 'all', setFilterUserId: vi.fn(),
    periodFrom: '', setPeriodFrom: vi.fn(), periodTo: '', setPeriodTo: vi.fn(),
    periodActive: false, loading: false, loadingReferenceData: false, loadingMore: false,
    hasMore: false, totalReports: 1, serverSums: null,
    error: null, errorForbidden: false, loadMoreError: null, filterError: null, dictionaryError: null,
    handleApplyPeriod: vi.fn(), handleResetPeriod: vi.fn(),
    loadMoreReports: vi.fn(), loadReports: vi.fn(), loadReferenceData: vi.fn(),
    ...overrides,
  };
}

describe('AdminReports — удаление отчёта (F-R93-7)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    reportsState.current = baseState();
  });

  it('403 → текст про права, без служебного JSON и кода статуса', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Доступ запрещён' }),
    });

    render(<AdminReports />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить отчёт' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Отчёт не удалён: нет прав на удаление. Обратитесь к администратору.',
    ));
  });

  it('404 → «уже удалён», а не общая ошибка', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Отчёт не найден' }),
    });

    render(<AdminReports />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить отчёт' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Отчёт уже удалён — обновите список.'));
  });

  // F-R112-1: при обрыве сети fetch бросает TypeError, и тост печатал английское
  // «Failed to fetch» — на русском экране это не сообщение.
  it('обрыв сети при удалении → русский текст вместо «Failed to fetch» (F-R112-1)', async () => {
    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AdminReports />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить отчёт' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет соединения с сервером. Проверьте связь и повторите.',
    ));
  });
});

describe('AdminReports — выгрузка без сети (F-R93-8)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    reportsState.current = baseState();
  });

  it('обрыв сети → русский текст вместо «Failed to fetch»', async () => {
    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AdminReports />);
    // Фильтр «Сегодня» задаёт период, который нужен выгрузке.
    fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет связи с сервером. Выгрузка не выполнена — повторите при появлении сети.',
    ));
  });
});
