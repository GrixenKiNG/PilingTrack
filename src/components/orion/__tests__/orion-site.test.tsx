import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../orion-site.module.css', () => ({
  default: new Proxy({}, { get: () => 'orion-test-class' }),
}));
import { OrionSite } from '../orion-site';
import { orionEquipment, orionStories } from '../orion-content';

describe('ORION public site', () => {
  it('uses the eight confirmed fleet units and no fictional project stories', () => {
    expect(orionEquipment.map(({ name }) => name)).toEqual([
      'PVE 50PR',
      'Liebherr LRH 100 №1',
      'Liebherr LRH 100 №2',
      'КБУРГ-16.02 №1',
      'КБУРГ-16.02 №2',
      'Kopernik-SD-20',
      'Banut 655',
      'Bauer RTG RM20',
    ]);
    expect(orionStories).toEqual([]);
  });

  it('offers an engineering consultation and labels future project stories honestly', () => {
    render(<OrionSite />);
    expect(screen.getByRole('heading', { level: 1, name: /держатся большие проекты/i })).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: /обсудить объект/i })) {
      expect(link).toHaveAttribute('href', '#contact');
    }
    expect(screen.getByText(/готовим портфолио реализованных объектов/i)).toBeInTheDocument();
  });
});
