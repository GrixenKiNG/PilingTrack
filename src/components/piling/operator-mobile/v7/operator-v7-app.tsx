'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState, OperatorPhase,
} from '@/modules/operator-mobile/contracts';
import {PHASE_LABELS, PHASE_ORDER} from '@/modules/operator-mobile/contracts';
import {
  ApiError, currentPosition, fetchState, newCommandId, QueuedOffline, sendCommand,
  sendQueuedCommand, type ProductionEntryInput,
} from '../api';
import {flushQueue, readQueue, retry, subscribeQueue, type QueuedCommand} from '../offline-queue';
import {Banner, Button, Dock, OPERATOR_DOCK, PhoneShell as Shell, Title, type DockTab} from './v7-ui';
import {admissionSteps} from '../safety/admission-steps';
import {AdmissionResult, BriefingFlow, KnowledgeFlow, PpeFlow} from './v7-identity';
import {AcceptFlow, ChecklistFlow, CloseFlow, IncidentFlow, ProductionFlow} from './v7-shift';
import {
  EquipmentScreen, HomeScreen, IncidentsScreen, JournalScreen, MoreScreen, TasksScreen,
  type Detour,
} from './v7-screens';

/**
 * Модуль оператора v7 — экраны визуализации на живых данных, с действиями.
 *
 * ПОЧЕМУ ЭКРАН ВЫБИРАЕТ СЕРВЕР. Фаза смены приходит из ответа сервера и целиком
 * выведена из записанных фактов. У телефона нет своего мнения о том, где смена:
 * закрыл приложение на осмотре, открыл через час — вернулся на осмотр.
 *
 * ПОЧЕМУ ПРАВИЛА НЕ ПОВТОРЕНЫ ЗДЕСЬ. Порядок чек-листов, право записывать
 * выработку, условия закрытия — всё это проверяет сервер. Экран подсказывает и
 * блокирует очевидное (пустая форма), но не решает: вторая копия правила рано
 * или поздно разойдётся с первой и начнёт разрешать запрещённое.
 */


/** Фазы, показываемые полосой прогресса. `CLOSED` — не шаг, а итог. */
const TIMELINE: OperatorPhase[] = PHASE_ORDER.filter((phase) => phase !== 'CLOSED');

const PHASE_TITLES: Record<OperatorPhase, string> = {
  IDENTITY: 'Перед сменой — Техника безопасности',
  ADMISSION: 'Принятие установки',
  PRESHIFT_INSPECTION: 'Предсменный осмотр',
  STARTUP: 'Пуск и ежесменное обслуживание',
  SITE_READY: 'Осмотр площадки',
  WORK: 'Смена идёт',
  CLOSING: 'Сдача смены',
  CLOSED: 'Смена закрыта',
};

const DETOUR_BACK: Record<Detour['kind'], string> = {
  PPE: 'Допуск', BRIEFING: 'Ознакомление', KNOWLEDGE: 'Проверка знаний', ACCEPT: 'Приём',
  CHECKLIST: 'Осмотр', PRODUCTION: 'Выработка', INCIDENT: 'Смена', CLOSE: 'Сдача', RESULT: 'Итог',
};

export function OperatorV7App() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState<QueuedCommand[]>([]);
  const [tab, setTab] = useState<DockTab>('HOME');
  const [detour, setDetour] = useState<Detour | null>(null);
  const coordinates = useRef<{latitude: number; longitude: number} | null>(null);

  /**
   * Ключи команд, переживающие нажатие.
   *
   * На морозе в перчатке по кнопке попадают дважды. Ключ, созданный в
   * обработчике, дал бы два разных ключа на два нажатия — сервер записал бы две
   * пачки свай. Ключ, живущий в состоянии, делает второе нажатие безвредным:
   * сервер узнаёт повтор. Новый ключ выдаётся только после удачи.
   */
  const [commandId, setCommandId] = useState(newCommandId);

  const reload = useCallback(async () => {
    try {
      const next = await fetchState({coordinates: coordinates.current});
      setState(next);
      setLoadError(null);
      setSyncedAt(new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setLoadError(cause instanceof ApiError ? cause.message : 'Не удалось получить состояние смены');
    }
  }, []);

  useEffect(() => {
    // Сначала координаты, потом состояние: без координат сервер не отдаёт
    // погоду, а без погоды в чек-лист не попадают сезонные пункты.
    void (async () => {
      coordinates.current = await currentPosition();
      await reload();
    })();
  }, [reload]);

  useEffect(() => {
    const update = () => setOnline(globalThis.navigator?.onLine ?? true);
    update();
    globalThis.addEventListener?.('online', update);
    globalThis.addEventListener?.('offline', update);
    return () => {
      globalThis.removeEventListener?.('online', update);
      globalThis.removeEventListener?.('offline', update);
    };
  }, []);

  useEffect(() => {
    const sync = () => setQueued(readQueue());
    sync();
    const unsubscribe = subscribeQueue(sync);
    let running = false;
    const flush = async () => {
      if (running) return;
      running = true;
      try {
        const {sent} = await flushQueue(sendQueuedCommand);
        if (sent > 0) await reload();
      } finally {
        running = false;
      }
    };
    globalThis.addEventListener?.('online', () => void flush());
    const timer = setInterval(() => { if (globalThis.navigator?.onLine !== false) void flush(); }, 30_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [reload]);

  /**
   * Выполнить команду и вернуться к обзору.
   *
   * Отказ по существу показываем текстом: «сохранено на устройстве» — не
   * ошибка, а обещание, и форму после него можно закрывать.
   */
  const run = useCallback(async (
    command: Parameters<typeof sendCommand>[0],
    options: {close?: boolean} = {close: true},
  ) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await sendCommand(command);
      setCommandId(newCommandId());
      await reload();
      if (options.close !== false) setDetour(null);
    } catch (cause) {
      if (cause instanceof QueuedOffline) {
        setNotice(cause.message);
        setCommandId(newCommandId());
        if (options.close !== false) setDetour(null);
      } else if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
      } else {
        setActionError(cause instanceof Error ? cause.message : 'Команда не прошла');
      }
    } finally {
      setBusy(false);
    }
  }, [reload]);

  if (loadError) {
    return (
      <Shell online={online} syncedAt={syncedAt} pending={0}>
        <div className="state">
          <h2>Состояние смены недоступно</h2>
          <p>{loadError}</p>
          <Button onClick={() => void reload()}>Повторить</Button>
        </div>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell online={online} syncedAt={syncedAt} pending={0}>
        <div className="state"><h2>Загрузка</h2><p>Читаем состояние смены</p></div>
      </Shell>
    );
  }

  const shiftId = state.shift?.id ?? null;
  const equipmentId = state.assignment?.equipmentId ?? null;
  const openIncidents = state.incidents.filter((incident) => incident.reviewedAt === null).length;
  const pending = queued.filter((item) => item.state === 'PENDING').length;

  const messages = (
    <>
      {actionError ? <Banner tone="bad" title="Не отправлено" note={actionError} /> : null}
      {notice ? <Banner tone="info" title="Сохранено на устройстве" note={notice} /> : null}
      {queued.length > 0 ? (
        <Banner
          tone={pending > 0 ? 'warn' : 'bad'}
          title={`В очереди: ${queued.length}`}
          note={queued.map((item) => item.label).join(', ')}
          action={queued.some((item) => item.state === 'FAILED')
            ? 'Часть записей не ушла — нажмите «Повторить» ниже'
            : 'Уйдут при связи'}
        />
      ) : null}
      {queued.some((item) => item.state === 'FAILED') ? (
        <Button
          tone="soft"
          onClick={() => {
            queued.filter((item) => item.state === 'FAILED').forEach((item) => retry(item.clientCommandId));
          }}
        >
          Повторить отправку
        </Button>
      ) : null}
    </>
  );

  /* ------------------------------------------------------------- шаги --- */

  if (detour) {
    const back = () => { setDetour(null); setActionError(null); };
    return (
      <Shell online={online} syncedAt={syncedAt} pending={pending}
        back={DETOUR_BACK[detour.kind]} onBack={back}>
        {detour.kind === 'PPE' ? (
          <PpeFlow
            busy={busy}
            confirmed={state.identity.ppe.items}
            onBack={back}
            onConfirm={(items) => void run({
              command: 'confirm-ppe', productionDate: state.productionDate, items,
            })}
          />
        ) : null}

        {detour.kind === 'BRIEFING' ? (
          <BriefingFlow
            busy={busy}
            version={state.identity.briefing.version}
            onBack={back}
            onAcknowledge={() => void run({command: 'acknowledge-briefing'})}
          />
        ) : null}

        {detour.kind === 'KNOWLEDGE' ? (
          <KnowledgeFlow
            busy={busy}
            onBack={back}
            onDone={(picks, attemptToken) => void run({command: 'submit-knowledge', attemptToken, picks})}
          />
        ) : null}

        {detour.kind === 'ACCEPT' ? (
          <AcceptFlow
            state={state}
            busy={busy}
            onBack={back}
            onAccept={(chosen, shiftType) => void run({
              command: 'accept-equipment', clientCommandId: commandId, equipmentId: chosen, shiftType,
            })}
          />
        ) : null}

        {detour.kind === 'CHECKLIST' ? (
          <ChecklistDetour
            state={state}
            stage={detour.stage}
            busy={busy}
            onBack={back}
            onSubmit={(answers) => {
              if (!shiftId || !equipmentId) {
                setActionError('Смена не начата: сначала примите установку');
                return;
              }
              void run({
                command: 'submit-checklist', clientCommandId: commandId,
                shiftId, equipmentId, stage: detour.stage, answers,
              });
            }}
          />
        ) : null}

        {detour.kind === 'PRODUCTION' ? (
          <ProductionFlow
            state={state}
            busy={busy}
            kind={detour.entry}
            onBack={back}
            onSubmit={(entry: ProductionEntryInput) => {
              if (!shiftId) {
                setActionError('Смена не начата');
                return;
              }
              void run({command: 'log-production', clientCommandId: commandId, shiftId, entry});
            }}
          />
        ) : null}

        {detour.kind === 'INCIDENT' ? (
          <IncidentFlow
            busy={busy}
            onBack={back}
            onSubmit={(input) => {
              if (!shiftId) {
                setActionError('Происшествие пишется в смену, а смена не начата');
                return;
              }
              void run({
                command: 'report-incident', clientCommandId: commandId, shiftId,
                category: input.category, signs: input.signs, injured: input.injured,
                description: input.description,
              });
            }}
          />
        ) : null}

        {detour.kind === 'CLOSE' ? (
          <CloseFlow
            busy={busy}
            onBack={back}
            onClose={(comment) => {
              if (!shiftId) {
                setActionError('Смена не начата');
                return;
              }
              void run({command: 'close-shift', shiftId, comment});
            }}
          />
        ) : null}

        {detour.kind === 'RESULT' ? (
          <>
            <Title>Итог допуска</Title>
            <AdmissionResult
              operatorName={state.operator.name}
              productionDate={state.productionDate}
              onWork={back}
              steps={[
                {label: 'СИЗ', done: state.identity.ppe.confirmed, note: state.identity.ppe.confirmed ? 'Выполнено' : 'Не выполнено'},
                {label: 'Ознакомление с инструкциями', done: state.identity.briefing.ok, note: state.identity.briefing.ok ? 'Выполнено' : 'Не выполнено'},
                {label: 'Проверка знаний по ТБ', done: state.identity.knowledge.ok, note: state.identity.knowledge.ok ? 'Пройдено' : 'Не пройдено'},
                {label: 'Допуск к смене', done: state.phase !== 'IDENTITY', note: state.phase !== 'IDENTITY' ? 'Разрешён' : 'Ожидает'},
              ]}
            />
          </>
        ) : null}

        <div className="body" style={{paddingTop: 0}}>{messages}</div>
      </Shell>
    );
  }

  /* ------------------------------------------------------------ обзор --- */

  const phaseIndex = TIMELINE.indexOf(state.phase);

  return (
    <Shell
      online={online}
      syncedAt={syncedAt}
      pending={pending}
      back={state.operator.name.split(' ')[0] ?? 'Оператор'}
      dock={(
        <Dock
          items={OPERATOR_DOCK}
          active={tab}
          badges={{MORE: openIncidents}}
          onSelect={(next) => { setTab(next); setActionError(null); }}
        />
      )}
      action={shiftId ? (
        <Button tone="danger" onClick={() => setDetour({kind: 'INCIDENT'})}>
          ⚠ Сообщить об инциденте
        </Button>
      ) : null}
    >
      <Title note={`${state.operator.name}${state.assignment ? ` · ${state.assignment.siteName} · ${state.assignment.equipmentName}` : ''}`}>
        {tab === 'HOME' ? PHASE_TITLES[state.phase] : TAB_TITLES[tab]}
      </Title>

      {tab === 'HOME' ? (
        <div className="tl">
          {TIMELINE.map((phase, index) => (
            <span
              key={phase}
              className={`ph ${state.phase === 'CLOSED' || index < phaseIndex ? 'done' : ''} ${phase === state.phase ? 'now' : ''}`}
            >
              {PHASE_LABELS[phase]}
            </span>
          ))}
        </div>
      ) : null}

      <div className="body">
        {messages}

        {tab === 'HOME' ? (
          <HomeScreen
            state={state}
            busy={busy}
            onStep={(step) => setDetour(step)}
            onFinishWork={() => {
              if (!shiftId) return;
              void run({command: 'finish-work', shiftId}, {close: false});
            }}
          />
        ) : null}

        {/* Учёт выработки — часть смены, а не отдельный раздел: машинист
            записывает сваи там же, где видит, на каком он шаге. Но на фазах
            работы, завершения и закрытия карточку выработки уже рисует сам
            HomeScreen (WorkBlock, ClosingBlock, ClosedBlock) — там отдельная
            выводила бы выработку смены дважды. */}
        {tab === 'HOME'
          && state.phase !== 'WORK'
          && state.phase !== 'CLOSING'
          && state.phase !== 'CLOSED' ? (
          <TasksScreen state={state} onEntry={(entry) => setDetour({kind: 'PRODUCTION', entry})} />
        ) : null}
        {tab === 'SAFETY' ? (
          <SafetyTab state={state} onStep={(step) => setDetour(step)} />
        ) : null}
        {tab === 'EQUIP' ? <EquipmentScreen defects={state.defects} /> : null}
        {tab === 'MORE' ? (
          <>
            <JournalScreen state={state} />
            <IncidentsScreen incidents={state.incidents} />
            <MoreScreen state={state} onResult={() => setDetour({kind: 'RESULT'})} />
          </>
        ) : null}
      </div>
    </Shell>
  );
}

const TAB_TITLES: Record<DockTab, string> = {
  HOME: 'Смена', SAFETY: 'Техника безопасности', EQUIP: 'Техника', MORE: 'Ещё',
};

/** Чек-листы ТБ и шаги допуска — вкладка «ТБ» нижнего меню. */
function SafetyTab({state, onStep}: {state: OperatorMobileState; onStep: (detour: Detour) => void}) {
  const tb = state.checklists.filter((checklist) => checklist.stage === 'TB_PILING' || checklist.stage === 'TB_DRILLING');
  return (
    <>
      <div className="card">
        <div className="ct">Допуск</div>
        {admissionSteps(state).map((step) => {
          const body = (
            <>
              <span className="num">{step.done ? '✓' : step.n}</span>
              <span className="rb"><span className="t">{step.title}</span><span className="s">{step.hint}</span></span>
              {step.opens ? <span className="caret">›</span> : <span className="s">{step.note}</span>}
            </>
          );
          // Строки без действия (подпись ставится с ознакомлением, допуск даёт
          // сервер) не притворяются кнопками: нажатие, которое ничего не
          // делает, человек читает как поломку.
          return step.opens
            ? (
              <button key={step.id} type="button" className={`row ${step.done ? 'done' : ''}`}
                onClick={() => onStep({kind: step.opens as 'PPE' | 'BRIEFING' | 'KNOWLEDGE'})}>
                {body}
              </button>
            )
            : <div key={step.id} className={`row ${step.done ? 'done' : ''}`}>{body}</div>;
        })}
      </div>

      <div className="card">
        <div className="ct">Чек-листы ТБ</div>
        {tb.length === 0 ? <div className="empty">Чек-листы ТБ недоступны</div> : tb.map((checklist) => (
          <button
            key={checklist.stage}
            type="button"
            className={`row ${checklist.done ? 'done' : ''}`}
            onClick={() => onStep({kind: 'CHECKLIST', stage: checklist.stage})}
          >
            <span className="num">{checklist.done ? '✓' : '—'}</span>
            <span className="rb"><span className="t">{checklist.title}</span><span className="s">{checklist.purpose}</span></span>
            <span className="caret">›</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** Чек-лист по этапу. Нет в ответе сервера — значит, этап сейчас не его. */
function ChecklistDetour({state, stage, busy, onSubmit, onBack}: {
  state: OperatorMobileState;
  stage: ChecklistStage;
  busy: boolean;
  onSubmit: (answers: ChecklistAnswer[]) => void;
  onBack: () => void;
}) {
  const checklist = state.checklists.find((item) => item.stage === stage);
  if (!checklist) {
    return (
      <>
        <Title>Чек-лист</Title>
        <div className="body">
          <Banner tone="warn" title="Чек-лист недоступен" note="Этот этап сейчас не открыт." />
          <Button tone="ghost" onClick={onBack}>Назад</Button>
        </div>
      </>
    );
  }
  return (
    <ChecklistFlow
      checklist={checklist}
      busy={busy}
      lastMeter={state.assignment?.lastMeter ?? null}
      onSubmit={onSubmit}
      onBack={onBack}
    />
  );
}

