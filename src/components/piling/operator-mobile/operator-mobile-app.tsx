'use client';

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {HardHat, ShieldCheck, TriangleAlert, UserRound, Wrench} from 'lucide-react';
import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState, OperatorPhase,
} from '@/modules/operator-mobile/contracts';
import {
  ApiError, currentPosition, fetchState, newCommandId, QueuedOffline, sendCommand,
  sendQueuedCommand, type ProductionEntryInput,
} from './api';
import {flushQueue, readQueue, retry, subscribeQueue, type QueuedCommand} from './offline-queue';
import {OperatorStatusStrip} from './operator-status-strip';
import {BigButton, Panel, PanelTitle, PhaseBar, Screen, TabBar} from './ui';
import {IdentityScreen} from './screens/identity-screen';
import {BriefingScreen} from './screens/briefing-screen';
import {KnowledgeScreen} from './screens/knowledge-screen';
import {PpeScreen} from './screens/ppe-screen';
import {AdmissionScreen} from './screens/admission-screen';
import {ChecklistScreen} from './screens/checklist-screen';
import {WorkScreen} from './screens/work-screen';
import {isIncidentOpen} from '@/modules/operator-mobile/contracts';
import {ClosedScreen, ClosingScreen} from './screens/closing-screen';
import {ReviewScreen} from './screens/review-screen';
import {EquipmentTab} from './screens/equipment-tab';
import {IncidentsTab} from './screens/incidents-tab';
import {ProfileTab} from './screens/profile-tab';
import {SafetyTab} from './screens/safety-tab';
import {admissionBlockers, admissionSteps} from './safety/admission-steps';

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
type WorkTab = 'SHIFT' | 'EQUIPMENT' | 'SAFETY' | 'INCIDENTS' | 'PROFILE';

/** Экраны, открываемые вне очереди фаз. */
type Detour =
  | {kind: 'PPE'}
  | {kind: 'BRIEFING'}
  | {kind: 'KNOWLEDGE'}
  | {kind: 'CHECKLIST'; stage: ChecklistStage}
  /** Просмотр пройденного этапа: только чтение, ничего не меняет. */
  | {kind: 'REVIEW'; phase: OperatorPhase};

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
  // Что лежит на устройстве и ещё не ушло. Держим в состоянии, чтобы машинист
  // видел это постоянно, а не узнавал по факту пропажи.
  const [queued, setQueued] = useState<QueuedCommand[]>([]);
  const [online, setOnline] = useState(true);
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
      // Запись легла в очередь на устройстве — это принято, а не отказ. Форму
      // закрываем и выдаём новые ключи команд, как при обычном успехе: иначе
      // машинист вводил бы то же самое второй раз. Перечитывать состояние с
      // сервера нечего — он этой записи ещё не видел.
      if (error instanceof QueuedOffline) {
        setChecklistCommandId(newCommandId());
        setProductionCommandId(newCommandId());
        setIncidentCommandId(newCommandId());
        setCorrectionCommandId(newCommandId());
        setDetour(null);
        setActionError(null);
        return true;
      }
      setActionError(error instanceof Error ? error.message : 'Команда не выполнена');
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  /**
   * Очередь: показываем её и опустошаем при возврате связи.
   *
   * Ждать следующего действия машиниста нельзя — он может отложить телефон с
   * непереданной сваей. Поэтому пробуем при событии `online` и один раз при
   * запуске: смену часто открывают уже в сети, после ночи без неё.
   */
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
        // Перечитываем состояние только если что-то действительно ушло:
        // сервер увидел новые записи, и экран должен их показать.
        if (sent > 0) await reload();
      } finally {
        running = false;
      }
    };

    void flush();
    globalThis.addEventListener?.('online', flush);
    return () => {
      unsubscribe();
      globalThis.removeEventListener?.('online', flush);
    };
  }, [reload]);

  if (forbidden) {
    return (
      <OperatorFrame>
        <Screen title="Рабочее место машиниста">
          <Panel>
            <PanelTitle>{forbidden}</PanelTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Смену ведёт машинист, закреплённый за установкой. Записи о выработке и осмотрах
              подаёт он.
            </p>
          </Panel>
        </Screen>
      </OperatorFrame>
    );
  }

  if (loadError) {
    return (
      <OperatorFrame>
        <OperatorStatusStrip online={online} items={queued} />
        <Screen title="Нет связи" footer={<BigButton onClick={() => void reload()}>Повторить</BigButton>}>
          <Panel tone="danger">
            <PanelTitle tone="danger">{loadError}</PanelTitle>
            <p className="mt-1 text-sm">
              Без загруженного состояния нельзя безопасно открыть или закрыть смену. Восстановите
              связь и повторите. Уже сохранённые на устройстве выработка и события не пропадут.
            </p>
          </Panel>
        </Screen>
      </OperatorFrame>
    );
  }

  if (!state) {
    return (
      <OperatorFrame>
        <Screen title="Загрузка смены">
          <p className="text-sm text-muted-foreground">Считываем допуски, машину и погоду…</p>
        </Screen>
      </OperatorFrame>
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
  // Закрытая смена вкладки тоже показывает: раньше экран «Смена закрыта» был
  // тупиком — ни вкладок, ни возврата, только текст квитанции (жалоба
  // 16.09.2026). Работа там уже не ведётся, но посмотреть технику, события и
  // свои допуски человек вправе.
  /*
    Панель скрыта РОВНО ТАМ, ГДЕ ЕЁ НЕЛЬЗЯ ПОКАЗЫВАТЬ: пока человек проходит
    чек-лист или обходной экран. Причина прежняя — отказы дешевле находить на
    земле, чем на четвёртой свае, и «сходить в другую вкладку» посреди осмотра
    значит дать возможность его не закончить.

    Раньше условие было шире: панель появлялась только с началом работы. Под
    запрет попадали и фаза допуска, и приём — там бросать нечего, а вкладка
    «ТБ» нужна как раз до смены, а не после. Теперь запрет привязан к тому, что
    его и оправдывает: `checklist` закрывает осмотр, пуск и площадку,
    `detour` — любой открытый шаг.
  */
  const tabsVisible = !detour && !checklist;

  const alarmingIncidents = state.incidents.filter(
    (incident) => isIncidentOpen(incident.reviewedAt),
  ).length;

  const tabBar = tabsVisible ? (
    <TabBar<WorkTab>
      active={workTab}
      onSelect={setWorkTab}
      tabs={[
        {
          id: 'SHIFT',
          label: state.phase === 'IDENTITY' ? 'Допуск'
            : state.phase === 'CLOSED' ? 'Смена'
              : state.phase === 'CLOSING' ? 'Сдача' : 'Работа',
          icon: <HardHat />,
        },
        {id: 'EQUIPMENT', label: 'Техника', icon: <Wrench />, badge: state.defects.length},
        {
          id: 'SAFETY',
          label: 'ТБ',
          icon: <ShieldCheck />,
          // На значке — число непройденных шагов допуска. Ноль значка не рисует.
          badge: admissionBlockers(admissionSteps(state)).length,
        },
        {
          id: 'INCIDENTS',
          label: 'События',
          icon: <TriangleAlert />,
          badge: alarmingIncidents,
          alarming: alarmingIncidents > 0,
        },
        {id: 'PROFILE', label: 'Профиль', icon: <UserRound />},
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
        : workTab === 'SAFETY' ? 'Техника безопасности'
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
          {workTab === 'SAFETY' ? (
            <SafetyTab
              state={state}
              onOpen={(step) => setDetour(
                step === 'PPE' ? {kind: 'PPE'}
                  : step === 'BRIEFING' ? {kind: 'BRIEFING'} : {kind: 'KNOWLEDGE'},
              )}
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

    if (detour?.kind === 'REVIEW') {
      return <ReviewScreen state={state} phase={detour.phase} onBack={() => setDetour(null)} />;
    }

    if (detour?.kind === 'PPE') {
      return (
        <PpeScreen
          busy={busy}
          error={actionError}
          onConfirm={(items) => void run(() => sendCommand({
            command: 'confirm-ppe',
            // Сутки считает сервер и отдаёт в состоянии: у машиниста в ночной
            // смене полночь наступает посреди работы, и расчёт по часам
            // телефона записал бы проверку за другие сутки.
            productionDate: state.productionDate,
            items,
          }))}
          onBack={() => setDetour(null)}
        />
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
          onDone={(picks, attemptToken) => void run(() => sendCommand({command: 'submit-knowledge', picks, attemptToken}))}
          onBack={() => setDetour(null)}
        />
      );
    }

    if (checklist) {
      return (
        <ChecklistScreen
          key={checklist.stage}
          checklist={checklist}
          warnings={state.warnings}
          onSubmit={submitChecklist(checklist.stage)}
          busy={busy}
          error={actionError}
          commandId={checklistCommandId}
          lastMeter={state.assignment?.lastMeter ?? null}
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
            tabs={tabBar}
            onPpe={() => setDetour({kind: 'PPE'})}
            onBriefing={() => setDetour({kind: 'BRIEFING'})}
            onKnowledge={() => setDetour({kind: 'KNOWLEDGE'})}
            onContinue={() => void reload()}
          />
        );
      case 'ADMISSION':
        return (
          <AdmissionScreen
            state={state}
            tabs={tabBar}
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
        return <ClosedScreen state={state} tabs={tabBar} />;
      default:
        return <Screen title="Смена"><p className="text-sm">Экран готовится…</p></Screen>;
    }
  };

  return (
    <OperatorFrame>
      <PhaseBar
        progress={state.progress}
        onOpen={(phase) => setDetour({kind: 'REVIEW', phase: phase as OperatorPhase})}
      />
      <OperatorStatusStrip online={online} items={queued} />
      <QueueBanner items={queued} />
      {screen()}
    </OperatorFrame>
  );
}

/**
 * Рамка рабочего места на всю ОСТАВШУЮСЯ высоту, а не на всю высоту окна.
 *
 * ПОЧЕМУ НЕ `min-h-dvh`. Над рабочим местом стоит липкая шапка приложения, и
 * она занимает место в потоке. `100dvh` под ней давало страницу ровно на высоту
 * шапки длиннее окна — на каждом экране машиниста висела прокрутка на 76 px,
 * даже когда содержимое помещалось целиком (жалоба 16.09.2026).
 *
 * Высоту шапки замеряем, а не записываем числом: на широком экране её нет
 * вовсе (там боковое меню), а на телефоне к ней добавляется безопасная зона
 * выреза — константа врала бы в обе стороны.
 */
function OperatorFrame({children}: {children: ReactNode}) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => {
      const node = frame.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top + window.scrollY;
      setOffset(Math.max(0, Math.round(top)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div
      ref={frame}
      // До замера — прежняя высота: лучше лишняя прокрутка на один кадр, чем
      // экран, схлопнувшийся по содержимому.
      style={{minHeight: offset === null ? undefined : `calc(100dvh - ${offset}px)`}}
      className={[
        'operator-mobile-theme mx-auto flex max-w-[560px] flex-col overflow-x-hidden',
        offset === null ? 'min-h-dvh' : '',
        'bg-[#f2f4f6] text-[#16212b] md:border-x md:border-[#d4dbe1] md:shadow-2xl',
        '[&_.operator-screen]:min-h-0 [&_.operator-screen]:flex-1 [&_.operator-screen]:bg-transparent',
        '[&_.operator-screen-header]:border-b-0 [&_.operator-screen-header]:pb-2',
        '[&_.operator-panel]:border-[#d7dde3] [&_.operator-panel]:shadow-[0_3px_14px_rgba(15,23,42,0.06)]',
        '[&_.operator-fact]:border-[#e1e6ea]',
        '[&_.operator-screen-footer]:border-[#ced6dd] [&_.operator-screen-footer]:bg-white/95',
        '[&_.operator-tab-bar]:border-[#dce2e7] [&_.operator-tab-bar]:bg-white',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

/**
 * Что записано на устройстве и ещё не ушло на сервер.
 *
 * Без этой строки автономная работа неотличима от потери данных: машинист
 * ввёл сваи, экран промолчал, а в отчёте их нет. Показываем и сколько ждёт
 * связи, и что сервер отверг по существу — второе само не рассосётся.
 */
function QueueBanner({items}: {items: QueuedCommand[]}) {
  if (items.length === 0) return null;
  const failed = items.filter((item) => item.state === 'FAILED');
  const pending = items.filter((item) => item.state === 'PENDING');

  return (
    <div className="space-y-1 px-3 pt-2">
      {pending.length > 0 && (
        <div className="rounded-xl border border-warning bg-warning/10 px-3 py-2 text-2xs font-medium text-warning-strong">
          На устройстве: {pending.map((item) => item.label).join(', ')}. Отправим, когда появится связь.
        </div>
      )}
      {failed.map((item) => (
        <div
          key={item.clientCommandId}
          className="flex items-start justify-between gap-2 rounded-xl border border-destructive bg-destructive/10 px-3 py-2 text-2xs font-medium text-destructive-strong"
        >
          <span className="min-w-0">
            {item.label} не принята: {item.lastError ?? 'причина неизвестна'}
          </span>
          <button
            type="button"
            onClick={() => retry(item.clientCommandId)}
            className="shrink-0 rounded border border-destructive px-2 py-0.5 font-semibold"
          >
            Повторить
          </button>
        </div>
      ))}
    </div>
  );
}

