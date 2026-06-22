'use client';

import type { EquipmentOperationalStatus, ReportStatus } from './fleet-types';
import { EQUIPMENT_STATUS_META, REPORT_STATUS_META } from './equipment-status';

export interface FleetFilterState {
  site: string;
  kind: string;
  /** Legacy field kept so older tests/callers that spread filters do not break. */
  status: string;
  equipmentStatus: string;
  reportStatus: string;
  crew: string;
}

export const EMPTY_FILTERS: FleetFilterState = {
  site: '',
  kind: '',
  status: '',
  equipmentStatus: '',
  reportStatus: '',
  crew: '',
};

const EQUIPMENT_STATUS_OPTIONS: { value: EquipmentOperationalStatus; label: string }[] = [
  { value: 'working', label: EQUIPMENT_STATUS_META.working.label },
  { value: 'repair', label: EQUIPMENT_STATUS_META.repair.label },
  { value: 'idle', label: EQUIPMENT_STATUS_META.idle.label },
];

const REPORT_STATUS_OPTIONS: { value: ReportStatus; label: string }[] = [
  { value: 'has_report', label: REPORT_STATUS_META.has_report.label },
  { value: 'expected', label: REPORT_STATUS_META.expected.label },
  { value: 'missing', label: REPORT_STATUS_META.missing.label },
];

const selectCls =
  'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15';

export function EquipmentFilters({
  sites,
  kinds,
  crews,
  value,
  onChange,
}: {
  sites: string[];
  kinds: { value: string; label: string }[];
  crews: string[];
  value: FleetFilterState;
  onChange: (next: FleetFilterState) => void;
}) {
  const set = (patch: Partial<FleetFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <span className="text-xs font-medium text-slate-400">Фильтры:</span>

      <select className={selectCls} value={value.site} onChange={(e) => set({ site: e.target.value })}>
        <option value="">Все объекты</option>
        {sites.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select className={selectCls} value={value.kind} onChange={(e) => set({ kind: e.target.value })}>
        <option value="">Все типы</option>
        {kinds.map((k) => (
          <option key={k.value} value={k.value}>{k.label}</option>
        ))}
      </select>

      <select
        className={selectCls}
        value={value.equipmentStatus}
        onChange={(e) => set({ equipmentStatus: e.target.value, status: e.target.value })}
      >
        <option value="">Статус техники</option>
        {EQUIPMENT_STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      <select className={selectCls} value={value.reportStatus} onChange={(e) => set({ reportStatus: e.target.value })}>
        <option value="">Статус отчёта</option>
        {REPORT_STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      <select className={selectCls} value={value.crew} onChange={(e) => set({ crew: e.target.value })}>
        <option value="">Все бригады</option>
        {crews.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
