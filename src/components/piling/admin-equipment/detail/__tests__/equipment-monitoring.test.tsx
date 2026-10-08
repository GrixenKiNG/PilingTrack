import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));

import { EquipmentMonitoring } from '../equipment-monitoring';

beforeEach(() => {
  vi.stubEnv('TZ', 'UTC');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T21:30:00.000Z'));
  authFetchMock.mockReset();
  authFetchMock.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function expectLastWindow(from: string, to: string) {
  const url = String(authFetchMock.mock.calls.at(-1)?.[0]);
  const params = new URL(url, 'http://localhost').searchParams;
  expect(params.get('from')).toBe(from);
  expect(params.get('to')).toBe(to);
}

describe('EquipmentMonitoring — сутки Москвы (W126 №9)', () => {
  it('открывает последние семь календарных дней организации и их точные границы', () => {
    render(<EquipmentMonitoring equipmentId="eq-1" />);
    expect(screen.getByLabelText('С')).toHaveValue('2026-09-20');
    expect(screen.getByLabelText('По')).toHaveValue('2026-09-26');
    expectLastWindow('2026-09-19T21:00:00.000Z', '2026-09-26T20:59:59.999Z');
  });

  it('для вручную выбранного дня передаёт ISO границы с прежним включительным окончанием', () => {
    render(<EquipmentMonitoring equipmentId="eq-1" />);
    fireEvent.change(screen.getByLabelText('С'), { target: { value: '2026-09-26' } });
    fireEvent.change(screen.getByLabelText('По'), { target: { value: '2026-09-26' } });
    expectLastWindow('2026-09-25T21:00:00.000Z', '2026-09-26T20:59:59.999Z');
    expect(screen.getByLabelText('С')).toHaveValue('2026-09-26');
  });
});
