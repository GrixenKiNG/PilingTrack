import type { Dispatch, SetStateAction } from 'react';
import { type WorkspaceIssue, readOptionalJsonWithIssue } from './to-module-data';
import type { ReadinessBootstrap } from './readiness/api/contracts';
import { type EquipmentDetailSnapshot } from './readiness-reference-ui';
import type { EquipmentOption } from './to-module-bits';
import type { JournalRecord } from './to-stats';
import { can } from '@/services/auth/authorization-service';
import { resolveEffectiveRole } from '@/lib/types';

interface SelectedEquipmentBindings {
  actor: ReadinessBootstrap['actor'] | undefined;
  equipmentId: string;
  loadAttempts: Record<string, { journal: boolean; card: boolean; }>;
  journalLoaded: Record<string, boolean>;
  details: Record<string, EquipmentDetailSnapshot>;
  equipment: EquipmentOption[];
  setLoadAttempts: Dispatch<SetStateAction<Record<string, { journal: boolean; card: boolean; }>>>;
  setJournals: Dispatch<SetStateAction<Record<string, JournalRecord[]>>>;
  setJournalLoaded: Dispatch<SetStateAction<Record<string, boolean>>>;
  setDetails: Dispatch<SetStateAction<Record<string, EquipmentDetailSnapshot>>>;
  setWorkspaceIssues: Dispatch<SetStateAction<WorkspaceIssue[]>>;
}

export function loadSelectedToEquipment({ actor, equipmentId, loadAttempts, journalLoaded, details, equipment, setLoadAttempts, setJournals, setJournalLoaded, setDetails, setWorkspaceIssues }: SelectedEquipmentBindings) {
    if (!equipmentId || !actor) return;
    if (resolveEffectiveRole(actor.role, actor.actingAs) === 'OPERATOR') return;
    const mayReadJournal = can(actor, 'maintenance.manage');
    const mayReadCard = can(actor, 'equipment.read');
    const attempted = loadAttempts[equipmentId] ?? { journal: false, card: false };
    const needJournal = mayReadJournal && journalLoaded[equipmentId] !== true && !attempted.journal;
    const needCard = mayReadCard && details[equipmentId] === undefined && !attempted.card;
    if (!needJournal && !needCard) return;
    const name = equipment.find((item) => item.id === equipmentId)?.name ?? equipmentId;
    let active = true;
    void Promise.all([
      needJournal
        ? readOptionalJsonWithIssue<{ records?: JournalRecord[] }>(
            `/api/to/journal?equipmentId=${encodeURIComponent(equipmentId)}`,
            `Журнал «${name}»`,
          )
        : Promise.resolve({ data: null, issue: null }),
      needCard
        ? readOptionalJsonWithIssue<EquipmentDetailSnapshot>(
            `/api/equipment/${encodeURIComponent(equipmentId)}/details`,
            `Карточка «${name}»`,
          )
        : Promise.resolve({ data: null, issue: null }),
    ]).then(([journal, detail]) => {
      if (!active) return;
      setLoadAttempts((previous) => ({
        ...previous,
        [equipmentId]: { journal: true, card: true },
      }));
      if (needJournal) {
        setJournals((previous) => ({ ...previous, [equipmentId]: journal.data?.records ?? [] }));
        setJournalLoaded((previous) => ({ ...previous, [equipmentId]: journal.data != null }));
      }
      const nextDetail = detail.data;
      if (needCard && nextDetail) {
        setDetails((previous) => ({ ...previous, [equipmentId]: nextDetail }));
      }
      const issues = [journal.issue, detail.issue]
        .filter((issue): issue is WorkspaceIssue => issue !== null);
      if (issues.length > 0) setWorkspaceIssues((previous) => [...previous, ...issues]);
    });
    return () => { active = false; };
  }
