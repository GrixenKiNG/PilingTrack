import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { type ReadinessFacts, type ReadinessRulesState, type ReadinessScoreResult } from '@/modules/readiness';
import type { EquipmentOption } from '../../to-module-bits';
import { type JournalRecord } from '../../to-stats';
import type { EquipmentReadiness } from '../../readiness-model';
import type { CrewSummary, MaintenanceSummary } from '../../readiness-design-views';
import type { CurrentReadinessDto, ReadinessAuditEnvelope, ReadinessBootstrap, ReadinessShiftDto, ReadinessSnapshotDto, WorkPermitDto } from '../api/contracts';
import { type ReadinessUrlFilters } from '../api/client';

export type ReferenceView =
  | 'readiness'
  | 'fleet'
  | 'shifts'
  | 'permits'
  | 'maintenance'
  | 'reports'
  | 'settings';

export type SettingsSection =
  | 'rules'
  | 'checklists'
  | 'roles'
  | 'dictionaries'
  | 'notifications'
  | 'integrations'
  | 'audit';

export interface EquipmentDetailSnapshot {
  equipment?: {
    id: string;
    name: string;
    serialNumber?: string | null;
    inventoryNumber?: string | null;
    engineHoursTotal?: number | null;
    nextMaintenanceAtHours?: number | null;
    nextMaintenanceDate?: string | null;
  };
  crew?: {
    id: string;
    name: string;
    operator?: { id: string; name: string } | null;
    site?: { id: string; name: string } | null;
  } | null;
  /** Последний осмотр установки: пункты шаблона и сколько из них заполнено. */
  latestInspection?: {
    id: string;
    status: string;
    inspectionDate: string;
    itemsTotal: number;
    itemsAnswered: number;
  } | null;
  telematicsDevices?: Array<{
    id: string;
    label: string;
    provider: string;
    status: string;
    lastSeenAt: string | null;
  }>;
  documents?: Array<{ id: string; title?: string; name?: string; expiresAt?: string | null }>;
}

export interface ReferenceUiProps {
  view: ReferenceView;
  onViewChange: (view: ReferenceView) => void;
  settingsSection: SettingsSection;
  onSettingsSectionChange: (section: SettingsSection) => void;
  equipment: EquipmentOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  readinessByEquipment: Record<string, EquipmentReadiness>;
  factsByEquipment: Record<string, ReadinessFacts>;
  scoresByEquipment: Record<string, ReadinessScoreResult>;
  rulesState: ReadinessRulesState;
  onRulesStateChange: (state: ReadinessRulesState) => void;
  journals: Record<string, JournalRecord[]>;
  crews: CrewSummary[];
  maintenance: MaintenanceSummary[];
  fleetCards: FleetCard[];
  details: Record<string, EquipmentDetailSnapshot>;
  loading: boolean;
  workspaceError: string | null;
  workspaceIssues: Array<{ source: string; message: string }>;
  rulesAvailable: boolean;
  bootstrap: ReadinessBootstrap | null;
  shifts: ReadinessShiftDto[];
  permits: WorkPermitDto[];
  currentReadiness: CurrentReadinessDto[];
  authoritativeReadinessError: string | null;
  readinessHistory: ReadinessSnapshotDto[];
  audit: ReadinessAuditEnvelope | null;
  filters: ReadinessUrlFilters;
  onFiltersChange: (filters: ReadinessUrlFilters) => void;
  showInternalNavigation: boolean;
  onRetry: () => void;
}
