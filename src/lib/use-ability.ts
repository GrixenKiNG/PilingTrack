'use client';
import { usePilingStore } from '@/lib/store';
import { can, type Ability } from '@/services/auth/authorization-service';

export function useAbility(ability: Ability): boolean {
  const role = usePilingStore(state => state.currentUser?.role ?? '');
  const actingAs = usePilingStore(state => state.actingAs);
  return can({ role, actingAs }, ability);
}
