import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PilingIcon, type PilingIconName, type PilingIconTone } from './piling-icon';

interface IconTileProps {
  icon: PilingIconName;
  label: string;
  tone?: PilingIconTone;
  size?: 32 | 48 | 64;
  className?: string;
  children?: ReactNode;
}

export function IconTile({ icon, label, tone = 'primary', size = 48, className, children }: IconTileProps) {
  return (
    <span className={cn('piling-icon-tile', className)} data-tone={tone} data-icon={icon}>
      <PilingIcon name={icon} size={size} tone={tone} decorative />
      <span className="sr-only">{label}</span>
      {children}
    </span>
  );
}
