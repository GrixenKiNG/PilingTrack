import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrionHandoffSite } from '../orion-handoff-site';

vi.mock('next/image', () => ({
  default: ({ fill: _fill, priority: _priority, fetchPriority: _fetchPriority, ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} />
  ),
}));

vi.mock('../orion-handoff-site.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, property) => property === 'then' ? undefined : String(property),
  }),
}));
vi.mock('../orion-editorial.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, property) => property === 'then' ? undefined : String(property),
  }),
}));
vi.mock('../orion-cinematic-gallery.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, property) => property === 'then' ? undefined : String(property),
  }),
}));

describe('ORION production site', () => {
  it('uses confirmed evidence and keeps future object stories honest', () => {
    render(<OrionHandoffSite />);

    expect(screen.getByRole('heading', { level: 1, name: /основания для больших проектов/i })).toBeInTheDocument();
    expect(screen.getByText('единиц подтверждённого парка')).toBeInTheDocument();
    expect(screen.getByText('аренда с оператором')).toBeInTheDocument();
    expect(screen.getByText('русскоязычные карточки техники')).toBeInTheDocument();
    expect(screen.queryByText('24/7')).not.toBeInTheDocument();
    expect(screen.queryByText(/с 2006/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Верховный Суд/i)).not.toBeInTheDocument();

    expect(screen.getByRole('heading', {
      name: /только реальные объекты и подтверждённые результаты/i,
    })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Исходные данные' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: 'Производство' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Подтверждённый результат' })).toBeInTheDocument();
  });

  it('exposes the cinematic gallery, eight keyboard tabs and an Escape-safe menu', () => {
    render(<OrionHandoffSite />);

    expect(screen.getByLabelText('Кинематографическая галерея моделей техники')).toBeInTheDocument();
    const tablist = screen.getByRole('tablist', { name: 'Установки ОРИОН' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(8);

    fireEvent.click(within(tablist).getByRole('tab', { name: /Bauer RTG RM20/i }));
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Bauer RTG RM20' })).toBeInTheDocument();

    const menuButton = screen.getByRole('button', { name: 'Открыть меню' });
    fireEvent.click(menuButton);
    expect(screen.getByRole('navigation', { name: 'Мобильная навигация' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Мобильная навигация' })).not.toBeInTheDocument();
  });
});
