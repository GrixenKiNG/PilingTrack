import type { ComponentType, ReactNode } from 'react';

/** Accent tones shared across KPI cards, metrics and risk badges. */
export type OpsTone = 'slate' | 'orange' | 'blue' | 'amber' | 'emerald' | 'red';

/** Operational risk level — drives the risk badge colour. `ok` is neutral/green,
 *  `warn` amber, `critical` red, `none` renders nothing. */
export type RiskLevel = 'none' | 'ok' | 'warn' | 'critical';

/** One KPI tile in the top bar. */
export interface OpsKpiItem {
  label: string;
  value: string;
  detail?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: OpsTone;
}

/** A quick-filter pill option. `key` is whatever the caller switches on. */
export interface OpsQuickFilter<K extends string = string> {
  key: K;
  label: string;
}

/** Column definition for the generic dense table. */
export interface OpsColumn<T> {
  /** Stable key, also used as React key for the header cell. */
  key: string;
  header: ReactNode;
  /** CSS grid track for this column, e.g. "116px" or "minmax(170px,1.2fr)". */
  width: string;
  align?: 'left' | 'right';
  /** Render the cell for a given row. */
  cell: (row: T) => ReactNode;
}
