import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportSentScreen } from '../report-sent-screen';

vi.mock('lucide-react', () => ({
  CheckCircle2: () => <div data-testid="check-icon" />,
}));

const baseProps = {
  siteName: 'Ленина 12',
  date: '2026-05-29',
  time: '14:32',
  totalPiles: 24,
  totalPileMeters: 312,
  totalDrillingCount: 8,
  totalMeters: 96,
  totalDowntime: 0,
  hasDowntime: false,
  onDone: vi.fn(),
};

describe('ReportSentScreen', () => {
  it('shows confirmation heading, time and the shift summary', () => {
    render(<ReportSentScreen {...baseProps} />);

    expect(screen.getByText('Отчёт отправлен!')).toBeTruthy();
    expect(screen.getByText(/14:32/)).toBeTruthy();
    expect(screen.getByText('Ленина 12')).toBeTruthy();
    expect(screen.getByText('29.05.2026')).toBeTruthy();
    expect(screen.getByText('24 шт. / 312 м.п.')).toBeTruthy();
    expect(screen.getByText('8 шт. / 96 м.п.')).toBeTruthy();
  });

  it('hides the downtime row when there is no downtime', () => {
    render(<ReportSentScreen {...baseProps} />);
    expect(screen.queryByText('Простой')).toBeNull();
  });

  it('shows the downtime row when present', () => {
    render(<ReportSentScreen {...baseProps} hasDowntime totalDowntime={2.5} />);
    expect(screen.getByText('Простой')).toBeTruthy();
    expect(screen.getByText('2,5 ч')).toBeTruthy();
  });

  it('calls onDone when "Готово" is pressed', () => {
    const onDone = vi.fn();
    render(<ReportSentScreen {...baseProps} onDone={onDone} />);
    fireEvent.click(screen.getByText('Готово'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
