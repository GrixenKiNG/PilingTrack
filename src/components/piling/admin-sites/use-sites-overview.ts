'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';

// Shape returned by getSiteAnalytics() via GET /api/analytics/sites.
interface SiteAnalytics {
  siteId: string;
  siteName: string;
  plannedPiles: number;
  plannedPileMeters: number;
  actualPiles: number;
  actualPileMeters: number;
  plannedDrilling: number;
  actualDrilling: number;
  pileProgress: number;
  drillingProgress: number;
  totalReports: number;
  totalDowntime: number;
}

// Subset of listCrewSummaries() via GET /api/crews/all.
interface CrewSummary {
  id: string;
  siteId: string;
  equipmentName: string;
  isActive: boolean;
}

/** Combined per-site operational row for the Objects dashboard. */
export interface SiteOverviewRow extends SiteAnalytics {
  isActive: boolean;
  crewCount: number;
  rigNames: string[];
}

export interface SitesOverview {
  rows: SiteOverviewRow[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useSitesOverview(): SitesOverview {
  const [rows, setRows] = useState<SiteOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [analyticsRes, crewsRes] = await Promise.all([
          authFetch('/api/analytics/sites'),
          authFetch('/api/crews/all'),
        ]);
        if (!analyticsRes.ok) throw new Error(`Аналитика объектов недоступна (${analyticsRes.status})`);
        const analytics: SiteAnalytics[] = (await analyticsRes.json()).analytics ?? [];
        const crews: CrewSummary[] = crewsRes.ok ? ((await crewsRes.json()).data ?? []) : [];

        const bySite = new Map<string, { count: number; rigs: Set<string> }>();
        for (const crew of crews) {
          if (!crew.isActive) continue;
          const entry = bySite.get(crew.siteId) ?? { count: 0, rigs: new Set<string>() };
          entry.count += 1;
          if (crew.equipmentName) entry.rigs.add(crew.equipmentName);
          bySite.set(crew.siteId, entry);
        }

        const combined: SiteOverviewRow[] = analytics.map((a) => {
          const crew = bySite.get(a.siteId);
          return { ...a, isActive: true, crewCount: crew?.count ?? 0, rigNames: crew ? [...crew.rigs] : [] };
        });

        if (!cancelled) setRows(combined);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить объекты');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { rows, loading, error, reload: () => setTick((t) => t + 1) };
}
