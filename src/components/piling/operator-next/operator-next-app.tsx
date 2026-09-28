'use client';

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState, OperatorPhase,
} from '@/modules/operator-mobile/contracts';
import {
  ApiError, currentPosition, fetchState, QueuedOffline, sendCommand,
  type ProductionEntryInput,
} from '@/components/piling/operator-mobile/api';
import {OfflineQueueBanner} from '@/components/piling/operator-mobile/offline-queue-banner';
import {useOfflineQueue} from '@/components/piling/operator-mobile/use-offline-queue';
import {BigButton, Panel, PanelTitle, PhaseBar, Screen, TabBar} from '@/components/piling/operator-mobile/ui';
import {BriefingScreen} from '@/components/piling/operator-mobile/screens/briefing-screen';
import {KnowledgeScreen} from '@/components/piling/operator-mobile/screens/knowledge-screen';
import {PpeScreen} from '@/components/piling/operator-mobile/screens/ppe-screen';
import {EquipmentTab} from '@/components/piling/operator-mobile/screens/equipment-tab';
import {IncidentsTab} from '@/components/piling/operator-mobile/screens/incidents-tab';
import {ProfileTab} from '@/components/piling/operator-mobile/screens/profile-tab';
import {SafetyTab} from '@/components/piling/operator-mobile/screens/safety-tab';
import {ClosedScreen} from '@/components/piling/operator-mobile/screens/closing-screen';
import {knownAnswers} from '@/components/piling/operator-mobile/safety/known-answers';
import {AdmissionScreen, type AdmissionDetour} from './admission';
import {ChecklistRunScreen} from './checklist-run';
import {createCommandKeys, type CommandKind, type CommandKeys} from './command-keys';
import {
  emptyDrafts, emptyWorkDraft, type Drafts, type WorkDraft,
} from './drafts';
import {ErrorStrip, NoticeStrip, ActionButton} from './parts';
import {ownPendingCount} from './queue-snapshot';
import {ReportSendScreen} from './report-send';
import {ShiftStartScreen} from './shift-start';
import {WorkScreenNext} from './work';
import {createSingleFlight, type SingleFlight} from './single-flight';
import {humanError} from './words';

/**
 * Рабочее место машиниста «следующего поколения» — шестая версия экрана смены.
 *
 * ЧТО ЗДЕСЬ ОТ ОБОЛОЧКИ, А ЧТО НЕТ. Оболочка владеет только тем, что общее для
 * всех экранов: чтением состояния, очередью устройства, вкладками, черновиками
 * и переходом между шагами. Фазу смены считает СЕРВЕР, а не телефон: закрыл
 * приложение на осмотре — вернулся на осмотр.
 *
 * ЧЕРНОВИКИ ЖИВУТ ЗДЕСЬ. Формы можно размонтировать в любой момент — вкладка,
 * возврат к смене, обязательный чек-лист ТБ. Поэтому набранное хранится выше
 * экранов и сбрасывается только после подтверждённой записи или явной очистки.
 */
type WorkTab = 'SHIFT' | 'SAFETY' | 'EQUIPMENT' | 'MORE';

/** Экраны, открываемые вне очереди фаз. */
type Detour =
  | {kind: AdmissionDetour}
  | {kind: 'CHECKLIST'; stage: ChecklistStage};

/** Чек-лист, закрывающий фазу. Тот же порядок, что на сервере. */
const PHASE_STAGE: Partial<Record<OperatorPhase, ChecklistStage>> = {
  PRESHIFT_INSPECTION: 'PRESHIFT_INSPECTION',
  STARTUP: 'EO_BEFORE',
  SITE_READY: 'SITE_READY',
};

export function OperatorNextApp() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  /**
   * Ошибка чтения. Полноэкранной она становится ТОЛЬКО когда показывать больше
   * нечего (первая загрузка). Если рабочий экран уже есть — это полоса поверх
   * него: сбой обновления не имеет права стирать открытую форму (находка №1
   * ревью).
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [workTab, setWorkTab] = useState<WorkTab>('SHIFT');
  const [detour, setDetour] = useState<Detour | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(() => emptyDrafts(null));
  const coordinates = useRef<{latitude: number; longitude: number} | null>(null);

  /** Номер последнего запроса: применяем только его ответ (находка №4 ревью). */
  const requestSeq = useRef(0);
  /** Замок повторного входа: два нажатия в одном такте — одна команда. */
  const [flight] = useState<SingleFlight>(() => createSingleFlight());
  /** Ключи команд по видам: обновляется только тот, что прошёл. */
  const [keys] = useState<CommandKeys>(() => createCommandKeys());

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const next = await fetchState({
        coordinates: coordinates.current,
        ...(equipmentId ? {equipmentId} : {}),
      });
      // Ответ устаревшего запроса не применяем: иначе выбор установки А,
      // сделанный первым, затрёт показанную Б.
      if (seq !== requestSeq.current) return;
      setState(next);
      setLoadError(null);
      // Роль могла быть исправлена, пока человек смотрел на отказ: успешное
      // чтение снимает экран «доступ закрыт», иначе он остаётся тупиком.
      setForbidden(null);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      if (error instanceof ApiError && error.status === 401) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- намеренно: сессия истекла, полная перезагрузка сбрасывает память вкладки прежнего входа
        globalThis.location.href = '/login';
        return;
      }
      // Отказ по роли — не обрыв связи: отправлять человека жать «Повторить»
      // до вечера нельзя, ему нужно объяснение.
      if (error instanceof ApiError && error.status === 403) {
        setForbidden(humanError(error));
        return;
      }
      setLoadError(humanError(error));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [equipmentId]);

  useEffect(() => {
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

  /**
   * Выполнить команду и сказать, получилось ли.
   *
   * ПРАВИЛО 6 ЗАДАНИЯ. Форма очищается только по `true`. Успех — это сервер
   * принял ИЛИ запись легла в очередь.
   *
   * ЗАМОК ПОВТОРНОГО ВХОДА. Второе нажатие в том же такте не входит в команду
   * вовсе: `busy` в состоянии React ещё не успел стать `true`.
   *
   * ПЕРЕЧИТЫВАНИЕ — ПОСЛЕ ПРИЁМА И НЕ ОТМЕНЯЕТ ЕГО. Сбой чтения после удачной
   * записи оставляет экран рабочим и показывает «Записано», а не «Нет связи».
   */
  const run = useCallback(async (
    kind: CommandKind | null,
    work: () => Promise<unknown>,
  ): Promise<boolean> => {
    const outcome = await flight.run(async () => {
      setBusy(true);
      setActionError(null);
      setNotice(null);
      try {
        await work();
        if (kind) keys.renew(kind);
        return {ok: true, queued: false};
      } catch (error) {
        if (error instanceof QueuedOffline) {
          if (kind) keys.renew(kind);
          return {ok: true, queued: true};
        }
        setActionError(humanError(error));
        // 409 — сервер уже в другом состоянии: перечитываем, чтобы экран не спорил.
        if (error instanceof ApiError && error.status === 409) void reload();
        return {ok: false, queued: false};
      } finally {
        setBusy(false);
      }
    });
    // Повторное нажатие в том же такте: команда уже идёт, второй не будет.
    if (!outcome.started || !outcome.value) return false;
    const {ok, queued} = outcome.value;
    if (!ok) return false;
    setDetour(null);
    if (queued) {
      setNotice('Записано на устройстве: отправим, когда появится связь.');
      return true;
    }
    await reload();
    setNotice('Записано: сервер принял запись.');
    return true;
  }, [reload, flight, keys]);

  // Что записано на устройстве и ещё не ушло. Плашка — одна на все экраны.
  const {queued, flush, retry: retryQueued, discard: discardQueued} = useOfflineQueue(reload);

  const shiftId = state?.shift?.id ?? null;

  const draftsAreCurrent = drafts.shiftId === shiftId;
  const workDraft: WorkDraft = draftsAreCurrent ? drafts.work : emptyWorkDraft();
  const closeNote = draftsAreCurrent ? drafts.closeNote : '';

  const updateWorkDraft = useCallback((updater: (current: WorkDraft) => WorkDraft) => {
    setDrafts((current) => {
      const base = current.shiftId === shiftId ? current : emptyDrafts(shiftId);
      return {...base, work: updater(base.work)};
    });
  }, [shiftId]);

  const updateCloseNote = useCallback((value: string) => {
    setDrafts((current) => {
      const base = current.shiftId === shiftId ? current : emptyDrafts(shiftId);
      return {...base, closeNote: value};
    });
  }, [shiftId]);

  if (forbidden) {
    return (
      <Frame>
        <Screen title="Рабочее место машиниста">
          <Panel tone="warning">
            <PanelTitle tone="warning">{forbidden}</PanelTitle>
            <p className="mt-1 text-sm">
              Смену ведёт машинист, закреплённый за установкой. Записи о выработке и осмотрах
              подаёт он. Если это ошибка — обратитесь к диспетчеру.
            </p>
          </Panel>
          {/* Отказ по роли — не тупик: связь и права могли восстановиться,
              и экран обязан дать попробовать снова без перезагрузки страницы. */}
          <ActionButton label="Обновить" tone="ghost" onClick={() => void reload()} disabled={busy} />
        </Screen>
      </Frame>
    );
  }

  // Полноэкранная ошибка — только когда показывать ещё нечего.
  if (!state) {
    if (loadError) {
      return (
        <Frame>
          <Screen
            title="Нет связи"
            footer={<BigButton onClick={() => void reload()}>Повторить</BigButton>}
          >
            <Panel tone="danger">
              <PanelTitle tone="danger">{loadError}</PanelTitle>
              <p className="mt-1 text-sm">
                Без загруженного состояния нельзя безопасно открыть или закрыть смену. Проверьте связь
                и повторите. Уже записанное на устройстве не пропадёт.
              </p>
            </Panel>
            <OfflineQueueBanner items={queued} onRetry={retryQueued} onDiscard={discardQueued} />
          </Screen>
        </Frame>
      );
    }
    return (
      <Frame>
        <Screen title="Загрузка смены">
          <p className="text-sm text-muted-foreground">Считываем допуски, установку и погоду…</p>
        </Screen>
      </Frame>
    );
  }

  const shift = state.shift;
  const alarmingIncidents = state.incidents.filter((incident) => incident.reviewedAt === null).length;

  /**
   * На закрытии смены показываем вкладку «Смена» независимо от прежнего выбора.
   *
   * ПОЧЕМУ. Если человек после «Завершить работу» остался на «Технике», экран
   * отчёта и кнопка закрытия оказывались за другой вкладкой, хотя следующий шаг
   * смены — именно закрытие (находка Д8 аудита). Не сбрасываем выбор человека, а
   * показываем нужное сейчас: вернуться на «Технику» он сможет после закрытия.
   */
  const closingPhase = state.phase === 'CLOSING' || state.phase === 'CLOSED';
  const effectiveTab: WorkTab = closingPhase ? 'SHIFT' : workTab;

  // Вкладка «Смена» называется одинаково всю смену: меняется только заголовок
  // внутри экрана. Пока название вкладки бегало (Допуск → Работа → Сдача),
  // вернувшийся вечером человек не находил привычную кнопку (находка №11).
  const tabBar = (
    <TabBar<WorkTab>
      active={effectiveTab}
      onSelect={setWorkTab}
      tabs={[
        {id: 'SHIFT', label: 'Смена'},
        {id: 'SAFETY', label: 'ТБ'},
        {id: 'EQUIPMENT', label: 'Техника'},
        {id: 'MORE', label: 'Ещё', badge: alarmingIncidents, alarming: alarmingIncidents > 0},
      ]}
    />
  );

  const stage = detour?.kind === 'CHECKLIST' ? detour.stage : PHASE_STAGE[state.phase] ?? null;
  const checklist = stage ? state.checklists.find((candidate) => candidate.stage === stage) : undefined;
  // Вкладки доступны уже после приёмки, но прячутся на время чек-листа и
  // обходных экранов: посреди осмотра переключаться некуда.
  const tabsVisible = !detour && !checklist && state.phase !== 'IDENTITY' && state.phase !== 'ADMISSION';

  const submitChecklist = (checklistStage: ChecklistStage) => (answers: ChecklistAnswer[]) => {
    const assignment = state.assignment;
    if (!shift || !assignment) return;
    void run('checklist', () => sendCommand({
      command: 'submit-checklist',
      clientCommandId: keys.get('checklist'),
      shiftId: shift.id,
      equipmentId: assignment.equipmentId,
      stage: checklistStage,
      answers,
    }));
  };

  const closeShift = async (comment: string) => {
    if (!shift) return;
    // Попытка отправить всё, что лежит, и свежий пересчёт очереди
    // НЕПОСРЕДСТВЕННО перед закрытием: между показом экрана и нажатием связь
    // могла появиться, а записи — уйти.
    await flush();
    const fresh = ownPendingCount();
    if (fresh !== 0) {
      setActionError(fresh < 0
        ? 'Не удалось проверить очередь на устройстве. Обновите экран и повторите.'
        : `На устройстве ${fresh} неотправленных записей. Сначала отправьте их — иначе выработка не попадёт в отчёт.`);
      setNotice(null);
      return;
    }
    await run(null, () => sendCommand({command: 'close-shift', shiftId: shift.id, comment}));
  };

  const screen = (): ReactNode => {
    if (tabsVisible && effectiveTab !== 'SHIFT') {
      const title = effectiveTab === 'EQUIPMENT' ? 'Техника' : effectiveTab === 'SAFETY' ? 'Техника безопасности' : 'Ещё';
      return (
        <Screen title={title} subtitle={state.assignment?.equipmentName} tabs={tabBar}>
          {effectiveTab === 'EQUIPMENT' ? <EquipmentTab state={state} /> : null}
          {effectiveTab === 'SAFETY' ? (
            <SafetyTab
              state={state}
              onOpen={(step) => setDetour(
                step === 'PPE' ? {kind: 'PPE'} : step === 'BRIEFING' ? {kind: 'BRIEFING'} : {kind: 'KNOWLEDGE'},
              )}
            />
          ) : null}
          {effectiveTab === 'MORE' ? (
            <>
              <IncidentsTab
                state={state}
                busy={busy}
                error={actionError}
                commandId={keys.get('incident')}
                onReport={async (input) => {
                  if (!shift) return false;
                  return run('incident', () => sendCommand({
                    command: 'report-incident',
                    clientCommandId: keys.get('incident'),
                    shiftId: shift.id,
                    ...input,
                  }));
                }}
              />
              <ProfileTab
                state={state}
                onOpenBriefing={() => setDetour({kind: 'BRIEFING'})}
                onOpenKnowledge={() => setDetour({kind: 'KNOWLEDGE'})}
              />
            </>
          ) : null}
        </Screen>
      );
    }

    if (detour?.kind === 'PPE') {
      return (
        <PpeScreen
          busy={busy}
          error={actionError}
          onBack={() => setDetour(null)}
          onConfirm={(items) => void run(null, () => sendCommand({
            command: 'confirm-ppe',
            // Сутки считает сервер и отдаёт их в состоянии: у машиниста в ночной
            // смене полночь наступает посреди работы, и расчёт по часам телефона
            // записал бы проверку за другие сутки.
            productionDate: state.productionDate,
            items,
          }))}
        />
      );
    }

    if (detour?.kind === 'BRIEFING') {
      return (
        <>
          {/*
            Ошибка подтверждения инструктажа раньше уходила в никуда: экран её
            не получал, и человек оставался без объяснения отказа (находка №7).
          */}
          {actionError ? (
            <ErrorStrip
              message={actionError}
              retryLabel="Повторить"
              onRetry={() => void run(null, () => sendCommand({command: 'acknowledge-briefing'}))}
            />
          ) : null}
          <BriefingScreen
            busy={busy}
            onBack={() => setDetour(null)}
            onAcknowledge={() => void run(null, () => sendCommand({command: 'acknowledge-briefing'}))}
          />
        </>
      );
    }

    if (detour?.kind === 'KNOWLEDGE') {
      return (
        <KnowledgeScreen
          busy={busy}
          error={actionError}
          onBack={() => setDetour(null)}
          onDone={(picks, attemptToken) => void run(null, () => sendCommand({command: 'submit-knowledge', picks, attemptToken}))}
        />
      );
    }

    // Обходной экран запрошен, а чек-листа у сервера нет: раньше это был тупик —
    // кнопка есть, открывать нечего, вкладки спрятаны (находка №8).
    if (detour?.kind === 'CHECKLIST' && !checklist) {
      return (
        <Screen title="Осмотр недоступен" subtitle={state.assignment?.equipmentName} tabs={tabBar}>
          <Panel tone="warning">
            <PanelTitle tone="warning">Сервер не отдал этот чек-лист</PanelTitle>
            <p className="mt-1 text-sm">
              Списка «{stage}» в состоянии смены нет. Это бывает, пока смена не перечитана целиком.
              Нажмите «Обновить»; если список не появится — вернитесь к смене, там видно, что делать дальше.
            </p>
          </Panel>
          <ActionButton label="Обновить" onClick={() => void reload()} disabled={busy} />
          <ActionButton label="Назад к смене" tone="ghost" onClick={() => setDetour(null)} />
        </Screen>
      );
    }

    if (checklist) {
      return (
        <ChecklistRunScreen
          key={checklist.stage}
          checklist={checklist}
          warnings={state.warnings}
          busy={busy}
          error={actionError}
          commandId={keys.get('checklist')}
          lastMeter={state.assignment?.lastMeter ?? null}
          known={knownAnswers(checklist.stage, state)}
          onSubmit={submitChecklist(checklist.stage)}
          onBack={detour ? () => setDetour(null) : undefined}
        />
      );
    }

    switch (state.phase) {
      case 'IDENTITY':
        return (
          <AdmissionScreen
            state={state}
            busy={busy}
            onOpen={(step) => setDetour({kind: step})}
            onContinue={() => void reload()}
          />
        );
      case 'ADMISSION':
        return (
          <ShiftStartScreen
            state={state}
            busy={busy}
            loading={loading}
            error={actionError}
            selectedEquipmentId={equipmentId}
            onSelectEquipment={setEquipmentId}
            onReload={() => void reload()}
            onAccept={(input) => void run('accept', () => sendCommand({
              command: 'accept-equipment',
              clientCommandId: keys.get('accept'),
              equipmentId: input.equipmentId,
              shiftType: input.shiftType,
            }))}
          />
        );
      case 'WORK': {
        if (!shift) {
          return (
            <Screen title="Смена" subtitle={state.assignment?.equipmentName} tabs={tabsVisible ? tabBar : undefined}>
              <Panel tone="warning">
                <PanelTitle tone="warning">Смена не открыта</PanelTitle>
                <p className="mt-1 text-sm">
                  Сервер не отдал открытую смену. Нажмите «Обновить», чтобы перечитать состояние.
                </p>
              </Panel>
              <ActionButton label="Обновить" tone="ghost" onClick={() => void reload()} />
            </Screen>
          );
        }
        return (
          <WorkScreenNext
            state={state}
            busy={busy}
            error={actionError}
            tabs={tabsVisible ? tabBar : undefined}
            draft={workDraft}
            onDraftChange={updateWorkDraft}
            onOpenTab={setWorkTab}
            onOpenSafety={(safetyStage) => setDetour({kind: 'CHECKLIST', stage: safetyStage})}
            onFinish={() => void run(null, () => sendCommand({command: 'finish-work', shiftId: shift.id}))}
            onSubmitEntry={(entry: ProductionEntryInput) => run('production', () => sendCommand({
              command: 'log-production',
              clientCommandId: keys.get('production'),
              shiftId: shift.id,
              entry,
            }))}
            onCorrect={(input) => run('correction', () => sendCommand({
              command: 'correct-production',
              clientCommandId: keys.get('correction'),
              shiftId: shift.id,
              ...input,
            }))}
          />
        );
      }
      case 'CLOSING':
        if (!shift) {
          return (
            <Screen title="Смена" subtitle={state.assignment?.equipmentName} tabs={tabsVisible ? tabBar : undefined}>
              <Panel tone="warning">
                <PanelTitle tone="warning">Смена не открыта</PanelTitle>
                <p className="mt-1 text-sm">Нажмите «Обновить», чтобы перечитать состояние.</p>
              </Panel>
              <ActionButton label="Обновить" tone="ghost" onClick={() => void reload()} />
            </Screen>
          );
        }
        return (
          <ReportSendScreen
            state={state}
            busy={busy}
            error={actionError}
            tabs={tabsVisible ? tabBar : undefined}
            unsentCount={queued.length}
            closeNote={closeNote}
            onCloseNoteChange={updateCloseNote}
            onOpenService={() => setDetour({kind: 'CHECKLIST', stage: 'EO_AFTER'})}
            onFlushQueued={() => void flush()}
            onReload={() => void reload()}
            onClose={(comment) => void closeShift(comment)}
          />
        );
      case 'CLOSED':
        return <ClosedScreen state={state} tabs={tabsVisible ? tabBar : undefined} />;
      default:
        return (
          <Screen title="Смена" subtitle={state.assignment?.equipmentName} tabs={tabsVisible ? tabBar : undefined}>
            <Panel>
              <PanelTitle>Раздел пока недоступен</PanelTitle>
              <p className="mt-1 text-sm">
                Этот шаг смены пока не поддержан на сервере или ещё не собран. Вернитесь на «Смену»
                или нажмите «Обновить».
              </p>
            </Panel>
            <ActionButton label="Обновить" tone="ghost" onClick={() => void reload()} />
          </Screen>
        );
    }
  };

  return (
    <Frame>
      <PhaseBar progress={state.progress} />
      <div className="px-3 pt-2">
        <p className={online ? 'text-2xs text-muted-foreground' : 'text-2xs font-semibold text-warning-strong'}>
          {online ? 'Связь есть' : 'Связи нет — записи сохраняются на устройстве'}
        </p>
      </div>
      {/* Ошибка перечитывания — полосой поверх рабочего экрана: форма остаётся. */}
      {loadError ? <ErrorStrip message={loadError} onRetry={() => void reload()} /> : null}
      {notice ? <NoticeStrip>{notice}</NoticeStrip> : null}
      <OfflineQueueBanner items={queued} onRetry={retryQueued} onDiscard={discardQueued} />
      {screen()}
    </Frame>
  );
}

/**
 * Рамка рабочего места.
 *
 * Ширину ограничиваем и центрируем: на планшете 560 точек — это предел, за
 * которым строка перестаёт читаться с вытянутой руки. Класс `.onx-frame` даёт
 * рамку и тень на широком экране (см. `operator-next.css`).
 */
function Frame({children}: {children: ReactNode}) {
  return <div className="onx-frame">{children}</div>;
}
