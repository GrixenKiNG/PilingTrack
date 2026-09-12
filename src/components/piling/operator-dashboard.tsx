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
import { HandoverDialog } from '@/components/piling/operator/handover-dialog';
import { OperatorDocumentReminder } from '@/components/piling/operator-document-reminder';
import { ShiftPhaseStrip, ShiftStepCard } from '@/components/piling/operator/shift-step-card';
import { resolveShiftPhase } from '@/components/piling/operator/shift-phase';
import { ShiftTaskScreen, type ShiftTask } from '@/components/piling/operator/shift-task-screen';
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
  const [handoverOpen, setHandoverOpen] = useState(false);
  // Работа текущего шага — осмотр или отчёт — открывается здесь же, а не
  // отдельным маршрутом: смена должна проходиться в одном окне.
  const [task, setTask] = useState<ShiftTask | null>(null);
  // Заведение осмотра — сетевой вызов: без блокировки двойное нажатие
  // заводит два осмотра одной фазы.
  const [stepBusy, setStepBusy] = useState(false);
  // Список закреплённых установок раскрывается по кнопке, а не висит всегда:
  // у большинства машина одна, и лишний выбор ей только мешает.
  const [pickerOpen, setPickerOpen] = useState(false);
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

  /** Закрыть работу шага и перечитать факты: шаг мог сдвинуться. */
  const dismissTask = useCallback(() => {
    setTask(null);
    window.scrollTo({ top: 0 });
    void loadData();
  }, [loadData]);

  /**
   * Системная кнопка «назад» закрывает работу шага, а не экран смены.
   *
   * Пока осмотр и отчёт были отдельными страницами, «назад» возвращало к
   * смене само. Теперь адрес не меняется, и без записи в истории та же кнопка
   * выбрасывала бы человека из приложения посреди осмотра.
   */
  useEffect(() => {
    if (!task) return;
    window.addEventListener('popstate', dismissTask);
    return () => window.removeEventListener('popstate', dismissTask);
  }, [task, dismissTask]);

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
  // Отчёт и осмотр открываются слоем поверх шага, а не переходом. Запись в
  // истории нужна ровно для системной кнопки «назад» — адрес остаётся `/operator`.
  const openTask = (next: ShiftTask) => {
    setTask(next);
    window.history.pushState({ operatorTask: true }, '');
    window.scrollTo({ top: 0 });
  };

  // Адресная строка не меняется, поэтому раздел отчёта передаём параметром,
  // а не якорем `#photo`, как было при переходе на `/report`.
  const openReport = (target?: string) => openTask({ kind: 'report', anchor: target });

  // Закрываем через историю, чтобы лишняя запись не копилась; сам слой снимет
  // обработчик `popstate`.
  const closeTask = () => {
    if (window.history.state?.operatorTask) window.history.back();
    else dismissTask();
  };

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
    const title = wanted === 'POST_SHIFT' ? 'Осмотр после работ' : 'Предсменный осмотр';
    const openInspection = (inspectionId: string) => openTask({ kind: 'inspection', inspectionId, title });
    const existing = wanted === 'POST_SHIFT'
      ? shiftFacts?.inspection.postShift
      : shiftFacts?.inspection.preShift;
    if (existing) return openInspection(existing.id);
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
      openInspection(body.inspection.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось начать осмотр');
    } finally {
      setStepBusy(false);
    }
  };

  /**
   * Открыть смену на выбранной установке.
   *
   * Смену заводит сам оператор (решение владельца 20.08.2026): ждать в шесть
   * утра, пока её создаст диспетчер, — значит стоять у машины без дела.
   * Границу «только своя установка» держит команда на сервере, здесь список
   * приходит уже суженным.
   */
  const openShift = async (equipmentId: string) => {
    setStepBusy(true);
    try {
      const hour = new Date().getHours();
      const res = await authFetch('/api/readiness/shifts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ equipmentId, type: hour >= 20 || hour < 8 ? 'NIGHT' : 'DAY' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Не удалось открыть смену');
      }
      setPickerOpen(false);
      toast.success('Смена открыта');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось открыть смену');
    } finally {
      setStepBusy(false);
    }
  };

  /**
   * Команда контура готовности с экрана оператора.
   *
   * Контур требует версию агрегата (`if-match`) и ключ идемпотентности: без
   * первого две вкладки затрут работу друг друга, без второго повторное
   * нажатие заведёт вторую запись. Оба заголовка ставим здесь, чтобы каждое
   * место вызова не помнило об этом само.
   */
  const runShiftCommand = async (
    path: string, version: number, body: Record<string, unknown> = {},
  ) => {
    const shiftId = shiftFacts?.shift?.id;
    if (!shiftId) throw new Error('Смена не найдена');
    const res = await authFetch(`/api/readiness/shifts/${shiftId}/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"shift-${shiftId}-v${version}"`,
      },
      body: JSON.stringify({ expectedVersion: version, ...body }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new Error(payload?.error?.message ?? 'Команда не выполнена');
    return payload?.data as { version: number; state: string } | undefined;
  };

  /**
   * Пуск смены одним нажатием.
   *
   * В машине состояний пуск идёт из `PENDING_ACCEPTANCE`, а смена заводится в
   * `PLANNED`: сначала запрос допуска, потом сам пуск. Это два разных события в
   * журнале, и слепить их в одно нельзя — допуск обошёлся бы стороной. Но для
   * человека это одно действие: он и просит, и допускает сам (решение
   * владельца 20.08.2026), поэтому оба шага делает одна кнопка.
   *
   * Раньше кнопка «Начать смену» уводила оператора в администраторский центр
   * готовности — экран обещал пуск и открывал чужой раздел (обход 21.08.2026).
   */
  const startShift = async () => {
    const shift = shiftFacts?.shift;
    if (!shift) return;
    setStepBusy(true);
    try {
      let version = shift.version;
      if (shift.state === 'PLANNED') {
        const requested = await runShiftCommand('request-acceptance', version);
        version = requested?.version ?? version + 1;
      }
      await runShiftCommand('start', version);
      toast.success('Смена начата');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось начать смену');
    } finally {
      setStepBusy(false);
    }
  };

  /** Принять машину от предыдущей смены. */
  const acceptIncomingHandover = async () => {
    const incoming = shiftFacts?.incomingHandover;
    if (!incoming) return;
    setStepBusy(true);
    try {
      const res = await authFetch(`/api/readiness/handovers/${incoming.id}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error?.message ?? 'Не удалось принять машину');
      }
      toast.success('Машина принята');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось принять машину');
    } finally {
      setStepBusy(false);
    }
  };

  /** Передать смену: состояние машины словами уходит следующему оператору. */
  const submitHandover = async (summary: string) => {
    const shift = shiftFacts?.shift;
    if (!shift) return;
    setStepBusy(true);
    try {
      await runShiftCommand('handover', shift.version, { summary });
      setHandoverOpen(false);
      toast.success('Смена передана');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось передать смену');
    } finally {
      setStepBusy(false);
    }
  };

  const runPhaseAction = () => {
    if (!phase) return;
    if (phase.target === 'open-shift') {
      const assignments = shiftFacts?.assignments ?? [];
      if (assignments.length === 1) return void openShift(assignments[0].equipmentId);
      return setPickerOpen(true);
    }
    if (phase.target === 'inspection') return void openShiftInspection('PRE_SHIFT');
    if (phase.target === 'post-inspection') return void openShiftInspection('POST_SHIFT');
    if (phase.target === 'meter') return setMeterOpen(true);
    if (phase.target === 'report') return openReport();
    if (phase.target === 'start') return void startShift();
    if (phase.target === 'handover-accept') return void acceptIncomingHandover();
    if (phase.target === 'handover') return setHandoverOpen(true);
    void loadData();
  };

  // Работа шага занимает экран целиком: одно окно — одна задача. Полосу шагов
  // рисует сама рамка, поэтому шаг смены здесь не дублируется.
  if (task) {
    return (
      <ShiftTaskScreen
        task={task}
        phase={phase?.phase ?? (task.kind === 'report' ? 6 : 3)}
        equipmentName={shiftFacts?.equipment?.name ?? crew?.equipmentName ?? null}
        onExit={closeTask}
      />
    );
  }

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
              {shiftFacts?.equipment?.name
                ?? (shiftFacts?.assignments.length ? 'Установка не выбрана' : 'Установка не закреплена')}
            </span>
            {/* Пока машина не выбрана, о допуске говорить нечего: готовность
                считается по конкретной установке, и «допущена» здесь было бы
                утверждением ни о чём. */}
            {shiftFacts?.equipment && (
              <span
                className={`text-xs font-semibold uppercase tracking-wider ${
                  phase.blockers.length > 0 ? 'text-destructive-strong' : 'text-muted-foreground'
                }`}
              >
                {phase.blockers.length > 0 ? `не допущена · ${phase.blockers.length}` : 'допущена'}
              </span>
            )}
          </div>

          <ShiftPhaseStrip phase={phase.phase} />
          <ShiftStepCard phase={phase} onAction={runPhaseAction} busy={stepBusy} />

          {pickerOpen && phase.target === 'open-shift' && (
            <section aria-label="Выбор установки" className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                На какой установке работаете
              </h2>
              {(shiftFacts?.assignments ?? []).map((assignment) => (
                <button
                  key={assignment.equipmentId}
                  type="button"
                  onClick={() => void openShift(assignment.equipmentId)}
                  disabled={stepBusy}
                  className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm transition hover:border-signal/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-foreground">
                      {assignment.equipmentName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {assignment.model} · {assignment.siteName}
                    </span>
                  </span>
                  <PilingIcon name="equipment" size={44} decorative />
                </button>
              ))}
            </section>
          )}
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
          // Не допущен по документам — закрыты все плитки, а не только те, до
          // которых смена не дошла. Осмотр машины человеком без действующего
          // удостоверения — такая же работа на установке, как и всё остальное:
          // открытая плитка звала бы делать то, чего ему сейчас нельзя.
          const notCleared = (shiftFacts?.clearance.blockers.length ?? 0) > 0
            && shiftFacts?.shift?.state !== 'STARTED'
            && shiftFacts?.shift?.state !== 'HANDOVER_PENDING';
          const locked = notCleared || (phase ? phase.phase < action.fromPhase : false);
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
              aria-label={
                notCleared ? `${action.label} — недоступно без допуска`
                  : locked ? `${action.label} — недоступно на этом шаге`
                    : action.label
              }
              className={`col-span-2 flex min-h-36 flex-col items-center justify-center rounded-xl bg-card p-3 shadow-sm transition active:scale-[0.99] ${
                locked
                  ? 'border border-dashed border-border opacity-60'
                  : 'border border-border hover:border-signal/30 hover:bg-signal/10/30'
              } disabled:cursor-not-allowed ${index === 3 ? 'col-start-2' : ''} ${index === 4 ? 'col-start-4' : ''}`}
            >
              <PilingIcon name={action.icon} size={82} decorative />
              <span className="mt-1 text-base font-semibold text-foreground">{action.label}</span>
              {locked && (
                <span className="text-xs text-muted-foreground">
                  {notCleared ? 'нет допуска' : 'позже'}
                </span>
              )}
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

      {/* Установка берётся из фактов смены, а не из экипажа: у оператора их
          теперь может быть несколько, и `crew` возвращает произвольный —
          показание ушло бы на чужую машину. */}
      <MeterReadingDialog
        open={meterOpen}
        onOpenChange={setMeterOpen}
        equipmentId={shiftFacts?.equipment?.id ?? crew?.equipmentId ?? null}
        equipmentName={shiftFacts?.equipment?.name ?? crew?.equipmentName ?? null}
        onRecorded={() => void loadData()}
      />
      <HandoverDialog
        open={handoverOpen}
        onOpenChange={setHandoverOpen}
        equipmentName={shiftFacts?.equipment?.name ?? null}
        busy={stepBusy}
        onSubmit={(summary) => void submitHandover(summary)}
      />
    </div>
  );
}
