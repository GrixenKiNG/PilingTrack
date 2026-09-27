'use client';

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState, OperatorPhase,
} from '@/modules/operator-mobile/contracts';
import {
  ApiError, currentPosition, fetchState, newCommandId, QueuedOffline, sendCommand,
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
import {knownAnswers} from '@/components/piling/operator-mobile/safety/known-answers';
import {AdmissionScreen, type AdmissionDetour} from './admission';
import {ActionButton} from './parts';
import {ChecklistRunScreen} from './checklist-run';
import {ShiftStartScreen} from './shift-start';
import {WorkScreenNext} from './work';
import {humanError} from './words';

/**
 * Рабочее место машиниста «следующего поколения» — шестая версия экрана смены.
 *
 * ЧТО ЗДЕСЬ ОТ ОБОЛОЧКИ, А ЧТО НЕТ. Оболочка владеет только тем, что общее для
 * всех экранов: чтением состояния, очередью устройства, вкладками и переходом
 * между шагами. Фазу смены считает СЕРВЕР, а не телефон: закрыл приложение на
 * осмотре — вернулся на осмотр.
 *
 * ПОЧЕМУ СОСТОЯНИЕ ЧИТАЕТСЯ ЗАНОВО ПОСЛЕ КАЖДОЙ УДАЧИ. Экран — отражение
 * записанных фактов. Пока он показывал бы своё мнение о том, что получилось,
 * две копии одного правила («готов ли я к работе») расходились бы: одна в
 * телефоне, другая на сервере.
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [workTab, setWorkTab] = useState<WorkTab>('SHIFT');
  const [detour, setDetour] = useState<Detour | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const coordinates = useRef<{latitude: number; longitude: number} | null>(null);

  /**
   * Ключи команд. Живут до ближайшей удачи и выдаются заново после неё: пока
   * ключ переживает нажатие, случайный второй тап на морозе в перчатке сервер
   * узнаёт как повтор и второй записи не делает.
   */
  const [checklistCommandId, setChecklistCommandId] = useState(newCommandId);
  const [productionCommandId, setProductionCommandId] = useState(newCommandId);
  const [incidentCommandId, setIncidentCommandId] = useState(newCommandId);
  const [correctionCommandId, setCorrectionCommandId] = useState(newCommandId);
  const [acceptCommandId, setAcceptCommandId] = useState(newCommandId);

  const reload = useCallback(async () => {
    try {
      const next = await fetchState({
        coordinates: coordinates.current,
        ...(equipmentId ? {equipmentId} : {}),
      });
      setState(next);
      setLoadError(null);
    } catch (error) {
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
   * ПРАВИЛО 6 ЗАДАНИЯ. Экран очищает форму только по `true`. Успех — это сервер
   * принял ИЛИ запись легла в очередь. Обратный порядок («очистили и отправили»)
   * на обрыве связи стирает введённое, а набирать заново приходится по памяти.
   */
  const run = useCallback(async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    const renewKeys = () => {
      setChecklistCommandId(newCommandId());
      setProductionCommandId(newCommandId());
      setIncidentCommandId(newCommandId());
      setCorrectionCommandId(newCommandId());
      setAcceptCommandId(newCommandId());
    };
    try {
      await work();
      renewKeys();
      setDetour(null);
      await reload();
      return true;
    } catch (error) {
      // Запись легла в очередь на устройстве — это принято, а не отказ.
      if (error instanceof QueuedOffline) {
        renewKeys();
        setDetour(null);
        setActionError(null);
        return true;
      }
      setActionError(humanError(error));
      // 409 — сервер уже в другом состоянии (ответ на прошлое нажатие потерялся,
      // смена закрыта): перечитываем, чтобы экран не спорил с ним.
      if (error instanceof ApiError && error.status === 409) void reload();
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  // Что записано на устройстве и ещё не ушло. Плашка — одна на все экраны.
  const {queued, retry: retryQueued, discard: discardQueued} = useOfflineQueue(reload);

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
        </Screen>
      </Frame>
    );
  }

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

  if (!state) {
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

  // Вкладка «Смена» называется одинаково всю смену: меняется только заголовок
  // внутри экрана. Пока название вкладки бегало (Допуск → Работа → Сдача),
  // вернувшийся вечером человек не находил привычную кнопку (находка №11).
  const tabBar = (
    <TabBar<WorkTab>
      active={workTab}
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
  // обходных экранов: посреди осмотра переключаться некуда, его надо закончить.
  const tabsVisible = !detour && !checklist && state.phase !== 'IDENTITY' && state.phase !== 'ADMISSION';

  const submitChecklist = (checklistStage: ChecklistStage) => (answers: ChecklistAnswer[]) => {
    const assignment = state.assignment;
    if (!shift || !assignment) return;
    void run(() => sendCommand({
      command: 'submit-checklist',
      clientCommandId: checklistCommandId,
      shiftId: shift.id,
      equipmentId: assignment.equipmentId,
      stage: checklistStage,
      answers,
    }));
  };

  const screen = (): ReactNode => {
    if (tabsVisible && workTab !== 'SHIFT') {
      const title = workTab === 'EQUIPMENT' ? 'Техника' : workTab === 'SAFETY' ? 'Техника безопасности' : 'Ещё';
      return (
        <Screen title={title} subtitle={state.assignment?.equipmentName} tabs={tabBar}>
          {workTab === 'EQUIPMENT' ? <EquipmentTab state={state} /> : null}
          {workTab === 'SAFETY' ? (
            <SafetyTab
              state={state}
              onOpen={(step) => setDetour(
                step === 'PPE' ? {kind: 'PPE'} : step === 'BRIEFING' ? {kind: 'BRIEFING'} : {kind: 'KNOWLEDGE'},
              )}
            />
          ) : null}
          {workTab === 'MORE' ? (
            <>
              <IncidentsTab
                state={state}
                busy={busy}
                error={actionError}
                commandId={incidentCommandId}
                onReport={async (input) => {
                  if (!shift) return false;
                  return run(() => sendCommand({
                    command: 'report-incident',
                    clientCommandId: incidentCommandId,
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
          onConfirm={(items) => void run(() => sendCommand({
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
        <BriefingScreen
          busy={busy}
          onBack={() => setDetour(null)}
          onAcknowledge={() => void run(() => sendCommand({command: 'acknowledge-briefing'}))}
        />
      );
    }

    if (detour?.kind === 'KNOWLEDGE') {
      return (
        <KnowledgeScreen
          busy={busy}
          error={actionError}
          onBack={() => setDetour(null)}
          onDone={(picks, attemptToken) => void run(() => sendCommand({command: 'submit-knowledge', picks, attemptToken}))}
        />
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
          commandId={checklistCommandId}
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
            error={actionError}
            selectedEquipmentId={equipmentId}
            onSelectEquipment={setEquipmentId}
            onReload={() => void reload()}
            onAccept={(input) => void run(() => sendCommand({
              command: 'accept-equipment',
              clientCommandId: acceptCommandId,
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
                <div className="mt-3">
                  <ActionButton label="Обновить" tone="ghost" onClick={() => void reload()} />
                </div>
              </Panel>
            </Screen>
          );
        }
        return (
          <WorkScreenNext
            state={state}
            busy={busy}
            error={actionError}
            tabs={tabsVisible ? tabBar : undefined}
            onOpenTab={setWorkTab}
            onOpenSafety={(safetyStage) => setDetour({kind: 'CHECKLIST', stage: safetyStage})}
            onFinish={() => void run(() => sendCommand({command: 'finish-work', shiftId: shift.id}))}
            onSubmitEntry={(entry: ProductionEntryInput) => run(() => sendCommand({
              command: 'log-production',
              clientCommandId: productionCommandId,
              shiftId: shift.id,
              entry,
            }))}
            onCorrect={(input) => run(() => sendCommand({
              command: 'correct-production',
              clientCommandId: correctionCommandId,
              shiftId: shift.id,
              ...input,
            }))}
          />
        );
      }
      default:
        return (
          <Screen title="Смена" subtitle={state.assignment?.equipmentName} tabs={tabsVisible ? tabBar : undefined}>
            <Panel>
              <PanelTitle>Экран готовится</PanelTitle>
              <p className="mt-1 text-sm">
                Допуск, приём установки, осмотры и работа подключены. Экран конца смены —
                следующим коммитом.
              </p>
            </Panel>
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
