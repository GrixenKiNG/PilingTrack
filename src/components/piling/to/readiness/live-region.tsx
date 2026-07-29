'use client';

import { useEffect, useRef, useState } from 'react';

interface LiveRegionProps {
  message?: string | null;
}

export function LiveRegion({ message }: LiveRegionProps) {
  const lastAnnouncement = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const next = message?.trim() ?? '';
    if (!next || next === lastAnnouncement.current) return;
    lastAnnouncement.current = next;
    setAnnouncement('');
    const timer = window.setTimeout(() => setAnnouncement(next), 0);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="live-region"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}
