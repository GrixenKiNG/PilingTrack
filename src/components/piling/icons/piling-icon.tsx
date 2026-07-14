import Image from 'next/image';
import {
  Activity, ArrowLeft, BarChart3, CalendarClock, Check, ChevronRight,
  CircleUserRound, Download, FileBarChart, FileText, Filter, FolderOpen,
  HardHat, Headphones, Home, LayoutGrid, LogOut, Map, MapPin, Menu, Pencil, Plus,
  Printer, RefreshCw, Save, Search, Send, Settings, ShieldAlert, Trash2,
  Users, X, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const DOMAIN_ICON_NAMES = [
  'shift-start', 'inspection', 'engine-hours', 'pile-group', 'pile-driving',
  'drilling-auger', 'linear-meters', 'downtime', 'downtime-reason',
  'technical-readiness', 'maintenance-due', 'repair', 'defect', 'work-order',
  'spare-parts', 'handoff', 'accepted', 'equipment-rig',
] as const;

export const STANDARD_ICON_NAMES = [
  'activity', 'add', 'analytics', 'back', 'calendar', 'camera', 'check', 'close',
  'crew', 'dashboard', 'delete', 'documents', 'download', 'edit', 'equipment',
  'external', 'feedback', 'filter', 'folder', 'headset', 'history', 'home',
  'logout', 'map', 'menu', 'monitoring', 'notifications', 'operator', 'print',
  'refresh', 'reports', 'risk', 'save', 'search', 'send', 'settings', 'site',
  'telegram', 'users',
] as const;

export const PILING_ICON_NAMES = [...DOMAIN_ICON_NAMES, ...STANDARD_ICON_NAMES] as const;
export type DomainIconName = (typeof DOMAIN_ICON_NAMES)[number];
export type StandardIconName = (typeof STANDARD_ICON_NAMES)[number];
export type PilingIconName = (typeof PILING_ICON_NAMES)[number];
export type PilingIconTone = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger';
export type PilingIconSize = 16 | 18 | 20 | 24 | 32 | 48 | 64 | number;

/** Global visual scale requested for every application icon. */
export const PILING_ICON_SCALE = 1.5;

const standardIcons: Record<StandardIconName, LucideIcon> = {
  activity: Activity, add: Plus, analytics: BarChart3, back: ArrowLeft,
  calendar: CalendarClock, camera: Activity, check: Check, close: X,
  crew: Users, dashboard: LayoutGrid, delete: Trash2, documents: FileText,
  download: Download, edit: Pencil, equipment: HardHat, external: ChevronRight,
  feedback: Headphones, filter: Filter, folder: FolderOpen, headset: Headphones,
  history: CalendarClock, home: Home, logout: LogOut, map: Map, menu: Menu,
  monitoring: Activity, notifications: Activity, operator: CircleUserRound,
  print: Printer, refresh: RefreshCw, reports: FileBarChart, risk: ShieldAlert,
  save: Save, search: Search, send: Send, settings: Settings, site: MapPin,
  telegram: Send, users: Users,
};

/** Exact crops from the user-approved 6x6 icon sheet. */
const approvedIconAssets: Partial<Record<PilingIconName, string>> = {
  'shift-start': 'shift-start', inspection: 'inspection', 'engine-hours': 'engine-hours',
  defect: 'defect', camera: 'camera', send: 'send', handoff: 'send',
  'pile-group': 'pile-group', 'pile-driving': 'pile-driving',
  'drilling-auger': 'drilling-auger', 'linear-meters': 'linear-meters',
  downtime: 'downtime', 'downtime-reason': 'downtime-reason',
  'technical-readiness': 'technical-readiness', 'maintenance-due': 'maintenance-due',
  repair: 'repair', 'work-order': 'work-order', 'spare-parts': 'spare-parts',
  accepted: 'accepted', site: 'site', 'equipment-rig': 'equipment-rig',
  equipment: 'equipment-rig', crew: 'crew', operator: 'operator',
  monitoring: 'monitoring', reports: 'reports', history: 'history',
  analytics: 'analytics', risk: 'risk', notifications: 'notifications',
  documents: 'documents', users: 'users', settings: 'settings', folder: 'folder',
  telegram: 'telegram', logout: 'logout',
};

type DecorativeIconProps = { decorative: true; label?: never };
type MeaningfulIconProps = { decorative?: false; label: string };

export type PilingIconProps = (DecorativeIconProps | MeaningfulIconProps) & {
  name: PilingIconName;
  size?: PilingIconSize;
  tone?: PilingIconTone;
  className?: string;
};

export function PilingIcon({
  name, size = 24, tone = 'neutral', decorative = false, label, className,
}: PilingIconProps) {
  const asset = approvedIconAssets[name];
  const renderedSize = size * PILING_ICON_SCALE;
  if (asset) {
    return (
      <span
        aria-hidden={decorative || undefined}
        data-piling-icon={name}
        data-tone={tone}
        style={{ width: renderedSize, height: renderedSize }}
        className={cn('piling-icon piling-icon--approved inline-flex shrink-0 items-center justify-center', className)}
      >
        <Image
          src={`/icons/pilingtrack/${asset}.png`}
          alt={decorative ? '' : (label ?? '')}
          width={209}
          height={184}
          // Small static UI icons: serve the raw PNG (the dev image-optimizer
          // bottlenecks on many concurrent icons and left them blank) and load
          // eagerly since KPI/nav icons are always above the fold.
          unoptimized
          loading="eager"
          className="h-full w-full max-w-full object-contain"
        />
      </span>
    );
  }

  const Icon = standardIcons[name as StandardIconName];
  const accessibility = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': label };
  return (
    <Icon
      data-piling-icon={name}
      data-tone={tone}
      width={renderedSize}
      height={renderedSize}
      className={cn('piling-icon shrink-0', className)}
      {...accessibility}
    />
  );
}
