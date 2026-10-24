'use client';

import {ScreenPpe, ScreenBriefing, ScreenKnowledge} from "./v10-screens-admission";


import {ScreenIncidents, ScreenMore} from "./v10-screens-incidents";


import {ScreenSafetyChecklists, ScreenClosing, ScreenReport, ScreenSafety} from "./v10-screens-closing";


import { ScreenToday, ScreenDocs, ScreenAccept, ScreenWork, ScreenMaint } from "./v10-screens-shift";


import { dateRu, shiftType, SCREENS, TABS, STEPS, PHASE_STAGE, stepIndex, type Go } from "./v10-shared";
export {ppeOutcome} from "./v10-shared";


import {nextStep} from '../shift-next-step';
import {NextStepTab} from '../step-bar';
import {useCallback, useEffect, useRef, useState} from 'react';
import type { ChecklistAnswer, ChecklistStage, IncidentCategory, IncidentSign, OperatorMobileState } from '@/modules/operator-mobile';
import {ChecklistScreen} from '../screens/checklist-screen';
import {knownAnswers} from '../safety/known-answers';
import type {SelfSafetyView} from '@/modules/safety';
import {ApiError, QueuedOffline, currentPosition, fetchState, newCommandId, sendCommand} from '../api';
import {OfflineQueueBanner} from '../offline-queue-banner';
import {useOfflineQueue} from '../use-offline-queue';
import type {ProductionEntryInput} from '../api';
import { type CorrectionInput } from './v10-entries';
import { Badge, Banner, Card, Icon, Navbar, Nodata, Tabbar } from './v10-ui';

/* ------------------------------------------------------------ приложение --- */

export function OperatorV10App() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  const [safety, setSafety] = useState<SelfSafetyView | null>(null);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Отказ сервера — отдельно от «Записано» и заметно. Раньше оба жили в одной
   * голубой полосе вверху страницы: машинист, прокрутивший форму вниз, отказа
   * не видел — «простой не записывается», «ЕО ничего не делает» (28.09.2026).
   */
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState('today');
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const oldShift = state?.shift && state.shift.productionDate < state.productionDate
    && (state.phase === 'WORK' || state.phase === 'CLOSING');
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Новое сообщение — к нему: полоса вверху, форма могла быть прокручена вниз.
  useEffect(() => {
    if (notice || actionError) contentRef.current?.scrollIntoView({block: 'start', behavior: 'smooth'});
  }, [notice, actionError]);

  /**
   * Ключ команды переживает нажатие.
   *
   * На морозе в перчатке по кнопке попадают дважды. Ключ, созданный прямо в
   * обработчике, давал бы два разных ключа на два нажатия, и сервер записал бы
   * две команды. Новый ключ выдаётся только после удачной отправки.
   */
  const [commandId, setCommandId] = useState(newCommandId);

  const reload = useCallback(async () => {
    try {
      const coordinates = await currentPosition();
      const next = await fetchState({coordinates});
      setState(next);
      setLoadError(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- намеренно: сессия истекла, полная перезагрузка сбрасывает кэш маршрутов и память вкладки прежнего входа
        window.location.href = '/login';
        return;
      }
      setState(null);
      setLoadError(cause instanceof Error ? cause.message : 'Не удалось получить состояние смены');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await reload(); })();
  }, [reload]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/safety/my-clearance', {
          cache: 'no-store', credentials: 'same-origin',
        });
        const payload = await response.json().catch(() => null) as
          (SelfSafetyView & {error?: string}) | null;
        if (!response.ok) throw new Error(payload?.error ?? 'Раздел ТБ недоступен');
        setSafety(payload as SelfSafetyView);
      } catch (cause) {
        setSafetyError(cause instanceof Error ? cause.message : 'Раздел ТБ недоступен');
      }
    })();
  }, []);

  /** true — сервер принял (или запись легла в очередь); формы очищаются только по нему. */
  const run = useCallback(async (fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      await fn();
      setCommandId(newCommandId());
      setNotice(done);
      await reload();
      return true;
    } catch (cause) {
      // Запись легла в очередь — это принятая запись, а не отказ: следующая
      // обязана получить новый ключ. Со старым ключом очередь считала её
      // повтором той же записи и молча не брала, а сервер — тем более.
      if (cause instanceof QueuedOffline) {
        setCommandId(newCommandId());
        setNotice(cause.message);
        return true;
      }
      setActionError(cause instanceof Error ? cause.message : 'Действие не выполнено');
      // 409 — сервер уже в другом состоянии: перечитываем, чтобы экран не спорил.
      if (cause instanceof ApiError && cause.status === 409) void reload();
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const {queued, flush: flushQueued, retry: retryQueued, discard: discardQueued} = useOfflineQueue(reload);


  const accept = useCallback(() => {
    const equipmentId = state?.assignment?.equipmentId ?? state?.options[0]?.equipmentId;
    if (!equipmentId) {
      setNotice('Установка за вами не закреплена: технику назначает диспетчер.');
      return;
    }
    void run(() => sendCommand({
      command: 'accept-equipment', clientCommandId: commandId, equipmentId, shiftType: shiftType(),
    }), 'Установка принята.');
  }, [commandId, run, state]);

  /* Шаги допуска. Все три — строго онлайн: откладывать допуск в очередь значит
     пустить человека на площадку по записи, которой сервер ещё не видел. */
  const confirmPpe = useCallback((items: string[]) => {
    const day = state?.productionDate;
    if (!day) {
      setNotice('Производственные сутки не определены: обновите состояние.');
      return;
    }
    void run(() => sendCommand({command: 'confirm-ppe', productionDate: day, items}), 'СИЗ подтверждены.');
  }, [run, state]);

  const acknowledgeBriefing = useCallback(() => {
    void run(() => sendCommand({command: 'acknowledge-briefing'}), 'Ознакомление записано.');
  }, [run]);

  const submitKnowledge = useCallback(
    (picks: {questionId: string; picked: number}[], attemptToken: string) => {
      void run(() => sendCommand({command: 'submit-knowledge', attemptToken, picks}), 'Проверка знаний записана.');
    },
    [run],
  );

  const reportIncident = useCallback((input: {
    category: IncidentCategory; signs: IncidentSign[]; injured: boolean; description: string;
  }) => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setNotice('Смена не открыта: записать происшествие некуда.');
      return;
    }
    void run(() => sendCommand({
      command: 'report-incident', clientCommandId: commandId, shiftId, ...input,
    }), 'Происшествие записано.');
  }, [commandId, run, state]);

  /**
   * Сдача чек-листа: ответы собирает общий экран (описание замечаний, фото,
   * замеры), здесь только отправка. Успех возвращается, чтобы экран шага
   * вернул человека к порядку смены, а не оставлял на сданном списке.
   */
  const submitChecklist = useCallback(async (stage: ChecklistStage, checklistAnswers: ChecklistAnswer[], restoredCommandId?: string): Promise<boolean> => {
    const shiftId = state?.shift?.id;
    const equipmentId = state?.assignment?.equipmentId;
    const list = state?.checklists.find((item) => item.stage === stage);
    if (!shiftId || !equipmentId || !list) {
      setActionError('Список недоступен: сначала примите установку.');
      return false;
    }
    return run(() => sendCommand({
      command: 'submit-checklist',
      clientCommandId: restoredCommandId ?? commandId,
      shiftId,
      equipmentId,
      stage,
      answers: checklistAnswers,
    }), list.title + ': сдано.');
  }, [commandId, run, state]);

  const logProduction = useCallback(async (entry: ProductionEntryInput): Promise<boolean> => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setActionError('Смена не начата: записывать некуда.');
      return false;
    }
    return run(
      () => sendCommand({command: 'log-production', clientCommandId: commandId, shiftId, entry}),
      'Записано.',
    );
  }, [commandId, run, state]);

  const correctProduction = useCallback(async (input: CorrectionInput): Promise<boolean> => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setActionError('Смена не начата: поправлять нечего.');
      return false;
    }
    return run(
      () => sendCommand({command: 'correct-production', clientCommandId: commandId, shiftId, ...input}),
      'Поправка записана.',
    );
  }, [commandId, run, state]);

  /** Работа закончена: сервер переводит смену в сдачу, дальше ЕО после работы. */
  const finishWork = useCallback(() => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setActionError('Смена не начата: завершать нечего.');
      return;
    }
    void run(() => sendCommand({command: 'finish-work', shiftId}), 'Работа завершена. Дальше — ЕО после работы.')
      .then((ok) => { if (ok) setActive('step'); });
  }, [run, state]);

  const closeShift = useCallback(() => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setActionError('Смена не начата: закрывать нечего.');
      return;
    }
    void run(() => sendCommand({command: 'close-shift', shiftId, comment: ''}), 'Смена закрыта.');
  }, [run, state]);

  /**
   * Экран текущего шага — по фазе сервера. Одна точка входа вместо
   * разбросанных «осмотр», «готовность», «обслуживание», «закрытие».
   */
  const stepScreen = (current: OperatorMobileState) => {
    const stage = current.phase === 'CLOSING'
      && current.checklists.some((list) => list.stage === 'EO_AFTER' && list.done)
      ? undefined
      : PHASE_STAGE[current.phase];
    const list = stage ? current.checklists.find((item) => item.stage === stage) : undefined;
    if (current.phase === 'IDENTITY') {
      return <ScreenSafety state={current} view={safety} error={safetyError} go={setActive} />;
    }
    if (current.phase === 'ADMISSION') {
      return <ScreenAccept state={current} busy={busy} onAccept={accept} go={setActive} />;
    }
    if (stage) {
      if (!list) return <Card><Nodata>Список «{stage}» не пришёл с сервера — обновите экран</Nodata></Card>;
      return (
        <ChecklistScreen
          draftUserId={current.operator?.id}
          draftShiftId={current.shift?.id}
          key={`${current.shift?.id}:${current.assignment?.equipmentId}:${list.stage}`}
          checklist={list}
          warnings={current.warnings}
          busy={busy}
          error={actionError}
          commandId={commandId}
          lastMeter={current.assignment?.lastMeter ?? null}
          known={knownAnswers(list.stage, current)}
          onBack={() => setActive('today')}
          onSubmit={async (checklistAnswers, restoredCommandId) => {
            const ok = await submitChecklist(list.stage, checklistAnswers, restoredCommandId);
            if (ok) setActive(list.stage === 'EO_AFTER' ? 'closing' : 'today');
            return ok;
          }}
        />
      );
    }
    if (current.phase === 'WORK' && !oldShift) return <ScreenWork state={current} busy={busy} onLog={logProduction} onCorrect={correctProduction} go={setActive} />;
    return <ScreenClosing state={current} busy={busy} onFinish={finishWork} onClose={closeShift} go={goFromClosing}
      unsent={queued.length} onFlush={() => void flushQueued()} />;
  };

  /** Куда ведёт «Следующий шаг»: экран этого модуля по действию из shift-next-step. */
  const goNextStep = (value: OperatorMobileState) => {
    setEditingShiftId(null);
    const action = nextStep(value).action;
    switch (action.kind) {
      case 'ADMISSION':
        setActive(action.open === 'PPE' ? 'ppe' : action.open === 'BRIEFING' ? 'briefing' : 'knowledge');
        break;
      case 'WAIT_ADMISSION':
        void reload();
        break;
      case 'ACCEPT_EQUIPMENT': setActive('accept'); break;
      case 'CHECKLIST':
      case 'SERVICE_AFTER': setActive('step'); break;
      case 'LOG_WORK': setActive('work'); break;
      case 'CLOSE_SHIFT': setActive('closing'); break;
      default: break;
    }
  };

  const current = SCREENS.find((screen) => screen.id === active) ?? SCREENS[0];
  const activeTab = TABS.find((tab) => tab.screen === current.id)?.key ?? current.tab;
  const goFromClosing: Go = (screen) => {
    setEditingShiftId(screen === 'work' ? state?.shift?.id ?? null : null);
    setActive(screen);
  };

  const body = (() => {
    if (loading) {
      return <><div className="ov10-skel" /><div className="ov10-skel short" /><div className="ov10-skel" /></>;
    }
    if (current.id === 'safety') return <ScreenSafety state={state} view={safety} error={safetyError} go={setActive} />;
    if (!state) {
      return (
        <Card>
          <Nodata>Состояние смены недоступно</Nodata>
        </Card>
      );
    }
    switch (current.id) {
      case 'docs': return <ScreenDocs state={state} />;
      case 'more': return <ScreenMore state={state} go={setActive} />;
      case 'ppe': return <ScreenPpe state={state} busy={busy} onConfirm={confirmPpe} go={setActive} />;
      case 'briefing': return <ScreenBriefing state={state} busy={busy} onAcknowledge={acknowledgeBriefing} />;
      case 'knowledge': return <ScreenKnowledge busy={busy} onDone={submitKnowledge} />;
      case 'incidents': return <ScreenIncidents state={state} busy={busy} onReport={reportIncident} />;
      case 'tb': return (
        <ScreenSafetyChecklists state={state} busy={busy} error={actionError} commandId={commandId}
          onSubmit={submitChecklist} go={setActive} />
      );
      case 'accept': return <ScreenAccept state={state} busy={busy} onAccept={accept} go={setActive} />;
      case 'step': return stepScreen(state);
      case 'work': return oldShift && editingShiftId !== state.shift?.id ? (
        <ScreenClosing state={state} busy={busy} onFinish={finishWork} onClose={closeShift} go={goFromClosing}
          unsent={queued.length} onFlush={() => void flushQueued()} />
      ) : <>
        <ScreenWork state={state} busy={busy} onLog={logProduction} onCorrect={correctProduction} go={goFromClosing} />
        {oldShift && state.phase === 'WORK' ? <button type="button" className="ov10-btn ghost" onClick={() => goFromClosing('closing')}>К сдаче смены</button> : null}
      </>;
      case 'maint': return <ScreenMaint state={state} go={setActive} />;
      case 'closing': return (
        <ScreenClosing state={state} busy={busy} onFinish={finishWork} onClose={closeShift} go={goFromClosing}
          unsent={queued.length} onFlush={() => void flushQueued()} />
      );
      case 'report': return <ScreenReport state={state} />;
      // «Смена» — всегда лестница шагов: что сделано, что сейчас, что дальше.
      default: return <ScreenToday state={state} go={setActive} />;
    }
  })();

  return (
    <div className="ov10-screen">
      <div className="ov10-top">
        <Navbar
          title={current.id === 'step' && state ? (STEPS[stepIndex(state.phase)]?.title ?? 'Смена закрыта') : current.title}
          onBack={current.id === 'today' ? undefined : () => setActive('today')}
          right={(
            <button type="button" className="iconbtn" onClick={() => void reload()} aria-label="Обновить">
              <Icon name="refresh" size={18} />
            </button>
          )}
        />
      </div>
      <div className="ov10-content" ref={contentRef}>
        {oldShift && state?.shift ? <Banner tone="warn" title={`Не сдана смена за ${dateRu(state.shift.productionDate)}`}>Дописать можно только работу этой смены. Сегодняшняя работа — после открытия новой смены.</Banner> : null}
        {loadError ? <Banner tone="warn" title={loadError}>
          <button type="button" className="ov10-btn" onClick={() => void reload()}>Повторить</button>
        </Banner> : null}
        {actionError ? <Banner tone="bad" title={`Не записано: ${actionError}`} /> : null}
        {notice ? <Banner tone="info" title={notice} /> : null}
        <OfflineQueueBanner items={queued} onRetry={retryQueued} onDiscard={discardQueued} className="space-y-1" />
        {!loading && !state && !loadError ? <Badge tone="warn">нет данных</Badge> : null}
        {body}
      </div>
      <Tabbar
        tabs={TABS}
        active={activeTab}
        onSelect={(key) => setActive(TABS.find((tab) => tab.key === key)?.screen ?? 'today')}
        // Кнопка «Следующий шаг» между «ТБ» и «Техникой» (решение владельца 09.10.2026).
        extra={state ? {
          after: 'safety',
          node: (
            <NextStepTab
              step={nextStep(state)}
              busy={busy}
              onNext={() => goNextStep(state)}
              onFinishWork={finishWork}
              labelSize="13px"
              labelColor="var(--orange)"
              ringColor="var(--navy)"
            />
          ),
        } : undefined}
      />
    </div>
  );
}
