import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {AdminCrews} from '../admin-crews';

vi.mock('@/lib/use-ability', () => ({useAbility: () => true}));
vi.mock('@/components/piling/ops-shell/permitted-entity-history', () => ({PermittedEntityHistory: () => null}));
vi.mock('../use-crews-data', () => ({useCrewsData: () => ({
  crews: [], setCrews: vi.fn(), equipmentList: [], sites: [], loading: false, loadError: null,
  reloadCrews: vi.fn(), referenceError: null, loadingReferenceData: false, loadReferenceData: vi.fn(),
  availableOperators: [], assistantUsers: [], activeEquipment: [], activeSites: [],
  toggleActive: vi.fn(), createCrew: vi.fn(), updateCrew: vi.fn(), deleteCrew: vi.fn(),
})}));

it('возвращает фокус на кнопку открытия после Escape в настоящем диалоге', async () => {
  render(<AdminCrews />);
  const trigger = screen.getByRole('button', {name: 'Добавить бригаду'});
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', {name: 'Новая бригада'});
  fireEvent.keyDown(dialog, {key: 'Escape'});
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});
