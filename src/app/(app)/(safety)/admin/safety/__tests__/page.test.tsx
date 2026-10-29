import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'ASSISTANT' }));
vi.mock('@/lib/page-session', () => ({ readPageSessionUser: vi.fn(async () => ({ role: state.role })) }));
vi.mock('@/components/piling/to/to-module', () => ({ ToModule: vi.fn(() => null) }));
vi.mock('@/components/piling/to/readiness/screens/my-clearance-screen', () => ({ MyClearanceScreen: vi.fn(() => null) }));

import SafetyPage from '../page';
import { ToModule } from '@/components/piling/to/to-module';
import { MyClearanceScreen } from '@/components/piling/to/readiness/screens/my-clearance-screen';

describe('safety page: personal clearance without park bootstrap', () => {
  beforeEach(() => { state.role = 'ASSISTANT'; });

  it('ASSISTANT opens personal clearance without the forbidden readiness workspace', async () => {
    const page = await SafetyPage();
    expect(page.type).toBe(MyClearanceScreen);
  });

  it.each(['ADMIN', 'DISPATCHER', 'OPERATOR', 'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER'])('%s retains the capability-controlled workspace', async role => {
    state.role = role;
    const page = await SafetyPage();
    expect(page.type).toBe(ToModule);
    expect(page.props.surface).toBe('safety');
  });
});
