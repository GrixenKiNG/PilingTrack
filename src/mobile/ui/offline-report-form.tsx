/**
 * Offline Report Form — Mobile-Optimized
 *
 * Full report creation form designed for field operators:
 * - Large touch targets
 * - Quick increment buttons
 * - Offline-first (saves to IndexedDB)
 * - Sync status indicator
 */

'use client';

import { useState, useCallback } from 'react';
import { QuickPileCounter } from './quick-pile-counter';
import { QuickDowntimeSelector } from './quick-downtime-selector';
import { outboxService } from '@/mobile/outbox/outbox-service';
import type { LocalReport, LocalPileWork, LocalDowntime } from '@/mobile/db/schema';

interface OfflineReportFormProps {
  siteId: string;
  siteName: string;
  userId: string;
  userName: string;
  date: string;
  shiftType: 'DAY' | 'NIGHT';
  pileGrades: Array<{ id: string; name: string }>;
  downtimeReasons: Array<{ id: string; name: string }>;
  onSuccess?: () => void;
}

export function OfflineReportForm({
  siteId,
  siteName,
  userId,
  userName,
  date,
  shiftType,
  pileGrades,
  downtimeReasons,
  onSuccess,
}: OfflineReportFormProps) {
  const [piles, setPiles] = useState<Record<string, number>>({});
  const [downtimes, setDowntimes] = useState<LocalDowntime[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalPiles = Object.values(piles).reduce((s, c) => s + c, 0);
  const totalDowntime = downtimes.reduce((s, d) => s + d.duration, 0);

  const handlePileChange = useCallback((gradeId: string, count: number) => {
    setPiles(prev => ({ ...prev, [gradeId]: count }));
  }, []);

  const handleDowntimeAdd = useCallback((reasonId: string, duration: number) => {
    const reason = downtimeReasons.find(r => r.id === reasonId);
    setDowntimes(prev => [...prev, {
      id: crypto.randomUUID(),
      reportId: '', // Will be set on save
      reasonId,
      reasonName: reason?.name || '',
      duration,
      comment: null,
      updatedAt: new Date().toISOString(),
    }]);
  }, [downtimeReasons]);

  const handleSubmit = async () => {
    if (totalPiles === 0 && downtimes.length === 0) return;

    setIsSubmitting(true);
    try {
      const reportId = `local_${crypto.randomUUID()}`;

      // Create local report
      const report: LocalReport = {
        id: reportId,
        tenantId: null,
        siteId,
        siteName,
        userId,
        userName,
        date,
        shiftType,
        shiftStart: new Date().toTimeString().slice(0, 5),
        shiftEnd: null,
        equipmentId: null,
        status: 'submitted',
        syncStatus: 'pending',
        serverVersion: 0,
        localVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      };

      // Save to outbox (IndexedDB)
      await outboxService.enqueueReportCreate(report);

      // Save child entries
      const pileEntries: LocalPileWork[] = Object.entries(piles)
        .filter(([, count]) => count > 0)
        .map(([gradeId, count]) => {
          const grade = pileGrades.find(g => g.id === gradeId);
          return {
            id: crypto.randomUUID(),
            reportId,
            picketId: null,
            pileGradeId: gradeId,
            pileGradeName: grade?.name || '',
            count,
            updatedAt: new Date().toISOString(),
          };
        });

      for (const pile of pileEntries) {
        await outboxService.savePileWork(pile);
      }

      for (const dt of downtimes) {
        await outboxService.saveDowntime({ ...dt, reportId });
      }

      onSuccess?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Summary Bar */}
      <div className="sticky top-0 z-10 rounded-lg bg-background/80 backdrop-blur-sm border p-4">
        <div className="flex justify-between text-sm">
          <span>Сваи: <strong>{totalPiles}</strong></span>
          <span>Простой: <strong>{totalDowntime} мин</strong></span>
        </div>
      </div>

      {/* Pile Counters */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Сваи</h2>
        {pileGrades.map((grade) => (
          <QuickPileCounter
            key={grade.id}
            gradeId={grade.id}
            gradeName={grade.name}
            initialCount={piles[grade.id] || 0}
            onChange={handlePileChange}
            disabled={isSubmitting}
          />
        ))}
      </div>

      {/* Downtime */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Простои</h2>
        <QuickDowntimeSelector
          reasons={downtimeReasons}
          onAdd={handleDowntimeAdd}
          disabled={isSubmitting}
        />

        {/* Current Downtimes */}
        {downtimes.length > 0 && (
          <div className="space-y-2">
            {downtimes.map((dt, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-muted p-3">
                <span className="text-sm">{dt.reasonName}</span>
                <span className="font-medium tabular-nums">{dt.duration} мин</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-sm border-t">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || (totalPiles === 0 && downtimes.length === 0)}
          className="w-full min-h-[56px] rounded-lg bg-primary text-primary-foreground font-semibold text-base hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? 'Сохранение...' : `Сохранить отчёт (${totalPiles} свай)`}
        </button>
      </div>
    </div>
  );
}
