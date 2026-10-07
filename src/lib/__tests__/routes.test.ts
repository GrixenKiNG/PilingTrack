import { describe, it, expect } from 'vitest';
import { roleHomeRoute, OPERATOR_HOME_ROUTE, ASSISTANT_HOME_ROUTE } from '../routes';

describe('roleHomeRoute', () => {
  // Инженер ОТ работает в «ТБ и допуски» — это его первый пункт меню, туда и
  // должен вести вход и корневой редирект (W10, находка 3 отчёта W1-ROLE-ROUTES).
  it('sends SAFETY_ENGINEER to the safety module first', () => {
    expect(roleHomeRoute('SAFETY_ENGINEER')).toBe('/admin/safety');
  });

  it('sends the office roles to the admin dashboard', () => {
    expect(roleHomeRoute('ADMIN')).toBe('/admin');
    expect(roleHomeRoute('DISPATCHER')).toBe('/admin');
    expect(roleHomeRoute('FOREMAN')).toBe('/admin');
  });

  it('sends MECHANIC to the technical readiness centre', () => {
    expect(roleHomeRoute('MECHANIC')).toBe('/admin/to');
  });

  it('sends ASSISTANT to its own clearance workspace', () => {
    expect(roleHomeRoute('ASSISTANT')).toBe(ASSISTANT_HOME_ROUTE);
  });

  it('falls back to the operator workspace for unknown roles', () => {
    expect(roleHomeRoute('OPERATOR')).toBe(OPERATOR_HOME_ROUTE);
    expect(roleHomeRoute('SOMETHING')).toBe(OPERATOR_HOME_ROUTE);
  });
});
