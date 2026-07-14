/**
 * Regression: the live "Итого" pile-meters total in the report form must come
 * from PileGrade.lengthMm (src/lib/pile-length.ts), not a 3-digit regex on the
 * grade name. "С90.30" has no 3-consecutive-digit run (old behaviour: 0 м.п.)
 * but a real lengthMm of 9000 — the same report's PDF and the reports-list
 * totals already compute via lengthMm and would show 45.0 м.п. for 5 piles.
 *
 * Prefilling via editReport (instead of driving the grade Select) avoids
 * needing to mount Radix Select interaction, which has no test precedent in
 * this codebase yet.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReportDTO } from '@/lib/types';

vi.mock('lucide-react', async (importActual) => ({
  ...(await importActual<typeof import('lucide-react')>()),
  Plus: () => null,
  Pencil: () => null,
  Trash2: () => null,
  HardHat: () => null,
  Drill: () => null,
  Clock: () => null,
  Wrench: () => null,
  Loader2: () => null,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));
vi.mock('@/components/piling/report-form/photo-section', () => ({
  PhotoSection: () => null,
}));

import { ReportFormDialog } from '../report-form-dialog';

const editReport = {
  id: 'r1',
  reportId: 'r1',
  userId: 'u1',
  siteId: 's1',
  date: '2026-06-21',
  piles: [{ id: 'p1', pileGradeId: 'g1', count: 5 }],
  drillings: [],
  downtimes: [],
} as unknown as ReportDTO;

describe('ReportFormDialog — pile meters total', () => {
  it('computes the total from PileGrade.lengthMm, not a 3-digit regex on the name', () => {
    render(
      <ReportFormDialog
        open
        onClose={vi.fn()}
        editReport={editReport}
        loadingReferenceData={false}
        operators={[]}
        sites={[]}
        pileGrades={[{ id: 'g1', name: 'С90.30', isActive: true, lengthMm: 9000 }]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    // 9000mm / 1000 = 9.0 m/pile × 5 = 45.0 м.п. The old name-regex on "С90.30"
    // finds no 3-consecutive-digit run and would render "5 шт. / 0.0 м.п." instead.
    expect(screen.getByText('5 шт. / 45.0 м.п.')).toBeTruthy();
  });
});
