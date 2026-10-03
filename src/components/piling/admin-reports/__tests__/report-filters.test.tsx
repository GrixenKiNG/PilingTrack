/**
 * R116 #11: три фильтра журнала отчётов различались только placeholder
 * («Все объекты / Все установки / Все операторы») — назначение фильтра
 * скринридеру не сообщалось. Отдельный файл, потому что admin-reports.test.tsx
 * подменяет ReportFilters заглушкой.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReportFilters } from '../report-filters';

describe('фильтры журнала отчётов: назначение озвучивается (R116 #11)', () => {
  const props = {
    sites: [{ id: 's1', name: 'Объект 1' }],
    filterSiteId: 'all',
    onFilterSiteChange: vi.fn(),
    equipment: [{ id: 'e1', name: 'СП-49' }],
    filterEquipmentId: 'all',
    onFilterEquipmentChange: vi.fn(),
    operators: [{ id: 'u1', name: 'Иванов И.' }],
    filterUserId: 'all',
    onFilterUserChange: vi.fn(),
  };

  it('объект, установка и оператор имеют доступное имя', () => {
    render(<ReportFilters {...props} />);

    expect(screen.getByLabelText('Фильтр по объекту')).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByLabelText('Фильтр по установке')).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByLabelText('Фильтр по оператору')).toBeInstanceOf(HTMLButtonElement);
  });
});