'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { authFetch } from '@/lib/api';
import { getTodayInTimezone } from '@/lib/timezone';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { MeterReadingDialog } from '@/components/piling/operator/meter-reading-dialog';
import type { SiteFlatDTO, ReportListItemDTO } from '@/lib/types';

/**
 * Быстрые переходы смены.
 *
 * Подписи обязаны совпадать с тем, куда ведут. «Моточасы» с 2026-08-10 больше
 * не прыгают в середину сменного отчёта: показание счётчика нужно контуру
 * готовности до начала работ, поэтому у него своё окно (`action: 'meter'`).
 * Остальные кнопки по-прежнему открывают нужный раздел отчёта.
 */
const OPERATOR_ACTIONS: {
  label: string; icon: PilingIconName; target: string; action?: 'meter';
}[] = [
  { label: 'Смена', icon: 'shift-start', target: 'inspection' },
  { label: 'Моточасы', icon: 'engine-hours', target: 'engine-hours', action: 'meter' },
  { label: 'Простой', icon: 'downtime', target: 'defect' },
  { label: 'Фото', icon: 'camera', target: 'photo' },
  { label: 'Отправить', icon: 'send', target: 'submit' },
];

export function OperatorDashboard() {
  const user = usePilingStore((s) => s.currentUser);
  const router = useRouter();
  const selectedSiteId = usePilingStore((s) => s.selectedSiteId);
  const setSelectedSite = usePilingStore((s) => s.setSelectedSite);
  const [sites, setSites] = useState<SiteFlatDTO[]>([]);
  const [reports, setReports] = useState<ReportListItemDTO[]>([]);
  const [todayReport, setTodayReport] = useState<ReportListItemDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState('');
  const [meterOpen, setMeterOpen] = useState(false);
  // Установка берётся из экипажа: оператор не выбирает машину, он на ней стоит.
  const [crew, setCrew] = useState<{ equipmentId: string; equipmentName: string } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local date after hydration
    setToday(getTodayInTimezone());
  }, []);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [sitesRes, reportsRes, crewRes] = await Promise.all([
        authFetch(`/api/sites?userId=${user.id}`),
        authFetch(`/api/reports/my?userId=${user.id}`),
        authFetch('/api/crews/my'),
      ]);
      if (crewRes.ok) {
        const { crew: myCrew } = await crewRes.json();
        setCrew(myCrew ? { equipmentId: myCrew.equipmentId, equipmentName: myCrew.equipmentName } : null);
      }
      if (sitesRes.ok) {
        const sitesData = await sitesRes.json();
        const accessibleSites = sitesData.data || sitesData.sites || [];
        setSites(accessibleSites);
        if (accessibleSites.length === 0) setSelectedSite(null);
        else if (!selectedSiteId || !accessibleSites.some((site: SiteFlatDTO) => site.id === selectedSiteId)) {
          setSelectedSite(accessibleSites[0].id);
        }
      }
      if (reportsRes.ok) {
        const reportsData = await reportsRes.json();
        const items = reportsData.data || reportsData.reports || [];
        setReports(items);
        setTodayReport(items.find((report: ReportListItemDTO) => report.date === today) || null);
      }
    } catch {
      toast.error('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, setSelectedSite, today, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch dashboard data on dependency change
    void loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-52 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const currentSite = sites.find((site) => site.id === selectedSiteId);
  const noSite = sites.length === 0;
  const ctaDisabled = noSite || !currentSite;
  const active = Boolean(todayReport);
  const submitted = todayReport?.status === 'submitted';
  const hasRecordedWork = Boolean(
    todayReport
      && (todayReport.totalPiles > 0 || todayReport.totalDrilling > 0),
  );
  const shiftSteps = [
    { label: 'Отчёт создан', complete: active },
    { label: 'Работы внесены', complete: hasRecordedWork || submitted },
    { label: 'Простои учтены', complete: Boolean((todayReport?.totalDowntime ?? 0) > 0 || submitted) },
    { label: 'Передан диспетчеру', complete: submitted },
  ];
  const displayName = user?.name?.trim() || 'Оператор';
  const openReport = (target?: string) => router.push(target ? `/report#${target}` : '/report');

  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 pb-28 sm:p-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Операторская смена</h1>
          <p className="text-sm text-muted-foreground">{displayName}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card">
          <PilingIcon name="operator" size={34} decorative />
        </div>
      </header>

      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        type="button"
        onClick={() => openReport()}
        disabled={ctaDisabled}
        className="flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border-2 border-signal/30 bg-card px-6 py-5 text-center shadow-sm transition hover:bg-signal/10/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:border-border disabled:opacity-60"
      >
        <PilingIcon name={active ? 'reports' : 'shift-start'} size={126} decorative />
        <span className="mt-1 text-xl font-semibold text-foreground">
          {active ? 'Редактировать отчёт' : 'Начало смены'}
        </span>
        <span className="mt-1 text-xs text-muted-foreground">
          {currentSite?.name || 'Нет назначенного объекта'}
        </span>
      </motion.button>

      <section aria-label="Действия смены" className="grid grid-cols-6 gap-3">
        {OPERATOR_ACTIONS.map((action, index) => (
          <button
            key={action.label}
            type="button"
            onClick={() => (action.action === 'meter' ? setMeterOpen(true) : openReport(action.target))}
            disabled={action.action === 'meter' ? false : ctaDisabled}
            className={`col-span-2 flex min-h-36 flex-col items-center justify-center rounded-xl border border-border bg-card p-3 shadow-sm transition hover:border-signal/30 hover:bg-signal/10/30 active:scale-[0.99] disabled:opacity-50 ${index === 3 ? 'col-start-2' : ''} ${index === 4 ? 'col-start-4' : ''}`}
          >
            <PilingIcon name={action.icon} size={82} decorative />
            <span className="mt-1 text-base font-semibold text-foreground">{action.label}</span>
          </button>
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card px-3 py-4" aria-label="Статус передачи смены">
        <div className="grid grid-cols-4 gap-1">
          {shiftSteps.map((step, index) => {
            return (
              <div key={step.label} className="relative flex flex-col items-center text-center">
                {index > 0 && <span className={`absolute right-1/2 top-2 h-px w-full ${step.complete ? 'bg-success-strong' : 'bg-slate-300'}`} />}
                <span className={`relative z-10 h-4 w-4 rounded-full border-2 ${step.complete ? 'border-success bg-success-strong' : 'border-slate-400 bg-card'}`} />
                <span className="mt-2 text-xs leading-tight text-muted-foreground">{step.label}</span>
                <span className="sr-only">{step.complete ? 'выполнено' : 'ожидается'}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="space-y-1.5">
        <label id="operator-site-label" className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <PilingIcon name="site" size={24} decorative />
          Объект
        </label>
        {sites.length > 0 ? (
          <Select value={selectedSiteId || ''} onValueChange={setSelectedSite}>
            <SelectTrigger aria-labelledby="operator-site-label" className="h-12 w-full bg-card"><SelectValue placeholder="Выберите объект" /></SelectTrigger>
            <SelectContent>
              {sites.map((site) => <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex h-12 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-muted-foreground">
            Нет назначенных объектов
          </div>
        )}
      </div>

      {reports.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Последние отчёты</h2>
            <button type="button" onClick={() => router.push('/history')} className="text-xs font-medium text-info-strong">История</button>
          </div>
          <ul className="divide-y divide-border">
            {reports.slice(0, 3).map((report) => (
              <li key={report.id}>
                <button type="button" onClick={() => router.push(`/history?reportId=${report.id}`)} className="flex w-full items-center justify-between py-3 text-left">
                  <span>
                    <span className="block text-sm font-medium text-foreground">{report.siteName}</span>
                    <span className="block text-xs text-muted-foreground">{new Date(report.date).toLocaleDateString('ru-RU')}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {report.totalPiles} св. · {report.totalDrilling} м
                    <PilingIcon name="external" size={16} decorative />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <MeterReadingDialog
        open={meterOpen}
        onOpenChange={setMeterOpen}
        equipmentId={crew?.equipmentId ?? null}
        equipmentName={crew?.equipmentName ?? null}
      />
    </div>
  );
}
