/**
 * Regression: pile metres shown in the report detail popup must come from
 * PileGrade.lengthMm (src/lib/pile-length.ts), not a 3-digit regex on the
 * grade name. "С90.30" has no 3-consecutive-digit run (old behaviour: 0 м.п.)
 * but a real lengthMm of 9000 — the same report's PDF and the reports-list
 * totals already compute via lengthMm and would show 45.0 м.п. for 5 piles.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReportDTO } from '@/lib/types';

vi.mock('lucide-react', async (importActual) => ({
  ...(await importActual<typeof import('lucide-react')>()),
  HardHat: () => null,
  Drill: () => null,
  Clock: () => null,
  Eye: () => null,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/piling/report-form/photo-section', () => ({
  PhotoSection: () => null,
}));

import { ReportDetailDialog } from '../report-detail-dialog';

const report = {
  reportId: 'r1',
  date: '2026-06-21',
  piles: [{ id: 'p1', count: 5, pileGradeId: 'g1', pileGrade: { name: 'С90.30', lengthMm: 9000 } }],
  drillings: [],
  downtimes: [],
} as unknown as ReportDTO;

describe('ReportDetailDialog — pile meters', () => {
  it('computes pile meters from PileGrade.lengthMm, not a 3-digit regex on the name', () => {
    render(
      <ReportDetailDialog
        report={report}
        onClose={vi.fn()}
        onPreviewPdf={vi.fn()}
        formatDate={(d) => d}
        formatLastEditor={() => '—'}
      />,
    );

    // 9000mm / 1000 = 9.0 m/pile × 5 = 45.0 м.п. The old name-regex on "С90.30"
    // finds no 3-consecutive-digit run and would render "0.0 м.п." instead.
    expect(screen.getByText('45.0 м.п.')).toBeTruthy();
  });
});
