import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrionHandoffSite } from '../orion-handoff-site';

vi.mock('next/image', () => ({
  // `alt` вынут из props явно: при простом расплющивании линтер не видит его в
  // разметке и требует alt-текст. Заглушка next/image обязана донести alt до
  // <img>, иначе тесты доступности проверяли бы картинку без подписи.
  default: ({ fill: _fill, priority: _priority, fetchPriority: _fetchPriority, alt, ...props }: Record<string, unknown>) => (
    <img alt={typeof alt === 'string' ? alt : ''} {...props} />
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
    // Заголовки раздела объектов переименованы 23.08.2026: они дословно
    // совпадали с этапами раздела «Как мы работаем», и в оглавлении страницы
    // (а для скринридера — в списке заголовков) это были неразличимые пункты.
    // Проверяем именно уникальность, иначе дубли вернутся незамеченными.
    for (const name of ['Что было на входе', 'Как выполняли', 'Что получилось']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
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
