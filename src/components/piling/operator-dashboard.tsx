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
import { OperatorDocumentReminder } from '@/components/piling/operator-document-reminder';
import { ShiftPhaseStrip, ShiftStepCard } from '@/components/piling/operator/shift-step-card';
import { resolveShiftPhase } from '@/components/piling/operator/shift-phase';
import type { OperatorShiftFacts } from '@/modules/readiness/application/operator-shift-query';
import type { SiteFlatDTO, ReportListItemDTO } from '@/lib/types';

/**
 * Быстрые переходы смены — пять постоянных мест.
 *
 * Подписи обязаны совпадать с тем, куда ведут. «Смена» вела в раздел отчёта и
 * с 20.08.2026 называется «Осмотр», потому что открывает чек-лист ЕО.
 * «Моточасы» с 2026-08-10 не прыгают в середину отчёта: показание счётчика
 * нужно контуру готовности до начала работ, у него своё окно.
 *
 * Набор фиксированный во всех фазах, недоступные плитки закрыты замком.
 * Меняющийся состав был бы компактнее, но заставлял бы искать кнопку заново
 * каждый раз, а замок честно говорит «сюда пока нельзя».
 */
const OPERATOR_ACTIONS: {
  label: string; icon: PilingIconName; target: string; action?: 'meter' | 'inspection';
  /** С какого шага смены плитка становится доступной. */
  fromPhase: number;
}[] = [
  { label: 'Осмотр', icon: 'inspection', target: 'inspection', action: 'inspection', fromPhase: 1 },
  { label: 'Моточасы', icon: 'engine-hours', target: 'engine-hours', action: 'meter', fromPhase: 1 },
  { label: 'Простой', icon: 'downtime', target: 'defect', fromPhase: 5 },
  { label: 'Фото', icon: 'camera', target: 'photo', fromPhase: 5 },
  { label: 'Отправить', icon: 'send', target: 'submit', fromPhase: 5 },
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
  // Заведение осмотра — сетевой вызов: без блокировки двойное нажатие
  // заводит два осмотра одной фазы.
  const [stepBusy, setStepBusy] = useState(false);
  const [shiftFacts, setShiftFacts] = useState<OperatorShiftFacts | null>(null);
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
      const [sitesRes, reportsRes, crewRes, shiftRes] = await Promise.all([
        authFetch(`/api/sites?userId=${user.id}`),
        authFetch(`/api/reports/my?userId=${user.id}`),
        authFetch('/api/crews/my'),
        authFetch('/api/operator/shift'),
      ]);
      // Контур готовности не должен ронять экран: без него оператор всё ещё
      // может вести отчёт, просто без подсказки о следующем шаге.
      setShiftFacts(shiftRes.ok ? await shiftRes.json() : null);
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
  const displayName = user?.name?.trim() || 'Оператор';
  const openReport = (target?: string) => router.push(target ? `/report#${target}` : '/report');

  // Шаг смены считает чистая функция, покрытая тестами: правило «что делать
  // дальше» — самое дорогое на этом экране, и в разметке его не проверишь.
  const phase = shiftFacts && user ? resolveShiftPhase(shiftFacts, user.id) : null;
  // Смена идёт — значит следующий осмотр это осмотр после работ. Признак берём
  // из состояния смены, а не из номера шага: шаг считается от него же.
  const inspectionPhase = shiftFacts?.shift?.state === 'STARTED' ? 'POST_SHIFT' : 'PRE_SHIFT';

  /**
   * Открыть осмотр нужной половины смены, при необходимости заведя его.
   *
   * Осмотр заводится здесь, а не на общей форме /inspections/new: та требует
   * выбрать установку руками и не проставляет смену. Без `shiftId` осмотр не
   * привязан к смене — экран его не находит и снова предлагает «начать
   * осмотр», а сравнение состояния до и после работ остаётся без данных.
   */
  const openShiftInspection = async (wanted: 'PRE_SHIFT' | 'POST_SHIFT') => {
    const existing = wanted === 'POST_SHIFT'
      ? shiftFacts?.inspection.postShift
      : shiftFacts?.inspection.preShift;
    if (existing) return router.push(`/inspections/${existing.id}`);
    const equipmentId = shiftFacts?.equipment?.id;
    const shiftId = shiftFacts?.shift?.id;
    // Нет смены или машины — заводить осмотр не от чего; общая форма хотя бы
    // даст выбрать вручную.
    if (!equipmentId || !shiftId) return router.push('/inspections/new?level=EO');
    setStepBusy(true);
    try {
      const res = await authFetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId, level: 'EO', inspectionDate: today || getTodayInTimezone(),
          shiftId, phase: wanted,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Не удалось начать осмотр');
      router.push(`/inspections/${body.inspection.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось начать осмотр');
    } finally {
      setStepBusy(false);
    }
  };

  const runPhaseAction = () => {
    if (!phase) return;
    if (phase.target === 'inspection') return void openShiftInspection('PRE_SHIFT');
    if (phase.target === 'post-inspection') return void openShiftInspection('POST_SHIFT');
    if (phase.target === 'meter') return setMeterOpen(true);
    if (phase.target === 'report') return openReport();
    if (phase.target === 'handover' || phase.target === 'handover-accept' || phase.target === 'start') {
      // Команды смены живут в контуре готовности и требуют версии агрегата,
      // поэтому выполняются на его экране, а не отсюда.
      return router.push('/admin/to?view=shifts');
    }
    void loadData();
  };

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

      {phase ? (
        <>
          <div
            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
              phase.blockers.length > 0
                ? 'border-destructive/30 bg-destructive/10'
                : 'border-border bg-card'
            }`}
          >
            <span className="text-sm font-medium text-foreground">
              {shiftFacts?.equipment?.name ?? 'Установка не назначена'}
            </span>
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                phase.blockers.length > 0 ? 'text-destructive-strong' : 'text-muted-foreground'
              }`}
            >
              {phase.blockers.length > 0 ? `не допущена · ${phase.blockers.length}` : 'допущена'}
            </span>
          </div>

          <ShiftPhaseStrip phase={phase.phase} />
          <ShiftStepCard phase={phase} onAction={runPhaseAction} busy={stepBusy} />
        </>
      ) : (
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
      )}

      <OperatorDocumentReminder />

      <section aria-label="Действия смены" className="grid grid-cols-6 gap-3">
        {OPERATOR_ACTIONS.map((action, index) => {
          // Плитка недоступна, пока смена до неё не дошла. Недоступность
          // показываем пунктиром и словом «позже», а не одной прозрачностью:
          // приглушённая кнопка читается как «сломалось», а пунктир с подписью
          // честно говорит «сюда пока нельзя».
          const locked = phase ? phase.phase < action.fromPhase : false;
          const disabled = locked || (action.action ? false : ctaDisabled);
          return (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                if (action.action === 'meter') return setMeterOpen(true);
                if (action.action === 'inspection') return void openShiftInspection(inspectionPhase);
                return openReport(action.target);
              }}
              disabled={disabled}
              aria-label={locked ? `${action.label} — недоступно на этом шаге` : action.label}
              className={`col-span-2 flex min-h-36 flex-col items-center justify-center rounded-xl bg-card p-3 shadow-sm transition active:scale-[0.99] ${
                locked
                  ? 'border border-dashed border-border opacity-60'
                  : 'border border-border hover:border-signal/30 hover:bg-signal/10/30'
              } disabled:cursor-not-allowed ${index === 3 ? 'col-start-2' : ''} ${index === 4 ? 'col-start-4' : ''}`}
            >
              <PilingIcon name={action.icon} size={82} decorative />
              <span className="mt-1 text-base font-semibold text-foreground">{action.label}</span>
              {locked && <span className="text-xs text-muted-foreground">позже</span>}
            </button>
          );
        })}
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
            <button type="button" onClick={() => router.push('/history')} className="hit-target text-xs font-medium text-info-strong">История</button>
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
