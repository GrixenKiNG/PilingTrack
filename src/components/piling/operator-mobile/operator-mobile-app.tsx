'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  ApiError, currentPosition, fetchState, newCommandId, sendCommand, type ProductionEntryInput,
} from './api';
import {BigButton, Panel, PanelTitle, PhaseBar, Screen, TabBar} from './ui';
import {IdentityScreen} from './screens/identity-screen';
import {BriefingScreen} from './screens/briefing-screen';
import {KnowledgeScreen} from './screens/knowledge-screen';
import {AdmissionScreen} from './screens/admission-screen';
import {ChecklistScreen} from './screens/checklist-screen';
import {WorkScreen} from './screens/work-screen';
import {isIncidentOpen} from '@/modules/operator-mobile/contracts';
import {ClosedScreen, ClosingScreen} from './screens/closing-screen';
import {EquipmentTab} from './screens/equipment-tab';
import {IncidentsTab} from './screens/incidents-tab';
import {ProfileTab} from './screens/profile-tab';

/** Чек-лист, закрывающий фазу. Тот же порядок, что на сервере. */
const PHASE_STAGE: Partial<Record<OperatorMobileState['phase'], ChecklistStage>> = {
  PRESHIFT_INSPECTION: 'PRESHIFT_INSPECTION',
  STARTUP: 'EO_BEFORE',
  SITE_READY: 'SITE_READY',
};

/**
 * Разделы, доступные после начала работы.
 *
 * До этого экран ведёт человека по порядку — допуск, приём, осмотр, пуск,
 * площадка, — и порядок здесь не удобство, а безопасность. Когда работа
 * началась, ведение заканчивается, и машинист сам решает, куда смотреть.
 */
type WorkTab = 'SHIFT' | 'EQUIPMENT' | 'INCIDENTS' | 'PROFILE';

/** Экраны, открываемые вне очереди фаз. */
type Detour = {kind: 'BRIEFING'} | {kind: 'KNOWLEDGE'} | {kind: 'CHECKLIST'; stage: ChecklistStage};

/**
 * Мобильное рабочее место машиниста.
 *
 * ПОЧЕМУ ЭКРАН ВЫБИРАЕТ СЕРВЕР, А НЕ КЛИЕНТ. Фаза приходит из ответа сервера и
 * целиком выведена из записанных фактов. У телефона нет своего мнения о том,
 * где находится смена: закрыл приложение на осмотре, открыл через час —
 * вернулся на осмотр, а не в начало и не вперёд.
 */
export function OperatorMobileApp() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detour, setDetour] = useState<Detour | null>(null);
  /**
   * Выбранная установка. По умолчанию её выбирает сервер (первая бригада);
   * дальше выбор оператора едет с каждым чтением состояния, иначе экран
   * показывает объект и объёмы не той машины, которую он отметил.
   */
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [workTab, setWorkTab] = useState<WorkTab>('SHIFT');
  const coordinates = useRef<{latitude: number; longitude: number} | null>(null);

  /**
   * Ключ открытого чек-листа. К нему привязываются снимки, сделанные до
   * отправки, поэтому он обязан пережить перерисовки — но не пережить отправку:
   * новый ключ выдаётся после каждой удачной команды, иначе повторная сдача
   * списка вернула бы прежний результат вместо новой записи.
   *
   * Хранится в состоянии, а не в ref: ref во время отрисовки читать нельзя,
   * а ключ нужен именно при отрисовке — его получает экран чек-листа.
   */
  const [checklistCommandId, setChecklistCommandId] = useState(newCommandId);

  /**
   * Ключи форм выработки и происшествия. Живут по тем же правилам, что и ключ
   * чек-листа, и по той же причине — но эта причина стоит отдельного слова.
   *
   * Раньше ключ создавался прямо в обработчике нажатия. На морозе в перчатке
   * по кнопке попадают дважды, и два нажатия давали два разных ключа: сервер
   * видел две разные команды и записывал две пачки свай. Ключ, переживающий
   * нажатие, делает второе нажатие безвредным — сервер узнаёт повтор и
   * возвращает прежнюю запись. Новый ключ выдаётся только после удачи.
   */
  const [productionCommandId, setProductionCommandId] = useState(newCommandId);
  const [incidentCommandId, setIncidentCommandId] = useState(newCommandId);
  const [correctionCommandId, setCorrectionCommandId] = useState(newCommandId);

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
        window.location.href = '/login';
        return;
      }
      // Отказ по роли — не обрыв связи, и показывать его как «нет сети» значит
      // отправить помощника машиниста жать «Повторить» до вечера.
      if (error instanceof ApiError && error.status === 403) {
        setForbidden(error.message);
        return;
      }
      setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить смену');
    }
  }, [equipmentId]);

  useEffect(() => {
    void (async () => {
      coordinates.current = await currentPosition();
      await reload();
    })();
  }, [reload]);

  /**
   * Выполнить команду и сказать, получилось ли.
   *
   * ПОЧЕМУ ВОЗВРАЩАЕТ ПРИЗНАК. Экран очищает форму только по этому ответу.
   * Пока команда была «отправил и забыл», форма очищалась сразу: оборвалась
   * связь на последней свае — и введённое исчезло вместе с ошибкой, а
   * набирать заново пришлось по памяти. Ошибку человек прочитает; цифры,
   * которые он только что ввёл, восстановить неоткуда.
   */
  const run = useCallback(async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      await work();
      setChecklistCommandId(newCommandId());
      setProductionCommandId(newCommandId());
      setIncidentCommandId(newCommandId());
      setCorrectionCommandId(newCommandId());
      setDetour(null);
      await reload();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Команда не выполнена');
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  if (forbidden) {
    return (
      <Screen title="Рабочее место машиниста">
        <Panel>
          <PanelTitle>{forbidden}</PanelTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Смену ведёт машинист, закреплённый за установкой. Записи о выработке и осмотрах
            подаёт он.
          </p>
        </Panel>
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen title="Нет связи" footer={<BigButton onClick={() => void reload()}>Повторить</BigButton>}>
        <Panel tone="danger">
          <PanelTitle tone="danger">{loadError}</PanelTitle>
          <p className="mt-1 text-sm">
            Рабочее место работает только на связи. Дождитесь сети и повторите — записывать смену
            «в стол» приложение не станет, чтобы не потерять её молча.
          </p>
        </Panel>
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen title="Загрузка смены">
        <p className="text-sm text-muted-foreground">Считываем допуски, машину и погоду…</p>
      </Screen>
    );
  }

  const shift = state.shift;
  const assignment = state.assignment;

  const submitChecklist = (stage: ChecklistStage) => (answers: ChecklistAnswer[]) => {
    if (!shift || !assignment) return;
    void run(() => sendCommand({
      command: 'submit-checklist',
      clientCommandId: checklistCommandId,
      shiftId: shift.id,
      equipmentId: assignment.equipmentId,
      stage,
      answers,
    }));
  };

  const stage = detour?.kind === 'CHECKLIST' ? detour.stage : PHASE_STAGE[state.phase] ?? null;
  const checklist = stage
    ? state.checklists.find((candidate) => candidate.stage === stage)
    : undefined;

  // Вкладки появляются только тогда, когда работа началась, и исчезают на
  // обходных экранах: посреди чек-листа переключаться некуда, его надо
  // закончить.
  const tabsVisible = Boolean(shift)
    && (state.phase === 'WORK' || state.phase === 'CLOSING')
    && !detour
    && !checklist;

  const alarmingIncidents = state.incidents.filter(
    (incident) => isIncidentOpen(incident.reviewedAt),
  ).length;

  const tabBar = tabsVisible ? (
    <TabBar<WorkTab>
      active={workTab}
      onSelect={setWorkTab}
      tabs={[
        {id: 'SHIFT', label: state.phase === 'CLOSING' ? 'Сдача' : 'Работа'},
        {id: 'EQUIPMENT', label: 'Техника', badge: state.defects.length},
        {
          id: 'INCIDENTS',
          label: 'События',
          badge: alarmingIncidents,
          alarming: alarmingIncidents > 0,
        },
        {id: 'PROFILE', label: 'Профиль'},
      ]}
    />
  ) : undefined;

  const correctProduction = async (input: {
    entryId: string; kind: 'PILES' | 'DRILLING' | 'DOWNTIME'; actual: number; reason: string;
  }): Promise<boolean> => {
    if (!shift) return false;
    return run(() => sendCommand({
      command: 'correct-production',
      clientCommandId: correctionCommandId,
      shiftId: shift.id,
      ...input,
    }));
  };

  const reportIncident = async (input: {
    category: string; signs: string[]; injured: boolean; description: string; mediaIds: string[];
  }): Promise<boolean> => {
    if (!shift) return false;
    return run(() => sendCommand({
      command: 'report-incident',
      clientCommandId: incidentCommandId,
      shiftId: shift.id,
      ...input,
    }));
  };

  const screen = () => {
    // Вкладки, кроме основной, живут в собственной рамке: у них своя шапка и
    // нет нижней кнопки действия — действие у каждой своё и внутри.
    if (tabsVisible && workTab !== 'SHIFT') {
      const title = workTab === 'EQUIPMENT' ? 'Техника'
        : workTab === 'INCIDENTS' ? 'Происшествия' : 'Мои допуски';
      return (
        <Screen title={title} subtitle={state.assignment?.equipmentName} tabs={tabBar}>
          {workTab === 'EQUIPMENT' ? <EquipmentTab state={state} /> : null}
          {workTab === 'INCIDENTS' ? (
            <IncidentsTab
              state={state}
              busy={busy}
              error={actionError}
              commandId={incidentCommandId}
              onReport={reportIncident}
            />
          ) : null}
          {workTab === 'PROFILE' ? (
            <ProfileTab
              state={state}
              onOpenBriefing={() => setDetour({kind: 'BRIEFING'})}
              onOpenKnowledge={() => setDetour({kind: 'KNOWLEDGE'})}
            />
          ) : null}
        </Screen>
      );
    }

    if (detour?.kind === 'BRIEFING') {
      return (
        <BriefingScreen
          busy={busy}
          onAcknowledge={() => void run(() => sendCommand({command: 'acknowledge-briefing'}))}
          onBack={() => setDetour(null)}
        />
      );
    }

    if (detour?.kind === 'KNOWLEDGE') {
      return (
        <KnowledgeScreen
          busy={busy}
          error={actionError}
          onDone={(picks) => void run(() => sendCommand({command: 'submit-knowledge', picks}))}
          onBack={() => setDetour(null)}
        />
      );
    }

    if (checklist) {
      return (
        <ChecklistScreen
          checklist={checklist}
          warnings={state.warnings}
          onSubmit={submitChecklist(checklist.stage)}
          busy={busy}
          error={actionError}
          commandId={checklistCommandId}
          onBack={detour ? () => setDetour(null) : undefined}
        />
      );
    }

    switch (state.phase) {
      case 'IDENTITY':
        return (
          <IdentityScreen
            identity={state.identity}
            operatorName={state.operator.name}
            warnings={state.warnings}
            onBriefing={() => setDetour({kind: 'BRIEFING'})}
            onKnowledge={() => setDetour({kind: 'KNOWLEDGE'})}
            onContinue={() => void reload()}
          />
        );
      case 'ADMISSION':
        return (
          <AdmissionScreen
            state={state}
            busy={busy}
            error={actionError}
            onSelectEquipment={setEquipmentId}
            onAccept={(input) => void run(() => sendCommand({
              command: 'accept-equipment',
              clientCommandId: newCommandId(),
              ...input,
            }))}
          />
        );
      case 'WORK':
        if (!shift) return <Screen title="Смена"><p className="text-sm">Смена не найдена.</p></Screen>;
        return (
          <WorkScreen
            state={state}
            busy={busy}
            error={actionError}
            onLog={(entry: ProductionEntryInput) => run(() => sendCommand({
              command: 'log-production',
              clientCommandId: productionCommandId,
              shiftId: shift.id,
              entry,
            }))}
            onOpenSafety={(safetyStage) => setDetour({kind: 'CHECKLIST', stage: safetyStage})}
            onFinish={() => void run(() => sendCommand({command: 'finish-work', shiftId: shift.id}))}
            tabs={tabBar}
            onCorrect={correctProduction}
          />
        );
      case 'CLOSING':
        if (!shift) return <Screen title="Смена"><p className="text-sm">Смена не найдена.</p></Screen>;
        return (
          <ClosingScreen
            state={state}
            busy={busy}
            error={actionError}
            onOpenService={() => setDetour({kind: 'CHECKLIST', stage: 'EO_AFTER'})}
            onClose={(comment) => void run(() => sendCommand({
              command: 'close-shift',
              shiftId: shift.id,
              comment,
            }))}
            tabs={tabBar}
          />
        );
      case 'CLOSED':
        return <ClosedScreen state={state} />;
      default:
        return <Screen title="Смена"><p className="text-sm">Экран готовится…</p></Screen>;
    }
  };

  return (
    <div className="mx-auto min-h-dvh max-w-[560px] bg-background">
      <PhaseBar progress={state.progress} />
      {screen()}
    </div>
  );
}
