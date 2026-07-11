import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkspaceSettings } from '../workspace-settings';

describe('WorkspaceSettings', () => {
  it('switches notification preferences without leaving the settings screen', () => {
    render(<WorkspaceSettings />);

    expect(screen.getByRole('heading', { name: 'Настройки' })).toBeInTheDocument();
    expect(screen.getByTestId('operations-settings')).toHaveClass('space-y-6');
    expect(screen.getByTestId('operations-settings')).not.toHaveClass('operations-dark');
    const downtimeToggle = screen.getByRole('switch', { name: 'Простой оборудования' });

    expect(downtimeToggle).toHaveAttribute('data-state', 'checked');
    fireEvent.click(downtimeToggle);
    expect(downtimeToggle).toHaveAttribute('data-state', 'unchecked');
  });
});
