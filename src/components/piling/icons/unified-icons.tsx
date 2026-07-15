import { forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PILING_ICON_SCALE, PilingIcon, type PilingIconName } from './piling-icon';

/**
 * Compatibility surface for application icons.
 *
 * Domain icons use the approved PilingTrack raster set. Utility controls are
 * re-exported below from Lucide so keyboard and compact dialog controls retain
 * their familiar, ergonomic shapes.
 */
export * from 'lucide-react';

function toSourceSize(size: LucideProps['size']) {
  const numericSize = typeof size === 'number' ? size : Number.parseFloat(size ?? '24');
  return Number.isFinite(numericSize) ? numericSize / PILING_ICON_SCALE : 24 / PILING_ICON_SCALE;
}

/** `h-4`, `w-8`, `size-5`, `h-[18px]`, `h-full` … — a caller-supplied icon box. */
const SIZE_CLASS_RE = /(?:^|\s)(?:size-|[hw]-)(?:\d|\[|px\b|full\b|auto\b)/;

function createUnifiedIcon(name: PilingIconName): LucideIcon {
  const UnifiedIcon = forwardRef<SVGSVGElement, LucideProps>(function UnifiedIcon(
    { size = 24, className, 'aria-label': label },
    _ref,
  ) {
    // Call sites size these icons with Tailwind (`h-4 w-4`), the same way they
    // size a real Lucide icon. PilingIcon writes an inline width/height, and an
    // inline style beats a class — so those classes were silently ignored and
    // every raster icon rendered at the same 36px regardless of what the call
    // site asked for (the app-wide "icons are all different sizes" symptom).
    // When the caller brings its own size classes, let them own the box and
    // stretch the glyph into it; otherwise fall back to the numeric `size`.
    if (className && SIZE_CLASS_RE.test(className)) {
      return (
        <span className={cn('inline-flex shrink-0 items-center justify-center', className)}>
          {label
            ? <PilingIcon name={name} fill label={label} />
            : <PilingIcon name={name} fill decorative />}
        </span>
      );
    }
    return label ? (
      <PilingIcon name={name} size={toSourceSize(size)} className={className} label={label} />
    ) : (
      <PilingIcon name={name} size={toSourceSize(size)} className={className} decorative />
    );
  });

  UnifiedIcon.displayName = `Unified${name}`;
  return UnifiedIcon;
}
// Subject-matter icons: every module receives the approved visual language.
export const Activity = createUnifiedIcon('monitoring');
export const AlertCircle = createUnifiedIcon('defect');
export const AlertTriangle = createUnifiedIcon('defect');
export const Archive = createUnifiedIcon('folder');
export const BarChart3 = createUnifiedIcon('analytics');
export const BellRing = createUnifiedIcon('notifications');
export const BookText = createUnifiedIcon('documents');
export const Building2 = createUnifiedIcon('site');
export const CalendarClock = createUnifiedIcon('maintenance-due');
export const Camera = createUnifiedIcon('camera');
export const CheckCircle2 = createUnifiedIcon('accepted');
export const ClipboardCheck = createUnifiedIcon('inspection');
export const ClipboardList = createUnifiedIcon('inspection');
export const Clock = createUnifiedIcon('engine-hours');
export const Cog = createUnifiedIcon('settings');
export const Database = createUnifiedIcon('documents');
export const Drill = createUnifiedIcon('drilling-auger');
export const FileBarChart = createUnifiedIcon('reports');
export const FileText = createUnifiedIcon('documents');
export const FileX = createUnifiedIcon('documents');
export const FolderOpen = createUnifiedIcon('folder');
export const Gauge = createUnifiedIcon('engine-hours');
export const HardHat = createUnifiedIcon('equipment-rig');
export const History = createUnifiedIcon('history');
export const Image = createUnifiedIcon('camera');
export const LayoutGrid = createUnifiedIcon('dashboard');
export const LayoutTemplate = createUnifiedIcon('dashboard');
export const Map = createUnifiedIcon('site');
export const MapPin = createUnifiedIcon('site');
export const Monitor = createUnifiedIcon('monitoring');
export const Package = createUnifiedIcon('spare-parts');
export const Radio = createUnifiedIcon('monitoring');
export const Ruler = createUnifiedIcon('linear-meters');
export const Send = createUnifiedIcon('send');
export const Settings = createUnifiedIcon('settings');
export const Settings2 = createUnifiedIcon('settings');
export const ShieldAlert = createUnifiedIcon('risk');
export const ShieldCheck = createUnifiedIcon('technical-readiness');
export const ShoppingCart = createUnifiedIcon('spare-parts');
export const Timer = createUnifiedIcon('downtime');
export const User = createUnifiedIcon('operator');
export const UserCog = createUnifiedIcon('operator');
export const UserPlus = createUnifiedIcon('operator');
export const Users = createUnifiedIcon('crew');
export const UsersRound = createUnifiedIcon('crew');
export const Wrench = createUnifiedIcon('repair');
export const WifiOff = createUnifiedIcon('monitoring');
