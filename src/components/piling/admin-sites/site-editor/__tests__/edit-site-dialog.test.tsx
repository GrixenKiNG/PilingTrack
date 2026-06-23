import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch }));
vi.mock('../pile-plan-section', () => ({ PilePlanSection: () => <div /> }));
vi.mock('../drilling-plan-section', () => ({ DrillingPlanSection: () => <div /> }));
vi.mock('../plan-summary', () => ({ PlanSummary: () => <div /> }));

import { EditSiteDialog } from '../edit-site-dialog';

describe('EditSiteDialog', () => {
  it('shows a retryable error and disables save when plans fail to load', async () => {
    authFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    render(<EditSiteDialog
      site={{ id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 1, plannedDrilling: 1 }}
      open onOpenChange={vi.fn()} loadingPileGrades={false} pileGrades={[]} onSave={vi.fn()}
    />);
    await waitFor(() => expect(screen.getByText('Не удалось загрузить планы объекта')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
