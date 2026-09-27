import {render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {usePilingStore} from '@/lib/store';
import {enqueue} from './offline-queue';
import {OfflineQueueBanner} from './offline-queue-banner';

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    },
  });
});

describe('плашка очереди на общем телефоне', () => {
  it('сменщику видно, что записи прежнего машиниста не отправлены (R43 №2)', () => {
    usePilingStore.setState({currentUser: {id: 'op-day', name: 'Иванов И.'} as never});
    enqueue({command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES'}} as never);
    usePilingStore.setState({currentUser: {id: 'op-night', name: 'Петров П.'} as never});

    render(<OfflineQueueBanner items={[]} onRetry={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toContain('другого сотрудника (Иванов И.): 1');
    usePilingStore.setState({currentUser: null});
  });
});
