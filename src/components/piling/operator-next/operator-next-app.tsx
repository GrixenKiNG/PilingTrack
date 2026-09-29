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
import {usePilingStore} from '@/lib/store';
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
  draftScopeKey, draftsForScope, emptyDrafts, emptyFormFields, emptyPassportDraft, emptyWorkDraft,
  passportAfterSubmit,
  type ChecklistDrafts, type Drafts, type FormMode, type PassportDraftData, type WorkDraft,
} from './drafts';
import {loadShellDrafts, saveShellDrafts, storageAvailable, type ShellDraftsData} from './draft-storage';
import {ErrorStrip, NoticeStrip, ActionButton, NextActionCard, ReasonNote} from './parts';
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

/** Пустая карта ответов: общая ссылка, чтобы не менять её на каждом рендере. */
const EMPTY_CHECKLIST_DRAFTS: ChecklistDrafts = {};

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
  const [drafts, setDrafts] = useState<Drafts>(() => emptyDrafts(null, null));
  /**
   * Отложенный осмотр: этап и смена. Смена хранится рядом с этапом, чтобы
   * «отложено» прошлой смены не прилипало к такой же фазе новой.
   */
  const [checklistExit, setChecklistExit] = useState<{stage: ChecklistStage; shiftId: string | null} | null>(null);
  /** Кто вошёл: черновики хранятся и читаются только по своему пользователю. */
  const userId = usePilingStore((store) => store.currentUser?.id ?? null);
  /** Последний известный результат проверки хранилища черновиков. */
  const [storageOk, setStorageOk] = useState(true);
  const coordinates = useRef<{latitude: number; longitude: number} | null>(null);

  /** Номер последнего запроса: применяем только его ответ (находка №4 ревью). */
  const requestSeq = useRef(0);
  /** Замок повторного входа: два нажатия в одном такте — одна команда. */
  const [flight] = useState<SingleFlight>(() => createSingleFlight());
  /** Ключи команд по видам: обновляется только тот, что прошёл. */
  const [keys] = useState<CommandKeys>(() => createCommandKeys());

  const shiftId = state?.shift?.id ?? null;

  /**
   * Живая ссылка на текущую смену — только для черновиков.
   *
   * ПОЧЕМУ. Загрузка снимка может завершиться уже после перехода к другой
   * смене: обработчик остался от прежнего рендера. Такой поздний вызов смеет
   * менять черновики только если смена не сменилась — иначе он затрёт черновики
   * новой смены пустыми старыми (дефект круга 4, ревью №3).
   */
  const shiftIdRef = useRef<string | null>(shiftId);
  useEffect(() => {
    shiftIdRef.current = shiftId;
  }, [shiftId]);

  /**
   * Живая ссылка на вошедшего — вторая половина принадлежности черновика.
   *
   * ПОЧЕМУ ПАРА. Планшет общий: при смене пользователя в уже открытой оболочке
   * черновики прежнего не должны ни показываться, ни сохраняться под новым.
   * Пара «пользователь + смена» — единственная верная проверка принадлежности.
   */
  const userIdRef = useRef<string | null>(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  /** Идёт отправка `close-shift`: заметка закрывается только на это время. */
  const [closeSending, setCloseSending] = useState(false);

  /**
   * Признак «документ пары успешно загружен» (ревью №5, Д1).
   *
   * ПОЧЕМУ ОТДЕЛЬНО ОТ `storageOk`. Пока документ не прочитан, автосохранение
   * запрещено: иначе восстановившаяся запись затрёт непрочитанный черновик
   * пустой памятью. Выставляется только успешным чтением, содержимое которого
   * легло в память.
   */
  const draftsLoadedRef = useRef<string | null>(null);

  /** Живая копия памяти черновиков — для обработчиков, читающих её вне рендера. */
  const draftsRef = useRef<Drafts>(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  /**
   * Правка черновиков пары «пользователь + смена» с проверкой поколения.
   *
   * Поздний вызов приходит с зашитой парой А: если живая пара уже другая —
   * вызов игнорируется, и черновики Б не подменяются пустыми черновиками А.
   */
  const mutateDraftsForScope = useCallback((
    expectedUserId: string | null,
    expectedShiftId: string | null,
    change: (base: Drafts) => Drafts,
  ) => {
    setDrafts((current) => {
      if (userIdRef.current !== expectedUserId || shiftIdRef.current !== expectedShiftId) return current;
      return change(draftsForScope(current, expectedUserId, expectedShiftId));
    });
  }, []);

  /**
   * Правка черновика работы.
   *
   * Живёт здесь, у оболочки: формы размонтируются в любой момент — вкладка,
   * возврат к смене, обязательный осмотр. Объявлено до `run`, потому что `run`
   * закрывает форму выработки по концу защищённого цикла (ревью №2).
   */
  const updateWorkDraft = useCallback((updater: (current: WorkDraft) => WorkDraft) => {
    mutateDraftsForScope(userId, shiftId, (base) => ({...base, work: updater(base.work)}));
  }, [mutateDraftsForScope, userId, shiftId]);

  /** Правка черновика паспорта: значения идут в форму пропом, изменения — сюда. */
  const updatePassportDraft = useCallback((next: PassportDraftData) => {
    mutateDraftsForScope(userId, shiftId, (base) => ({...base, passport: next}));
  }, [mutateDraftsForScope, userId, shiftId]);

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
      // Смена перечитана: поздние ответы прежней смены больше не должны
      // подменять черновики; заодно читаем черновик этой смены из хранилища
      // (перезагрузили страницу — черновик вернётся).
      const nextShiftId = next.shift?.id ?? null;
      shiftIdRef.current = nextShiftId;
      // Читаем черновик пары только при известном пользователе: общего «anon»
      // больше нет, а ошибка чтения — это не «пусто» (ревью №4, A2 и Д3).
      let canStore = storageAvailable() && userId != null && nextShiftId != null;
      let stored: ShellDraftsData | null = null;
      let readOk = false;
      if (canStore) {
        const read = loadShellDrafts(userId, nextShiftId);
        if (read.status === 'error') {
          canStore = false;
        } else {
          stored = read.value;
          readOk = true;
        }
      }
      // Признак «документ пары загружен» выставляется только успешным чтением,
      // содержимое которого ложится в память; пока его нет, автосохранение
      // молчит, чтобы пустая память не затёрла непрочитанный черновик (№5, Д1).
      const scopeKey = draftScopeKey(userId, nextShiftId);
      const wasLoaded = draftsLoadedRef.current === scopeKey;
      draftsLoadedRef.current = readOk ? scopeKey : null;
      // Доступность хранилища ≠ сохранность текущей памяти (ревью №5, Д2):
      // успешное перечитывание НЕ снимает предупреждение — снять его может
      // только новая успешная запись.
      if (!canStore) setStorageOk(false);
      setDrafts((current) => {
        if (current.userId === userId && current.shiftId === nextShiftId && wasLoaded) return current;
        return stored
          ? {
            userId,
            shiftId: nextShiftId,
            work: stored.work,
            closeNote: stored.closeNote,
            checklists: stored.checklists,
            passport: stored.passport ?? emptyPassportDraft(),
          }
          : emptyDrafts(userId, nextShiftId);
      });
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
  }, [equipmentId, userId]);

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
   * Вход в закрытие показывает вкладку «Смена» ОДИН раз.
   *
   * ПОЧЕМУ. Если человек после «Завершить работу» остался на «Технике», экран
   * отчёта и кнопка закрытия оказывались за другой вкладкой (находка Д8). Но
   * перекрывать выбор вкладки всю фазу закрытия нельзя — «Техника», ТБ и «Ещё»
   * переставали открываться вовсе (находка ревью №2). Переключаем один раз, при
   * входе в закрытие; дальше человек сам решает, куда смотреть.
   */
  const closingPhase = state?.phase === 'CLOSING' || state?.phase === 'CLOSED';
  const wasClosing = useRef(false);
  useEffect(() => {
    if (closingPhase && !wasClosing.current) setWorkTab('SHIFT');
    wasClosing.current = closingPhase;
  }, [closingPhase]);

  /**
   * Выполнить команду и сказать, получилось ли.
   *
   * ОДНА ОТПРАВКА — ОДИН ЗАЩИЩЁННЫЙ ЦИКЛ (ревью №2). Синхронный замок берётся
   * до первого `await`, поля закрыты от первого нажатия до конца цикла, а
   * подтверждённый черновик очищается СРАЗУ по подтверждению — не дожидаясь
   * перечитывания. Перечитывание — отдельный шаг после: его сбой ничего не
   * отменяет и форму не возвращает. Пока цикл не закончился, `busy` держит
   * поля закрытыми, поэтому повторное нажатие не отправит ту же запись с новым
   * ключом, а поздняя очистка не сотрёт новый ввод.
   *
   * ВОЗВРАТ — В МОМЕНТ ПОДТВЕРЖДЕНИЯ. «Успех» = сервер принял ИЛИ запись легла
   * в очередь; экран получает `true` сразу, чтобы очистить свою форму, не
   * дожидаясь чтения. Полное завершение цикла видно по `busy`.
   */
  const run = useCallback((
    kind: CommandKind | null,
    work: () => Promise<unknown>,
    afterConfirm?: () => void,
  ): Promise<boolean> => {
    let settle!: (ok: boolean) => void;
    const confirmed = new Promise<boolean>((resolve) => { settle = resolve; });
    void flight.run(async () => {
      setBusy(true);
      setActionError(null);
      setNotice(null);
      try {
        await work();
        if (kind) keys.renew(kind);
        afterConfirm?.();
        settle(true);
        await reload();
        return {ok: true, queued: false};
      } catch (error) {
        if (error instanceof QueuedOffline) {
          if (kind) keys.renew(kind);
          afterConfirm?.();
          settle(true);
          return {ok: true, queued: true};
        }
        setActionError(humanError(error));
        // 409 — сервер уже в другом состоянии: перечитываем, чтобы экран не спорил.
        if (error instanceof ApiError && error.status === 409) void reload();
        settle(false);
        return {ok: false, queued: false};
      } finally {
        setBusy(false);
      }
    }).then((outcome) => {
      // Повторное нажатие в том же такте: вторая команда не начиналась.
      if (!outcome.started) settle(false);
      const value = outcome.value;
      if (!value || !value.ok) return;
      // Форму выработки закрываем по КОНЦУ цикла: поля уже очищены по
      // подтверждению, а закрытие теперь ничего не стирает (ревью №2).
      if (kind === 'production') {
        updateWorkDraft((current) => (current.mode === 'NONE' ? current : {...current, mode: 'NONE'}));
      }
      setDetour(null);
      setNotice(value.queued
        ? 'Записано на устройстве: отправим, когда появится связь.'
        : 'Записано: сервер принял запись.');
    });
    return confirmed;
  }, [reload, flight, keys, updateWorkDraft]);

  // Что записано на устройстве и ещё не ушло. Плашка — одна на все экраны.
  const {queued, flush, retry: retryQueued, discard: discardQueued} = useOfflineQueue(reload);

  /**
   * Зеркалим черновики пары в localStorage на каждое изменение — перезагрузка
   * страницы не спрашивает разрешения. Статус — по результату РЕАЛЬНОЙ записи,
   * а не только пробы: маленькая проба проходит, а большой черновик может не
   * уложиться в квоту (ревью №4, Д2). Недоступное хранилище — не ошибка: экран
   * честно говорит, что черновик его не переживёт.
   */
  useEffect(() => {
    // Пишем только текущую пару: черновик прежнего пользователя не сохраняется
    // под новым, пока идёт смена контекста (ревью №4, A2).
    if (!userId || !shiftId || drafts.userId !== userId || drafts.shiftId !== shiftId) return;
    // Документ ещё не загружен (отказ чтения) — автосохранение молчит: иначе
    // пустая память затрёт непрочитанный черновик (ревью №5, Д1).
    if (draftsLoadedRef.current !== draftScopeKey(userId, shiftId)) return;
    const ok = saveShellDrafts(userId, shiftId, {
      work: drafts.work,
      checklists: drafts.checklists,
      closeNote: drafts.closeNote,
      passport: drafts.passport ?? null,
    });
    // Статус обновляем асинхронно: синхронный setState в эффекте — каскадные
    // рендеры (правила проекта). Снятие предупреждения — только по успешной
    // записи актуальной памяти (ревью №5, Д2).
    queueMicrotask(() => {
      setStorageOk((previous) => (previous === ok ? previous : ok));
    });
  }, [drafts, shiftId, userId]);

  const draftsAreCurrent = drafts.userId === userId && drafts.shiftId === shiftId;
  const workDraft: WorkDraft = draftsAreCurrent ? drafts.work : emptyWorkDraft();
  const closeNote = draftsAreCurrent ? drafts.closeNote : '';

  const updateCloseNote = useCallback((value: string) => {
    mutateDraftsForScope(userId, shiftId, (base) => ({...base, closeNote: value}));
  }, [mutateDraftsForScope, userId, shiftId]);

  /** Заметка отправленной смены — не черновик: чистим по подтверждённому закрытию (ревью №2). */
  const clearCloseNote = useCallback(() => {
    mutateDraftsForScope(userId, shiftId, (base) => ({...base, closeNote: ''}));
  }, [mutateDraftsForScope, userId, shiftId]);

  /** Живая заметка: в момент отправки `close-shift` берём текущее значение (ревью №3, п.4). */
  const closeNoteRef = useRef(closeNote);
  useEffect(() => {
    closeNoteRef.current = closeNote;
  }, [closeNote]);

  /**
   * Поля отправленной выработки — не черновик: чистим сразу по подтверждению.
   * Форму закрывает сам экран работы, когда цикл отпустит поля (ревью №2);
   * отправленный паспорт уходит из памяти оболочки тем же порядком, а «константы
   * проекта» в нём остаются (ревью №4, A1).
   */
  const clearSubmittedEntry = (entry: ProductionEntryInput) => {
    if (entry.kind === 'PILE_PASSPORT') {
      const base = draftsForScope(draftsRef.current, userId, shiftId);
      const cleared: Drafts = {...base, passport: passportAfterSubmit(base.passport ?? emptyPassportDraft())};
      mutateDraftsForScope(userId, shiftId, () => cleared);
      // Очистка подтверждённого черновика должна лечь в хранилище сразу; отказ
      // записи — видимая ошибка, а не молчание (ревью №4, A3; №5, Д2).
      if (userId && shiftId && draftsLoadedRef.current === draftScopeKey(userId, shiftId)) {
        const ok = saveShellDrafts(userId, shiftId, {
          work: cleared.work,
          checklists: cleared.checklists,
          closeNote: cleared.closeNote,
          passport: cleared.passport ?? null,
        });
        if (!ok) setStorageOk(false);
      }
      return;
    }
    const form: FormMode = entry.kind;
    mutateDraftsForScope(userId, shiftId, (base) => ({
      ...base,
      work: {...base.work, forms: {...base.work.forms, [form]: emptyFormFields()}},
    }));
  };

  const checklistDraftsFor = (stage: ChecklistStage): ChecklistDrafts => (
    draftsAreCurrent ? drafts.checklists[stage] ?? EMPTY_CHECKLIST_DRAFTS : EMPTY_CHECKLIST_DRAFTS
  );

  /**
   * Правка ответов осмотра.
   *
   * Ответы живут здесь, а не в экране: `key={checklist.stage}` пересоздаёт экран
   * при каждом возврате, и ответы терялись при «Назад» (находка Д2 аудита).
   * Ключ — этап: ответы сданного осмотра чистятся по подтверждённой отправке.
   */
  const updateChecklistDrafts = (stage: ChecklistStage, updater: (current: ChecklistDrafts) => ChecklistDrafts) => {
    mutateDraftsForScope(userId, shiftId, (base) => ({
      ...base,
      checklists: {...base.checklists, [stage]: updater(base.checklists[stage] ?? {})},
    }));
  };

  /** Ответы отправленного этапа больше не черновик: чистим по приёму сервером. */
  const forgetChecklistDrafts = (stage: ChecklistStage) => {
    mutateDraftsForScope(userId, shiftId, (base) => {
      const next = {...base.checklists};
      delete next[stage];
      return {...base, checklists: next};
    });
  };

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
  // Фазовый осмотр можно ОТЛОЖИТЬ: ответы сохраняются, человек возвращается к
  // смене, вкладки доступны, а «Следующее действие» ведёт обратно к осмотру —
  // допуск к работе без завершённого осмотра не выдаётся (находка Д1).
  const checklistExited = Boolean(
    checklist && !detour && checklistExit?.stage === checklist.stage && checklistExit.shiftId === shiftId,
  );
  // Вкладки доступны уже после приёмки, но прячутся на время осмотра и обходных
  // экранов: посреди осмотра переключаться некуда. Отложенный осмотр не запирает.
  const tabsVisible = !detour && !(checklist && !checklistExited) && state.phase !== 'IDENTITY' && state.phase !== 'ADMISSION';
  // Вкладка открыта поверх смены; смена при этом НЕ размонтируется: черновик
  // паспорта сваи живёт внутри своей формы и иначе терялся бы (ревью №2).
  const tabActive = tabsVisible && workTab !== 'SHIFT';
  const shiftTabs = tabActive ? undefined : tabsVisible ? tabBar : undefined;

  const submitChecklist = (checklistStage: ChecklistStage) => (answers: ChecklistAnswer[]) => {
    const assignment = state.assignment;
    if (!shift || !assignment) return;
    // Ответы сданного осмотра — не черновик: оболочка чистит их сразу по
    // подтверждению, не дожидаясь перечитывания (ревью №2).
    void run('checklist', () => sendCommand({
      command: 'submit-checklist',
      clientCommandId: keys.get('checklist'),
      shiftId: shift.id,
      equipmentId: assignment.equipmentId,
      stage: checklistStage,
      answers,
    }), () => forgetChecklistDrafts(checklistStage));
  };

  const closeShift = async () => {
    console.log('[close] start');
    if (!shift) return;
    // Замок и блокировка полей — ДО первого `await flush()`: пока идёт
    // подготовка, заметка не может измениться, а повторное нажатие не запускает
    // вторую подготовку (ревью №2).
    await flight.run(async () => {
      setBusy(true);
      console.log('[close] task-start');
      setActionError(null);
      setNotice(null);
      // Принадлежность операции — на старте закрытия: за время подготовки
      // контекст мог смениться, и закрывать чужую смену нельзя (ревью №5, Д3).
      const closeUserId = userIdRef.current;
      const closeShiftId = shift.id; // значение пары на старте; живое — под сверку
      try {
        // Попытка отправить всё, что лежит, и свежий пересчёт очереди
        // НЕПОСРЕДСТВЕННО перед закрытием: между показом экрана и нажатием
        // связь могла появиться, а записи — уйти.
        await flush();
        console.log('[close] flushed');
        const fresh = ownPendingCount();
        console.log('[close] fresh=' + fresh);
        if (fresh !== 0) {
          setActionError(fresh < 0
            ? 'Не удалось проверить очередь на устройстве. Обновите экран и повторите.'
            : `На устройстве ${fresh} неотправленных записей. Сначала отправьте их — иначе выработка не попадёт в отчёт.`);
          return;
        }
        // Пока шла подготовка, мог войти другой пользователь (общий планшет):
        // чужую смену с чужой заметкой не закрываем — прекращаем без ошибки.
        if (userIdRef.current !== closeUserId || shiftIdRef.current !== closeShiftId) {
          return;
        }
        // Заметку читаем В МОМЕНТ отправки, а не снимком до подготовки
        // (ревью №3, п.4): источник истины — текущее состояние черновика.
        setCloseSending(true);
        console.log('[close] sending');
        await sendCommand({command: 'close-shift', shiftId: closeShiftId, comment: closeNoteRef.current});
        // Подтверждено: заметка этой смены больше не черновик.
        clearCloseNote();
        await reload();
        setNotice('Записано: сервер принял запись.');
      } catch (error) {
        setActionError(humanError(error));
        if (error instanceof ApiError && error.status === 409) void reload();
      } finally {
        setCloseSending(false);
        setBusy(false);
      }
    });
  };

  const screen = (): ReactNode => {
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
      if (checklistExited) {
        const known = knownAnswers(checklist.stage, state);
        const stageDrafts = checklistDraftsFor(checklist.stage);
        const remaining = checklist.sections
          .flatMap((section) => section.items)
          .filter((item) => !(known[item.id] || stageDrafts[item.id]?.answer)).length;
        return (
          <Screen title="Смена" subtitle={state.assignment?.equipmentName} tabs={shiftTabs}>
            <NextActionCard
              title="Осмотр не сдан"
              hint={online
                ? remaining > 0
                  ? `Осталось отметить: ${remaining}. Отмеченное сохранено — продолжите осмотр, когда сможете.`
                  : 'Все пункты отмечены — вернитесь к осмотру и отправьте его.'
                : storageOk
                  ? 'Осмотр сохранён на устройстве, отправить можно, когда появится связь.'
                  : 'Осмотр сохранён до перезагрузки: при перезагрузке страницы ответы не сохранятся.'}
              actionLabel="Продолжить осмотр"
              onAction={() => setChecklistExit(null)}
              testId="resume-checklist"
            />
            <Panel tone="warning">
              <PanelTitle tone="warning">Допуск к работе не выдан</PanelTitle>
              <p className="mt-1 text-sm">
                Пока осмотр не завершён, работа не начнётся. Отмеченное сохранено — оно не пропало.
              </p>
            </Panel>
            {!storageOk ? (
              <ReasonNote>
                Черновик не сохранится при перезагрузке страницы: память браузера недоступна.
              </ReasonNote>
            ) : null}
          </Screen>
        );
      }
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
          drafts={checklistDraftsFor(checklist.stage)}
          onDraftsChange={(updater) => updateChecklistDrafts(checklist.stage, updater)}
          onSubmit={submitChecklist(checklist.stage)}
          onBack={detour ? () => setDetour(null) : undefined}
          onExit={detour ? undefined : () => setChecklistExit({stage: checklist.stage, shiftId})}
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
            <Screen title="Смена" subtitle={state.assignment?.equipmentName} tabs={shiftTabs}>
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
            tabs={shiftTabs}
            storageOk={storageOk}
            draft={workDraft}
            onDraftChange={updateWorkDraft}
            passport={draftsAreCurrent ? drafts.passport ?? emptyPassportDraft() : emptyPassportDraft()}
            onPassportChange={updatePassportDraft}
            onOpenTab={setWorkTab}
            onOpenSafety={(safetyStage) => setDetour({kind: 'CHECKLIST', stage: safetyStage})}
            onFinish={() => void run(null, () => sendCommand({command: 'finish-work', shiftId: shift.id}))}
            onSubmitEntry={(entry: ProductionEntryInput) => run('production', () => sendCommand({
              command: 'log-production',
              clientCommandId: keys.get('production'),
              shiftId: shift.id,
              entry,
            }), () => clearSubmittedEntry(entry))}
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
            <Screen title="Смена" subtitle={state.assignment?.equipmentName} tabs={shiftTabs}>
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
            tabs={shiftTabs}
            unsentCount={queued.length}
            closeNote={closeNote}
            onCloseNoteChange={updateCloseNote}
            noteLocked={closeSending}
            storageOk={storageOk}
            onOpenService={() => setDetour({kind: 'CHECKLIST', stage: 'EO_AFTER'})}
            onFlushQueued={() => void flush()}
            onReload={() => void reload()}
            onClose={() => void closeShift()}
          />
        );
      case 'CLOSED':
        return <ClosedScreen state={state} tabs={shiftTabs} />;
      default:
        return (
          <Screen title="Смена" subtitle={state.assignment?.equipmentName} tabs={shiftTabs}>
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
      {/*
        Смена НЕ размонтируется при заходе на вкладку: форма паспорта сваи
        держит черновик внутри себя, и размонтирование теряло бы его (ревью №2).
      */}
      <div className={tabActive ? 'hidden' : 'contents'} hidden={tabActive}>{screen()}</div>
      {tabActive ? (
        <Screen
          title={workTab === 'EQUIPMENT' ? 'Техника' : workTab === 'SAFETY' ? 'Техника безопасности' : 'Ещё'}
          subtitle={state.assignment?.equipmentName}
          tabs={tabBar}
        >
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
              <fieldset className="onx-gate" disabled={busy}>
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
              </fieldset>
              <ProfileTab
                state={state}
                onOpenBriefing={() => setDetour({kind: 'BRIEFING'})}
                onOpenKnowledge={() => setDetour({kind: 'KNOWLEDGE'})}
              />
            </>
          ) : null}
        </Screen>
      ) : null}
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
