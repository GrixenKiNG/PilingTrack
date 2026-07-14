import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PILING_ICON_NAMES, PILING_ICON_SCALE, PilingIcon } from '../piling-icon';

describe('PilingIcon', () => {
  it('renders every catalog entry with an approved raster or utility SVG', () => {
    const { container } = render(
      <div>
        {PILING_ICON_NAMES.map((name) => (
          <PilingIcon key={name} name={name} decorative />
        ))}
      </div>,
    );

    expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    for (const name of PILING_ICON_NAMES) {
      expect(container.querySelector(`[data-piling-icon="${name}"]`)).toBeInTheDocument();
    }
  });

  it('hides decorative icons from assistive technology', () => {
    render(<PilingIcon name="inspection" decorative />);
    expect(document.querySelector('[data-piling-icon="inspection"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes the label of a standalone meaningful icon', () => {
    render(<PilingIcon name="defect" label="Зафиксирован дефект" />);
    expect(screen.getByRole('img', { name: 'Зафиксирован дефект' })).toBeInTheDocument();
  });

  it('applies the global 150% size scale to raster and utility icons', () => {
    const { container } = render(
      <div>
        <PilingIcon name="inspection" size={24} decorative />
        <PilingIcon name="add" size={24} decorative />
      </div>,
    );

    expect(container.querySelector('[data-piling-icon="inspection"]')).toHaveStyle({
      width: `${24 * PILING_ICON_SCALE}px`,
      height: `${24 * PILING_ICON_SCALE}px`,
    });
    expect(container.querySelector('[data-piling-icon="add"]')).toHaveAttribute(
      'width',
      String(24 * PILING_ICON_SCALE),
    );
  });
});
