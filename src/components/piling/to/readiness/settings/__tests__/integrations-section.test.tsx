import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { IntegrationsSettings } from '../integrations-section';

beforeEach(() => {
  authFetchMock.mockResolvedValue({ ok: true, json: async () => ({ configs: [] }) });
});

describe('IntegrationsSettings — статусы устройств (W119 №2)', () => {
  it('показывает русские подписи всех реальных статусов и считает только активные устройства на связи', async () => {
    const statuses = [
      ['PROVISIONED', 'Ожидает подключения'],
      ['ACTIVE', 'На связи'],
      ['DEGRADED', 'Связь с перебоями'],
      ['OFFLINE', 'Нет связи'],
      ['ARCHIVED', 'Архив'],
    ];
    const devices = statuses.map(([status], index) => ({
      id: String(index), label: `Датчик ${index}`, provider: 'OTHER', status,
    }));
    render(<IntegrationsSettings devices={devices} bootstrap={null} />);
    await waitFor(() => expect(screen.queryByText('Проверяем подключение…')).not.toBeInTheDocument());

    statuses.forEach(([, label], index) => {
      const row = screen.getByText(`Датчик ${index}`).parentElement;
      if (!row) throw new Error('Не найдена строка устройства');
      expect(within(row).getByText(label)).toBeInTheDocument();
    });
    expect(screen.getByText('На связи 1 из 5')).toBeInTheDocument();
  });

  it('не показывает исправное подключение для устройства со связью с перебоями', async () => {
    render(<IntegrationsSettings devices={[
      { id: 'degraded', label: 'Датчик с перебоями', provider: 'OTHER', status: 'DEGRADED' },
    ]} bootstrap={null} />);
    await waitFor(() => expect(screen.queryByText('Проверяем подключение…')).not.toBeInTheDocument());

    expect(screen.getByText('Связь с перебоями')).toBeInTheDocument();
    expect(screen.queryByText('На связи 1 из 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Работает')).not.toBeInTheDocument();
  });
});
