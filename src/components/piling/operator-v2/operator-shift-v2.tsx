'use client';

/**
 * Экран смены оператора — модуль-кандидат (v2), собранный по макету владельца.
 *
 * ЗАЧЕМ ОТДЕЛЬНО. Действующий `/operator` не тронут. Этот модуль живёт на
 * `/operator/v2`, чтобы можно было пройти оба и выбрать. Выберут этот — заменит
 * старый; не выберут — удаляется одной папкой.
 *
 * ЧТО ИНАЧЕ ПРОТИВ ДЕЙСТВУЮЩЕГО ЭКРАНА:
 *  1. «Принятие установки» — обязательный шаг ВСЕГДА. В `shift-phase.ts`
 *     приёмка показывается только когда предыдущая смена оставила передачу;
 *     первая смена, смена после ремонта или простоя её не имеют, и человек
 *     проваливался сразу на осмотр.
 *  2. Осмотр — узлами, свёрнутыми в один список, а не сотней пунктов.
 *  3. До рычагов ровно ШЕСТЬ экранов (порядок и обоснование — `shift-flow.ts`).
 *     Прежние восемь шагов плюс карточка на каждый узел давали пятнадцать-
 *     двадцать экранов до начала работы.
 *
 * СКОЛЬКО ЭТО ЗАНИМАЕТ. Норматив владельца: штатная смена без замечаний —
 * 7–10 минут от допуска до «Работа разрешена», из них не больше 3–5 минут в
 * телефоне; остальное — физический обход машины и площадки. Секундомер в
 * подписи шага показывает фактическое время, чтобы норматив можно было
 * проверить, а не обсуждать.
 *
 * ЧЕГО НЕТ. Приёмка без передачи, чек-лист площадки с ТБ и функциональная
 * проверка после пуска нигде не сохраняются: под них нет ни таблиц, ни команд.
 * Заводить схему под невыбранный вариант преждевременно, поэтому они живут в
 * памяти вкладки и помечены на экране.
 */

import { formatDowntimeHours } from '@/modules/reports/domain/downtime-hours';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { authFetch } from '@/lib/api';
import { getTodayInTimezone } from '@/lib/timezone';
import { getEquipmentPhoto } from '@/components/piling/admin-equipment/equipment-photo';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import type { OperatorShiftFacts } from '@/modules/readiness/application/operator-shift-query';
import type { ClearanceDocument } from '@/modules/users';
import { CompactInspection } from './compact-inspection';
import { WeatherCard } from './weather-card';
import { DefectSheet } from './defect-sheet';
import { DowntimeSheet, HandoverSheet, PileSheet } from './sheets';
import { useShiftReport } from './use-shift-report';
import {
  BigCheck, BottomTabs, CheckRow, RowList, StepButton, StepShell, ValueRow, type V2Tab,
} from './ui';
import type { OperatorMobileState } from '@/modules/operator-mobile/contracts';
import { fetchState, sendCommand } from '@/components/piling/operator-mobile/api';
import { SafetyTab } from '@/components/piling/operator-mobile/screens/safety-tab';
import { PpeScreen } from '@/components/piling/operator-mobile/screens/ppe-screen';
import { BriefingScreen } from '@/components/piling/operator-mobile/screens/briefing-screen';
import { KnowledgeScreen } from '@/components/piling/operator-mobile/screens/knowledge-screen';
import { ChecklistAccordion } from './checklist-accordion';
import {
  ENGINE_START_CONFIRMATIONS, SITE_SAFETY_GROUPS, STARTUP_GROUPS,
  allDone, countItems, type CheckGroup,
} from './checklists';
import { V2_STEP_TITLE, resolveV2State, stepCaption } from './shift-flow';

/** Пометка о шаге, который пока не сохраняется. Молчать об этом нельзя. */
function DraftNote() {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
      Черновой шаг: в этом варианте он ещё не сохраняется на сервере
    </p>
  );
}

/**
 * Строка состояния документа в карточке допуска.
 *
 * Дата, а не просто «действителен»: «до 15.07.2026» само говорит человеку,
 * когда идти продлевать, и снимает нужду открывать карточку документа.
 */
function documentStatusText(document: ClearanceDocument): string {
  const until = document.expiresAt
    ? new Date(document.expiresAt).toLocaleDateString('ru-RU')
    : null;
  switch (document.status) {
    case 'missing': return 'нет документа';
    case 'expired': return until ? `просрочен ${until}` : 'просрочен';
    case 'expiring': return until ? `истекает ${until}` : 'истекает';
    case 'perpetual': return 'бессрочный';
    default: return until ? `до ${until}` : 'действителен';
  }
}

function Blockers({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
      {items.map((item) => <li key={item} className="text-sm text-destructive-strong">{item}</li>)}
    </ul>
  );
}

function useElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!startedAt) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [startedAt]);
  if (!startedAt || now === null) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

export function OperatorShiftV2() {
  const user = usePilingStore((state) => state.currentUser);
  const [facts, setFacts] = useState<OperatorShiftFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [admitted, setAdmitted] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [siteChecks, setSiteChecks] = useState<Record<string, boolean>>({});
  const [startChecks, setStartChecks] = useState<Record<string, boolean>>({});
  const [engineStartedAt, setEngineStartedAt] = useState<string | null>(null);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [defectOpen, setDefectOpen] = useState(false);
  const [pileOpen, setPileOpen] = useState(false);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [tab, setTab] = useState<V2Tab>('shift');
  /*
    Вкладка ТБ живёт на собственном источнике — снимке рабочего места
    (`/api/operator/mobile/state`). Контур готовности, на котором держится
    остальной экран, знает про документы, но не знает ни про СИЗ, ни про
    ознакомление, ни про проверку знаний: это разные наборы фактов.
  */
  const [safetyState, setSafetyState] = useState<OperatorMobileState | null>(null);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [safetyStep, setSafetyStep] = useState<'PPE' | 'BRIEFING' | 'KNOWLEDGE' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch('/api/operator/shift');
      setFacts(response.ok ? await response.json() : null);
    } catch {
      toast.error('Не удалось загрузить смену');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Перечитать снимок рабочего места — источник вкладки ТБ. */
  const loadSafety = useCallback(async () => {
    try {
      setSafetyState(await fetchState({}));
      setSafetyError(null);
    } catch (cause) {
      setSafetyError(cause instanceof Error ? cause.message : 'Раздел ТБ недоступен');
    }
  }, []);

  /* Шаги допуска записываются теми же командами, что и в остальных модулях:
     своих у вкладки нет — иначе один и тот же факт писался бы двумя путями. */
  const runSafety = useCallback(async (command: Parameters<typeof sendCommand>[0]) => {
    setBusy(true);
    try {
      await sendCommand(command);
      await loadSafety();
      setSafetyStep(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Действие не выполнено');
    } finally {
      setBusy(false);
    }
  }, [loadSafety]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка фактов смены
    void load();
  }, [load]);

  // Снимок рабочего места читаем при первом открытии вкладки ТБ, а не на входе
  // в смену: большинству она за смену не понадобится ни разу.
  useEffect(() => {
    if (tab !== 'safety' || safetyState) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка снимка для вкладки ТБ
    void loadSafety();
  }, [tab, safetyState, loadSafety]);

  const siteSafetyDone = allDone(SITE_SAFETY_GROUPS, siteChecks);
  const startupDone = engineStartedAt !== null && allDone(STARTUP_GROUPS, startChecks);
  const state = facts
    ? resolveV2State(facts, { admitted, accepted, siteSafetyDone, startupDone, finishing })
    : null;
  const elapsed = useElapsed(facts?.shift?.startedAt ?? null);

  // Секундомер приёмки — от открытия экрана до пуска. Норматив владельца:
  // 7–10 минут на всю штатную процедуру, из них не больше 3–5 минут в
  // телефоне. Без часов на экране проверить это можно только с секундомером в
  // руке, а прототип затем и нужен, чтобы цифру измерить.
  const [prepStartedAt] = useState(() => new Date().toISOString());
  const prepElapsed = useElapsed(prepStartedAt)?.replace(/^00:/, '') ?? null;

  // Объект берётся из закрепления по машине смены, а не выбирается человеком:
  // объект определяется установкой, и второй ответ на тот же вопрос завёл бы
  // отчёт не на тот участок.
  const siteId = facts?.assignments.find(
    (item) => item.equipmentId === facts.equipment?.id,
  )?.siteId ?? facts?.assignments[0]?.siteId ?? null;
  const report = useShiftReport(siteId, facts?.equipment?.id ?? null, facts?.shift?.type ?? 'DAY');

  const command = async (path: string, version: number, body: Record<string, unknown> = {}) => {
    const shiftId = facts?.shift?.id;
    if (!shiftId) throw new Error('Смена не найдена');
    const response = await authFetch(`/api/readiness/shifts/${shiftId}/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"shift-${shiftId}-v${version}"`,
      },
      body: JSON.stringify({ expectedVersion: version, ...body }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? 'Команда не выполнена');
    return payload?.data as { version: number } | undefined;
  };

  const openShift = async (equipmentId: string) => {
    setBusy(true);
    try {
      const hour = new Date().getHours();
      const response = await authFetch('/api/readiness/shifts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ equipmentId, type: hour >= 20 || hour < 8 ? 'NIGHT' : 'DAY' }),
      });
      if (!response.ok) {
        throw new Error((await response.json().catch(() => null))?.error?.message ?? 'Не удалось открыть смену');
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось открыть смену');
    } finally {
      setBusy(false);
    }
  };

  /** Принять машину: есть передача — принимаем её, иначе просто расписываемся. */
  const acceptEquipment = async () => {
    const incoming = facts?.incomingHandover;
    if (!facts?.shift) {
      const assignments = facts?.assignments ?? [];
      if (assignments.length === 0) return;
      return void openShift(assignments[0].equipmentId);
    }
    if (incoming && incoming.shiftId !== facts.shift.id) {
      // Свою передачу принять можно: при работе в одну смену принимать её
      // больше некому, и машина иначе оставалась запертой. Самоприёмка
      // помечается в журнале — см. `isSelfAcceptedHandover`.
      setBusy(true);
      try {
        // Версия обязательна: без неё контур отвечает 428 «не указана версия
        // записи», и приёмка не проходила вовсе.
        const response = await authFetch(`/api/readiness/handovers/${incoming.id}/accept`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'if-match': `"handover-${incoming.id}-v${incoming.version}"`,
          },
          body: JSON.stringify({ expectedVersion: incoming.version }),
        });
        if (!response.ok) {
          throw new Error((await response.json().catch(() => null))?.error?.message ?? 'Не удалось принять машину');
        }
        setAccepted(true);
        await load();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось принять машину');
      } finally {
        setBusy(false);
      }
      return;
    }
    setAccepted(true);
  };

  const startShift = async () => {
    const shift = facts?.shift;
    if (!shift) return;
    setBusy(true);
    try {
      let version = shift.version;
      if (shift.state === 'PLANNED') {
        version = (await command('request-acceptance', version))?.version ?? version + 1;
      }
      await command('start', version);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось начать смену');
    } finally {
      setBusy(false);
    }
  };

  /** Передать смену следующему оператору — последняя команда цикла. */
  const submitHandover = async (summary: string) => {
    const shift = facts?.shift;
    if (!shift) return;
    setBusy(true);
    try {
      await command('handover', shift.version, { summary });
      setHandoverOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось передать смену');
    } finally {
      setBusy(false);
    }
  };

  const openInspection = async (phase: 'PRE_SHIFT' | 'POST_SHIFT') => {
    const existing = phase === 'POST_SHIFT' ? facts?.inspection.postShift : facts?.inspection.preShift;
    if (existing) return setInspectionOpen(true);
    const equipmentId = facts?.equipment?.id;
    const shiftId = facts?.shift?.id;
    if (!equipmentId || !shiftId) return toast.error('Смена или установка не определены');
    setBusy(true);
    try {
      const response = await authFetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId, level: 'EO', inspectionDate: getTodayInTimezone(), shiftId, phase,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Не удалось начать осмотр');
      await load();
      setInspectionOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось начать осмотр');
    } finally {
      setBusy(false);
    }
  };

  // Осмотр заводится САМ, как только человек до него дошёл.
  //
  // Раньше здесь был экран с единственной кнопкой «Начать осмотр»: он ничего не
  // сообщал и ничего не решал — чистый лишний шаг на пути к рычагам, а таких в
  // прежнем варианте набиралось пятнадцать-двадцать. Защёлка `creatingRef`
  // обязательна: без неё двойное монтирование в разработке завело бы два
  // осмотра на одну смену.
  const creatingRef = useRef(false);
  useEffect(() => {
    if (state?.step !== 'inspection') return;
    if (facts?.inspection.preShift) return;
    if (creatingRef.current) return;
    creatingRef.current = true;
    void openInspection('PRE_SHIFT');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openInspection пересоздаётся каждый рендер, защёлка выше держит один запуск
  }, [state?.step, facts?.inspection.preShift]);

  if (safetyStep && safetyState) {
    /*
      Шаги допуска показываются во весь экран поверх смены: у каждого свой
      порядок и своя кнопка, и оболочка шага сюда не налезает. Экраны взяты
      готовыми из рабочего места `/operator` — своих копий у вкладки нет.
    */
    const back = () => setSafetyStep(null);
    if (safetyStep === 'PPE') {
      return (
        <PpeScreen
          busy={busy}
          error={safetyError}
          onBack={back}
          onConfirm={(items) => void runSafety({
            command: 'confirm-ppe', productionDate: safetyState.productionDate, items,
          })}
        />
      );
    }
    if (safetyStep === 'BRIEFING') {
      return (
        <BriefingScreen
          busy={busy}
          onBack={back}
          onAcknowledge={() => void runSafety({command: 'acknowledge-briefing'})}
        />
      );
    }
    return (
      <KnowledgeScreen
        busy={busy}
        error={safetyError}
        onBack={back}
        onDone={(picks, attemptToken) => void runSafety({
          command: 'submit-knowledge', attemptToken, picks,
        })}
      />
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (!facts || !state) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Смена недоступна</p>;
  }

  const { step } = state;
  const equipment = facts.equipment;
  const photo = getEquipmentPhoto(equipment?.model);
  const inspectionId = (step === 'post-inspection'
    ? facts.inspection.postShift?.id
    : facts.inspection.preShift?.id) ?? null;
  // Секундомер приёмки в подписи виден до пуска: после него он теряет смысл,
  // а место занимает счётчик отработанного времени.
  const stepLabel = step === 'work' || step === 'closed'
    ? stepCaption(step)
    : `${stepCaption(step)}${prepElapsed ? ` · ${prepElapsed}` : ''}`;

  // ---------- 1. Допуск ----------
  if (step === 'admission') {
    const cleared = state.blockers.length === 0;
    const documents = facts.clearance.documents;
    return (
      <StepShell
        title={tab === 'safety' ? 'Техника безопасности' : 'Личный допуск'}
        subtitle={stepLabel}
        tone={cleared ? 'green' : 'blue'}
        /*
          Панель здесь стоит вместе с кнопкой шага, а не вместо неё. Вкладка
          «ТБ» нужна ИМЕННО НА ЭТОМ ШАГЕ: СИЗ, инструкция и проверка знаний
          проходятся до смены, а не после, и открыть их из «работы» — значит
          открыть их поздно. Дальше по ходу смены панель снова появляется
          только на экране работы: бросать осмотр на середине нельзя.
        */
        footer={(
          <>
            {tab === 'shift' ? (
              <StepButton
                label={cleared ? 'Продолжить' : 'Допуск закрыт'}
                onClick={() => setAdmitted(true)}
                disabled={!cleared}
                tone={cleared ? 'green' : 'blue'}
              />
            ) : null}
            <BottomTabs active={tab} onSelect={setTab} />
          </>
        )}
      >
        {tab !== 'shift' ? (
          tab === 'safety'
            ? (
              safetyState
                ? <SafetyTab state={safetyState} onOpen={setSafetyStep} />
                : <p className="text-sm text-muted-foreground">{safetyError ?? 'Читаем ваш допуск…'}</p>
            )
            : (
              <p className="text-sm text-muted-foreground">
                Техника, журнал и прочие разделы открываются после начала работы:
                до приёмки установки показывать там нечего.
              </p>
            )
        ) : (
        <>
        {/* Документы проверены автоматически: открывать по карточке на каждое
            удостоверение оператор не должен — это его же документы, и он знает
            их наизусть. Экран отвечает на один вопрос: пускают ли сегодня. */}
        <div className="pt-4 text-center">
          {cleared && <BigCheck tone="green" />}
          <p className="mt-4 text-base font-semibold text-foreground">
            {cleared ? 'Допуск подтверждён' : 'К работе не допущен'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.name?.trim() || 'Оператор'} · {new Date().toLocaleString('ru-RU', {
              day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>

        {documents.length > 0 ? (
          <RowList>
            {documents.map((document) => (
              <li key={document.typeId}>
                <ValueRow
                  label={document.typeName}
                  value={documentStatusText(document)}
                  tone={document.status === 'expired' || document.status === 'missing' ? 'warn'
                    : document.status === 'expiring' ? 'warn' : 'ok'}
                />
              </li>
            ))}
          </RowList>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            Обязательные документы администратором не заданы — проверять нечего
          </p>
        )}

        <Blockers items={state.blockers} />

        {facts.clearance.warnings.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
            {facts.clearance.warnings.map((item) => (
              <li key={item} className="text-sm text-warning-strong">{item}</li>
            ))}
          </ul>
        )}
        </>
        )}
      </StepShell>
    );
  }

  // ---------- 2. Принятие установки ----------
  if (step === 'acceptance') {
    // До открытия смены кнопки внизу нет: машину выбирают из списка, и
    // единственная закреплённая — тоже выбор, а не подстановка за человека.
    // Раньше при одной установке смена открывалась кнопкой «Открыть смену», и
    // оператор не видел, НА ЧЁМ она открывается.
    const canAct = state.blockers.length === 0 && Boolean(facts.shift);
    return (
      <StepShell
        title={V2_STEP_TITLE.acceptance}
        subtitle={stepLabel}
        onBack={() => setAdmitted(false)}
        footer={canAct ? (
          <StepButton label="Принять установку" onClick={() => void acceptEquipment()} busy={busy} />
        ) : undefined}
      >
        {equipment ? (
          <>
            <p className="text-lg font-semibold text-foreground">{equipment.name}</p>
            {photo && (
               
              <img src={photo} alt={equipment.name} className="h-40 w-full rounded-xl object-cover" />
            )}
            <RowList>
              {facts.incomingHandover?.submittedByName && (
                <li><ValueRow label="Пред. оператор" value={facts.incomingHandover.submittedByName} /></li>
              )}
              {facts.meterCurrent != null && (
                <li><ValueRow label="Моточасы" value={`${formatNumber(facts.meterCurrent)} м/ч`} /></li>
              )}
              {equipment.nextMaintenanceAtHours != null && equipment.engineHoursTotal != null && (
                <li>
                  <ValueRow
                    label="До ТО"
                    value={`${formatNumber(equipment.nextMaintenanceAtHours - equipment.engineHoursTotal)} м/ч`}
                    tone={equipment.nextMaintenanceAtHours - equipment.engineHoursTotal <= 0 ? 'warn' : undefined}
                  />
                </li>
              )}
              <li>
                <ValueRow
                  label="Состояние"
                  value={state.blockers.length > 0 ? 'есть замечания' : 'Исправна'}
                  tone={state.blockers.length > 0 ? 'warn' : 'ok'}
                />
              </li>
            </RowList>
            {facts.incomingHandover?.summary && (
              <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                <p className="text-xs text-muted-foreground">Что передали</p>
                <p className="mt-1 text-sm text-foreground">{facts.incomingHandover.summary}</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {facts.assignments.length > 0 ? 'Выберите установку' : 'Установка не закреплена'}
          </p>
        )}

        <Blockers items={state.blockers} />

        {/* Выбор установки — всегда, даже когда закреплена одна. Список тот,
            что администратор закрепил за оператором; чужую машину сюда не
            подставить, границу держит команда на сервере. */}
        {!facts.shift && facts.assignments.length > 0 && (
          <>
            <p className="text-sm font-medium text-foreground">На какой установке работаете</p>
            <RowList>
              {facts.assignments.map((assignment) => (
                <li key={assignment.equipmentId}>
                  <CheckRow
                    label={assignment.equipmentName}
                    hint={`${assignment.model} · ${assignment.siteName}`}
                    onToggle={() => void openShift(assignment.equipmentId)}
                  />
                </li>
              ))}
            </RowList>
          </>
        )}

        {/* Погода на площадке — по геопозиции телефона. Ветер это прямое
            ограничение свайных работ, и узнать о нём надо до подъёма мачты. */}
        <WeatherCard
          siteId={siteId}
          siteName={facts.assignments.find((item) => item.siteId === siteId)?.siteName ?? null}
        />

        {facts.shift && !facts.incomingHandover && <DraftNote />}
      </StepShell>
    );
  }

  // ---------- 3. Предсменный осмотр (и осмотр после работ) ----------
  if (step === 'inspection' || step === 'post-inspection') {
    const title = V2_STEP_TITLE[step];
    return (
      <StepShell title={title} subtitle={stepLabel} onBack={() => setInspectionOpen(false)}>
        {(step === 'inspection' || inspectionOpen) && inspectionId ? (
          <CompactInspection
            inspectionId={inspectionId}
            signedByName={user?.name?.trim() || 'Оператор'}
            onDone={() => { setInspectionOpen(false); void load(); }}
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {step === 'post-inspection'
                ? 'Проверьте машину после работ — по узлам'
                : 'Обойдите машину и отметьте узлы'}
            </p>
            <StepButton
              label={inspectionId ? 'Продолжить осмотр' : 'Начать осмотр'}
              onClick={() => void openInspection(step === 'post-inspection' ? 'POST_SHIFT' : 'PRE_SHIFT')}
              busy={busy}
            />
          </>
        )}
      </StepShell>
    );
  }

  // ---------- 4. Площадка и ТБ ----------
  if (step === 'site-safety') {
    // Зона, коммуникации, погода и СИЗ — один сценарий, а не четыре экрана:
    // человек обходит площадку один раз, и в телефоне это должен быть один
    // проход сверху вниз.
    const toggleGroup = (group: CheckGroup, next: boolean) =>
      setSiteChecks((prev) => ({
        ...prev,
        ...Object.fromEntries(group.items.map((item) => [item.id, next])),
      }));
    return (
      <StepShell
        title={V2_STEP_TITLE['site-safety']}
        subtitle={stepLabel}
      >
        <ChecklistAccordion
          groups={SITE_SAFETY_GROUPS}
          checked={siteChecks}
          onToggle={(id) => setSiteChecks((prev) => ({ ...prev, [id]: !prev[id] }))}
          onToggleGroup={toggleGroup}
        />
        {/* Кнопки «Далее» нет намеренно: шаг закрывается последней галочкой и
            экран сам уходит на пуск. Кнопка была бы доступна ровно тогда,
            когда шага уже нет. */}
        <p className="text-xs text-muted-foreground">
          Осталось отметить: {countItems(SITE_SAFETY_GROUPS)
            - SITE_SAFETY_GROUPS.flatMap((group) => group.items).filter((item) => siteChecks[item.id]).length}
        </p>
        <DraftNote />
      </StepShell>
    );
  }

  // ---------- 5. Запуск и функциональная проверка ----------
  if (step === 'startup') {
    const allowed = state.blockers.length === 0;
    const confirmed = ENGINE_START_CONFIRMATIONS.every((item) => startChecks[item.id]);

    // Двигатель ещё не пущен: подтверждения безопасности и ключ. Проверять
    // функции до пуска нечем, поэтому чек-лист ниже появляется после.
    if (engineStartedAt === null) {
      return (
        <StepShell
          title="Запуск двигателя"
          subtitle={stepLabel}
          footer={
            <StepButton
              label="Запустить двигатель"
              onClick={() => setEngineStartedAt(new Date().toISOString())}
              disabled={!confirmed}
              tone="green"
            />
          }
        >
          <p className="text-sm text-muted-foreground">Подтвердите безопасность пуска</p>
          <RowList>
            {ENGINE_START_CONFIRMATIONS.map((item) => (
              <li key={item.id}>
                <CheckRow
                  label={item.label}
                  checked={Boolean(startChecks[item.id])}
                  onToggle={() => setStartChecks((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                />
              </li>
            ))}
          </RowList>
          {facts.meterCurrent != null && (
            <RowList>
              <li>
                <ValueRow label="Моточасы на старт" value={`${formatNumber(facts.meterCurrent)} м/ч`} />
              </li>
            </RowList>
          )}
          <DraftNote />
        </StepShell>
      );
    }

    // Двигатель работает: функции проверяются БЕЗ нагрузки, прогрев идёт
    // параллельно — держать человека на пустом экране «ждите прогрева» значит
    // приписывать приложению минуты, которых оно не тратит.
    const ready = startupDone && allowed;
    const toggleGroup = (group: CheckGroup, next: boolean) =>
      setStartChecks((prev) => ({
        ...prev,
        ...Object.fromEntries(group.items.map((item) => [item.id, next])),
      }));
    return (
      <StepShell
        title={V2_STEP_TITLE.startup}
        subtitle={stepLabel}
        tone={ready ? 'green' : 'blue'}
        onBack={() => setEngineStartedAt(null)}
        footer={
          <StepButton
            label={allowed ? 'Начать смену' : 'Запросить разрешение'}
            onClick={() => void startShift()}
            disabled={!ready}
            busy={busy}
            tone={ready ? 'green' : 'blue'}
          />
        }
      >
        <p className="text-sm text-muted-foreground">
          Двигатель пущен в {new Date(engineStartedAt).toLocaleTimeString('ru-RU', {
            hour: '2-digit', minute: '2-digit',
          })} · проверка функций без нагрузки
        </p>
        <ChecklistAccordion
          groups={STARTUP_GROUPS}
          checked={startChecks}
          onToggle={(id) => setStartChecks((prev) => ({ ...prev, [id]: !prev[id] }))}
          onToggleGroup={toggleGroup}
        />
        <div className="pt-2 text-center">
          {ready && <BigCheck tone="green" />}
          <p className="mt-3 text-base font-semibold text-foreground">
            {!allowed ? 'Контур готовности не пускает машину'
              : ready ? 'Работа разрешена' : 'Пройдите проверку функций'}
          </p>
          {facts.meterCurrent != null && (
            <>
              <p className="mt-6 text-2xl font-bold tabular-nums text-foreground">
                {formatNumber(facts.meterCurrent)} <span className="text-base font-medium">м/ч</span>
              </p>
              {/* Голое число вызывало вопрос «это откуда?». Говорим источник:
                  снятое показание счётчика с датой — или наработка из карточки
                  установки, которую последним правил администратор. */}
              <p className="text-xs text-muted-foreground">
                {facts.meterSource === 'reading'
                  ? `последнее показание счётчика${facts.meterRecordedAt
                    ? ` от ${new Date(facts.meterRecordedAt).toLocaleDateString('ru-RU')}` : ''}`
                  : facts.meterSource === 'equipment'
                    ? 'наработка по карточке установки — счётчик за смену не снимали'
                    : 'на старт'}
              </p>
            </>
          )}
        </div>
        <Blockers items={state.blockers} />
      </StepShell>
    );
  }

  // ---------- 5. Работа ----------
  if (step === 'work') {
    return (
      <>
        <StepShell
          title={tab === 'shift' ? V2_STEP_TITLE.work
            : tab === 'safety' ? 'Техника безопасности'
              : tab === 'equipment' ? 'Техника' : 'Ещё'}
          subtitle={stepLabel}
          footer={<BottomTabs active={tab} onSelect={setTab} />}
        >
          {tab === 'shift' && (
            <>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-[#12a150]">
                  <span className="h-2 w-2 rounded-full bg-[#12a150]" aria-hidden />
                  Смена активна
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{elapsed ?? '—'}</p>
              </div>

              <RowList>
                <li>
                  <ValueRow
                    label="Моточасы"
                    value={facts.meterCurrent != null ? `${formatNumber(facts.meterCurrent)} м/ч` : '—'}
                  />
                </li>
                <li><ValueRow label="Сваи сегодня" value={`${report.totalPiles} шт`} /></li>
                {report.totalDowntime > 0 && (
                  <li><ValueRow label="Простой" value={formatDowntimeHours(report.totalDowntime)} tone="warn" /></li>
                )}
              </RowList>

              <StepButton label="+ Новая свая" onClick={() => setPileOpen(true)} />

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setDefectOpen(true)}
                  className="min-h-12 rounded-lg border border-border bg-card text-sm font-medium text-foreground">
                  Дефект
                </button>
                <button type="button" onClick={() => setDowntimeOpen(true)}
                  className="min-h-12 rounded-lg border border-border bg-card text-sm font-medium text-foreground">
                  Простой
                </button>
              </div>

              <button type="button" onClick={() => setFinishing(true)}
                className="min-h-12 w-full rounded-lg border border-border bg-card text-sm font-semibold text-foreground">
                Завершить работу
              </button>
            </>
          )}

          {tab === 'safety' && (
            safetyState
              ? <SafetyTab state={safetyState} onOpen={setSafetyStep} />
              : (
                <p className="text-sm text-muted-foreground">
                  {safetyError ?? 'Читаем ваш допуск…'}
                </p>
              )
          )}

          {tab === 'equipment' && (
            <RowList>
              <li><ValueRow label="Установка" value={facts.equipment?.name ?? '—'} /></li>
              <li><ValueRow label="Модель" value={facts.equipment?.model ?? '—'} /></li>
              <li>
                <ValueRow
                  label="Моточасы"
                  value={facts.meterCurrent != null ? `${formatNumber(facts.meterCurrent)} м/ч` : '—'}
                />
              </li>
              <li>
                <ValueRow
                  label="Предсменный осмотр"
                  value={facts.inspection.preShift?.status === 'COMPLETED' ? 'закрыт' : 'не закрыт'}
                  tone={facts.inspection.preShift?.status === 'COMPLETED' ? 'ok' : 'warn'}
                />
              </li>
            </RowList>
          )}

          {/* Журнал смены переехал сюда из собственной вкладки: его открывают
              раз в день, а место в панели он занимал постоянно. */}
          {tab === 'more' && (
            report.draft.piles.length === 0 && report.draft.downtimes.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">За смену пока ничего не записано</p>
            ) : (
              <>
                {report.draft.piles.length > 0 && (
                  <RowList>
                    {report.draft.piles.map((row) => (
                      <li key={row.pileGradeId}>
                        <ValueRow
                          label={report.grades.find((g) => g.id === row.pileGradeId)?.name ?? 'Свая'}
                          value={`${row.count} шт`}
                        />
                      </li>
                    ))}
                  </RowList>
                )}
                {report.draft.downtimes.length > 0 && (
                  <RowList>
                    {report.draft.downtimes.map((row, index) => (
                      <li key={`${row.reasonId}-${index}`}>
                        <ValueRow
                          label={report.reasons.find((r) => r.id === row.reasonId)?.name ?? 'Простой'}
                          value={`${row.duration} ч`}
                          tone="warn"
                        />
                      </li>
                    ))}
                  </RowList>
                )}
              </>
            )
          )}

          {tab === 'more' && (
            <RowList>
              <li><ValueRow label="Смена" value={facts.shift?.type === 'NIGHT' ? 'Ночная' : 'Дневная'} /></li>
              <li><ValueRow label="Отчёт" value={report.draft.status === 'submitted' ? 'отправлен' : 'черновик'} /></li>
            </RowList>
          )}
        </StepShell>

        <PileSheet
          open={pileOpen}
          grades={report.grades}
          busy={report.saving}
          onClose={() => setPileOpen(false)}
          onAdd={(gradeId, count) => void (async () => {
            if (await report.addPile({ pileGradeId: gradeId, count })) {
              setPileOpen(false);
              toast.success(`Записано: ${count} шт`);
            }
          })()}
        />
        <DowntimeSheet
          open={downtimeOpen}
          reasons={report.reasons}
          busy={report.saving}
          onClose={() => setDowntimeOpen(false)}
          onAdd={(reasonId, hours, comment) => void (async () => {
            if (await report.addDowntime({ reasonId, duration: hours, comment: comment || undefined })) {
              setDowntimeOpen(false);
              toast.success('Простой записан');
            }
          })()}
        />
        <DefectSheet
          open={defectOpen}
          equipmentId={facts.equipment?.id ?? null}
          onClose={() => setDefectOpen(false)}
          onCreated={() => { setDefectOpen(false); void load(); }}
        />
      </>
    );
  }

  // ---------- 7. Отчёт о смене ----------
  if (step === 'report') {
    const submitted = report.draft.status === 'submitted';
    return (
      <>
        <StepShell
          title={V2_STEP_TITLE.report}
          subtitle={stepLabel}
          footer={
            <StepButton
              label={submitted ? 'Сдать смену' : 'Отправить отчёт'}
              onClick={() => submitted
                ? setHandoverOpen(true)
                : void (async () => { if (await report.submit()) toast.success('Отчёт отправлен'); })()}
              busy={busy || report.saving}
            />
          }
        >
          <RowList>
            <li><ValueRow label="Время работы" value={elapsed ?? '—'} /></li>
            <li>
              <ValueRow
                label="Моточасы"
                value={facts.meterCurrent != null ? `${formatNumber(facts.meterCurrent)} м/ч` : '—'}
              />
            </li>
            <li><ValueRow label="Сваи выполнено" value={`${report.totalPiles} шт`} /></li>
            <li>
              <ValueRow label="Простой" value={formatDowntimeHours(report.totalDowntime)}
                tone={report.totalDowntime > 0 ? 'warn' : undefined} />
            </li>
            <li>
              <ValueRow
                label="Осмотр после работ"
                value={facts.inspection.postShift?.status === 'COMPLETED' ? 'закрыт'
                  : facts.postShiftAvailable ? 'не закрыт' : 'не настроен'}
                tone={facts.inspection.postShift?.status === 'COMPLETED' ? 'ok' : 'warn'}
              />
            </li>
            <li>
              <ValueRow label="Отчёт" value={submitted ? 'отправлен' : 'черновик'}
                tone={submitted ? 'ok' : 'warn'} />
            </li>
          </RowList>
          {!submitted && (
            <p className="text-xs text-muted-foreground">
              Сначала отчёт, потом передача: сдать смену с неотправленным отчётом нельзя
            </p>
          )}
        </StepShell>

        <HandoverSheet
          open={handoverOpen}
          equipmentName={facts.equipment?.name ?? null}
          busy={busy}
          onClose={() => setHandoverOpen(false)}
          onSubmit={(summary) => void submitHandover(summary)}
        />
      </>
    );
  }

  // ---------- 8. Смена закрыта ----------
  return (
    <StepShell
      title={V2_STEP_TITLE.closed}
      subtitle={stepLabel}
      tone="purple"
      // «На главную» сбрасывает состояние шагов и перечитывает факты. Раньше
      // кнопка только перечитывала: смена оставалась в HANDOVER_PENDING, экран
      // не менялся, и выглядело это как «ничего не происходит». Теперь ниже
      // прямо сказано, почему экран остаётся здесь, пока смену не приняли.
      footer={
        <StepButton
          label="На главную"
          tone="purple"
          onClick={() => {
            setAdmitted(false);
            setAccepted(false);
            setFinishing(false);
            setSiteChecks({});
            setStartChecks({});
            setEngineStartedAt(null);
            setTab('shift');
            void load();
          }}
        />
      }
    >
      <div className="pt-8 text-center">
        <BigCheck tone="purple" />
        <p className="mt-4 text-lg font-bold text-foreground">Спасибо!</p>
        <p className="mt-1 text-sm text-muted-foreground">Смена успешно завершена</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Экран останется здесь, пока следующий оператор или диспетчер не примет машину
        </p>
      </div>
      {/* Итог смены показываем здесь же: уводить за ним на чужой экран истории
          значит выкидывать человека из модуля на последнем шаге. */}
      <RowList>
        <li><ValueRow label="Время работы" value={elapsed ?? '—'} /></li>
        <li><ValueRow label="Сваи выполнено" value={`${report.totalPiles} шт`} /></li>
        <li><ValueRow label="Простой" value={formatDowntimeHours(report.totalDowntime)} /></li>
        {facts.meterCurrent != null && (
          <li><ValueRow label="Моточасы" value={`${formatNumber(facts.meterCurrent)} м/ч`} /></li>
        )}
      </RowList>
    </StepShell>
  );
}
