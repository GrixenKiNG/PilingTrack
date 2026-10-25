'use client';

import {WorkScreen, CloseScreen} from "./v5-screens-work";
export {WorkScreen, CloseScreen} from "./v5-screens-work";


import {AcceptScreen, ChecklistScreen, IncidentScreen} from "./v5-screens-shift";


import {PpeScreenV5, BriefingScreenV5, AdmissionScreen} from "./v5-screens-admission";


import {type Tab, timeRu, dateRu, Bar, Top, Dock, Rowline} from "./v5-shared";


import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {useLocalFormDraft} from '../operator-mobile/use-local-form-draft';
import type {CorrectionInput} from '../operator-mobile/screens/entries-list';
import type { ChecklistAnswer, ChecklistStage, IncidentCategory, IncidentSign, OperatorAnswer, OperatorMobileState } from '@/modules/operator-mobile';
import { PHASE_LABELS, ENGINE_HOURS_REPLACEMENT_NOTE } from '@/modules/operator-mobile/client';
import {KnowledgeScreen} from '../operator-mobile/screens/knowledge-screen';
import {formatNumber} from '@/lib/format';
import {nextStep} from '../operator-mobile/shift-next-step';
import {NextStepTab} from '../operator-mobile/step-bar';
import {
  ApiError, QueuedOffline, currentPosition, fetchState, newCommandId, sendCommand, uploadPhoto,
  type ProductionEntryInput,
} from '../operator-mobile/api';
import {OfflineQueueBanner} from '../operator-mobile/offline-queue-banner';
import {useOfflineQueue} from '../operator-mobile/use-offline-queue';

/* ---------------------------------------------------------- приложение --- */

export function OperatorV5App() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Отказ по роли при загрузке состояния — отдельно от «нет связи».
   *
   * 403 значит, что экран не для этой роли: ни «Повторить», ни «данные
   * отправятся позже» здесь не помогут — при 403 ничего не уйдёт, а помощник
   * машиниста жал бы кнопку до вечера. Поэтому текст про роль показываем сам
   * по себе, без кнопки повтора (как в `/operator`).
   */
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('SHIFT');
  const stepScreen = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest === 0) return;
    const screen = stepScreen.current;
    const target = screen?.querySelector<HTMLElement>('[data-next-target="true"]:not(:disabled)')
      ?? screen?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      ?? [...(screen?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
        .find((element) => !element.closest('.v5-bottom'));
    target?.focus();
    target?.scrollIntoView?.({block: 'center'});
  }, [focusRequest]);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({});
  /** Числовые замеры текущего списка: моточасы, остаток топлива, доливы. */
  const [commandId, setCommandId] = useState(newCommandId);
  const [online, setOnline] = useState(true);

  /**
   * Перечитать состояние смены.
   *
   * quiet — вызов после уже принятой команды. Там сбой перечитывания означает
   * лишь несвежий экран, а не «нет связи»: если показать его как отказ на весь
   * экран, машинист решит, что запись не прошла, и отправит её второй раз.
   * Поэтому ошибку отдаём наверх — вызывающий скажет о ней отдельной строкой.
   */
  const reload = useCallback(async (options: {quiet?: boolean} = {}) => {
    try {
      const coordinates = await currentPosition();
      setState(await fetchState({coordinates}));
      setError(null);
      setForbidden(null);
    } catch (cause) {
      // Отказ по роли — не обрыв связи: «Повторить» его не исправит, а
      // «данные отправятся позже» было бы неправдой, при 403 не уйдёт ничего.
      if (cause instanceof ApiError && cause.status === 403) {
        setForbidden(cause.message);
        return;
      }
      if (options.quiet) throw cause;
      setError(cause instanceof ApiError || cause instanceof Error
        ? cause.message
        : 'Состояние смены недоступно');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const update = () => setOnline(globalThis.navigator?.onLine ?? true);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Возвращает признак успеха: форма чистит поля только по нему. Отказ по
  // существу (400/409) — это false: введённое человеком должно остаться на
  // экране. Уход в очередь — принятая запись, то есть true.
  //
  // Успех — это «сервер принял запись (или она легла в очередь)», а не «весь
  // обработчик дошёл до конца». Перечитывание экрана идёт отдельным шагом:
  // его сбой не отменяет уже записанное, иначе машинист увидит ошибку, наберёт
  // то же число заново и выработка задвоится.
  //
  // КНОПКА ЖДЁТ ПЕРЕЧИТЫВАНИЯ (F-R43-3d). Ключ команды меняется сразу по её
  // принятию, а состояние смены приходит только после перечитывания. Отпусти
  // кнопку раньше — машинист увидит прежние счётчики, нажмёт второй раз, и та
  // же выработка уйдёт с новым ключом, то есть задвоится. Поэтому busy снимаем
  // после reload — когда запись принята сервером. Отказ по существу (400/409)
  // перечитывать нечего: там сразу.
  const run = useCallback(async (fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      await fn();
      setCommandId(newCommandId());
      setNotice(done);
    } catch (cause) {
      // Запись легла в очередь — это принятая запись, а не отказ: следующая
      // обязана получить новый ключ. Со старым ключом очередь считала её
      // повтором той же записи и молча не брала, а сервер — тем более.
      //
      // ПЕРЕЧИТЫВАНИЯ ЗДЕСЬ НЕТ (F-R43-3d). Сервер этой записи ещё не видел,
      // обновлять на экране нечего — а без связи reload падает и затирает
      // сообщение очереди текстом «Записано. Не удалось обновить экран»:
      // машинист решит, что запись уже на сервере, хотя она в телефоне. Кнопку
      // отпускаем сразу: держать её занятой до таймаута сети незачем.
      if (cause instanceof QueuedOffline) {
        setCommandId(newCommandId());
        setNotice(cause.message);
        setBusy(false);
        return true;
      } else {
        setActionError(cause instanceof Error ? cause.message : 'Действие не выполнено');
        setNotice(cause instanceof Error ? cause.message : 'Действие не выполнено');
        setBusy(false);
        return false;
      }
    }
    try {
      await reload({quiet: true});
    } catch {
      // Запись уже принята — говорим только о несвежем экране.
      setNotice('Записано. Не удалось обновить экран — потяните вниз / обновите.');
    }
    setBusy(false);
    return true;
  }, [reload]);

  const {queued, flush: flushQueued, retry: retryQueued, discard: discardQueued} = useOfflineQueue(reload);

  /**
   * Периодический чек-лист ТБ, открытый по сроку.
   *
   * Он не привязан к фазе смены: инструктаж действует месяцами, и его проходят
   * когда подошёл срок, а не каждое утро. Поэтому это отдельный выбор
   * человека, а не следующий шаг цикла.
   */
  const [safetyStage, setSafetyStage] = useState<ChecklistStage | null>(null);
  /** Открытый шаг допуска. null — показываем обычный экран фазы. */
  const [admissionStep, setAdmissionStep] = useState<'PPE' | 'BRIEFING' | 'KNOWLEDGE' | null>(null);

  /** Чек-лист, закрывающий текущую фазу. Порядок тот же, что на сервере. */
  const stage: ChecklistStage | null = useMemo(() => {
    if (!state) return null;
    if (safetyStage) return safetyStage;
    if (state.phase === 'PRESHIFT_INSPECTION') return 'PRESHIFT_INSPECTION';
    if (state.phase === 'STARTUP') return 'EO_BEFORE';
    if (state.phase === 'SITE_READY') return 'SITE_READY';
    if (state.phase === 'CLOSING') return 'EO_AFTER';
    return null;
  }, [state, safetyStage]);

  /**
   * Сданный список больше не показываем.
   *
   * Фаза смены меняется не мгновенно: «ЕО после работы» закрывает фазу CLOSING,
   * но пока отчёт не отправлен, фаза та же. Без проверки done экран показывал
   * бы только что сданный чек-лист заново, и человек отвечал бы второй раз.
   */
  const checklist = useMemo(() => {
    if (!stage) return null;
    const list = state?.checklists.find((item) => item.stage === stage) ?? null;
    if (!list) return null;
    // Чек-лист ТБ, открытый по сроку, показываем даже когда он ещё «в норме»:
    // пройти его заранее — законное действие, за которое человека не наказывают.
    if (safetyStage) return list;
    return list.done ? null : list;
  }, [stage, state, safetyStage]);

  const checklistDraft = useLocalFormDraft(state?.operator?.id,
    state?.shift?.id && checklist && `checklist:v5:${state.shift.id}:${checklist.stage}:${checklist.version}`, {
      commandId: newCommandId(), answers: {} as Record<string, OperatorAnswer>, notes: {} as Record<string, string>,
      media: {} as Record<string, string[]>, measures: {} as Record<string, string>,
      meterReplacement: null as {shiftId: string; stage: ChecklistStage} | null,
    }, (value) => !Object.keys(value.answers).length && !Object.values(value.notes).some((note) => note.trim())
      && !Object.values(value.media).some((media) => media.length) && !Object.values(value.measures).some((measure) => measure.trim()) && !value.meterReplacement);
  const [answers, setAnswers] = checklistDraft.field('answers');
  const [notes, setNotes] = checklistDraft.field('notes');
  const [media, setMedia] = checklistDraft.field('media');
  const [measures, setMeasures] = checklistDraft.field('measures');
  const [meterReplacement, setMeterReplacement] = checklistDraft.field('meterReplacement');
  const checklistCommandId = checklistDraft.value.commandId;
  const clearChecklistDraft = checklistDraft.clear;

  const attachChecklistPhoto = async (itemId: string, file: File) => {
    setUploading((current) => ({...current, [itemId]: true}));
    setPhotoErrors((current) => ({...current, [itemId]: ''}));
    try {
      const mediaId = await uploadPhoto({file, clientCommandId: checklistCommandId, itemId});
      setMedia((current) => ({...current, [itemId]: [...(current[itemId] ?? []), mediaId]}));
    } catch (cause) {
      setPhotoErrors((current) => ({...current, [itemId]: cause instanceof Error ? cause.message : 'Снимок не загружен'}));
    } finally {
      setUploading((current) => ({...current, [itemId]: false}));
    }
  };

  const submitChecklist = useCallback(async () => {
    const shiftId = state?.shift?.id;
    const equipmentId = state?.assignment?.equipmentId;
    if (!shiftId || !equipmentId || !checklist || !stage) return;
    const items = checklist.sections.flatMap((section) => section.items);
    const accepted = await run(() => sendCommand({
      command: 'submit-checklist',
      clientCommandId: checklistCommandId,
      shiftId,
      equipmentId,
      stage,
      answers: items.flatMap((item): ChecklistAnswer[] => {
        // «Долил за смену»: пусто — не доливал, ответа нет; литры — «OK» с замером.
        if (item.topUp) {
          const litres = Number((measures[item.measure?.key ?? ''] ?? '').replace(',', '.'));
          return (measures[item.measure?.key ?? ''] ?? '').trim() !== '' && Number.isFinite(litres) && item.measure
            ? [{itemId: item.id, answer: 'OK', measures: {[item.measure.key]: litres}}]
            : [];
        }
        return [{
        itemId: item.id,
        answer: answers[item.id],
        measures: item.measure && (measures[item.measure.key] ?? '').trim() !== ''
          ? {[item.measure.key]: Number((measures[item.measure.key] ?? '').replace(',', '.'))}
          : undefined,
        note: [item.measure?.key === 'engineHours' && meterReplacement?.shiftId === shiftId && meterReplacement.stage === stage ? ENGINE_HOURS_REPLACEMENT_NOTE : '',
          answers[item.id] === 'REMARK' || answers[item.id] === 'FAULT' ? notes[item.id]?.trim() : ''].filter(Boolean).join('; ') || undefined,
        mediaIds: (answers[item.id] === 'REMARK' || answers[item.id] === 'FAULT') && media[item.id]?.length
          ? media[item.id] : undefined,
        }];
      }),
    }), `${checklist.title}: принято.`);
    if (!accepted) return;
    clearChecklistDraft({commandId: newCommandId(), answers: {}, notes: {}, media: {}, measures: {}, meterReplacement: null});
    setPhotoErrors({});
    // Периодический список сдан — возвращаемся туда, откуда его открыли.
    setSafetyStage(null);
  }, [answers, checklist, checklistCommandId, measures, media, meterReplacement, notes, run, stage, state, clearChecklistDraft]);

  const reportIncident = useCallback((input: {
    category: IncidentCategory; signs: IncidentSign[]; injured: boolean; description: string;
  }) => {
    const shiftId = state?.shift?.id;
    if (!shiftId) return;
    void run(() => sendCommand({
      command: 'report-incident', clientCommandId: commandId, shiftId, ...input,
    }), 'Происшествие записано.');
  }, [commandId, run, state]);

  const logProduction = useCallback(async (entry: ProductionEntryInput): Promise<boolean> => {
    const shiftId = state?.shift?.id;
    if (!shiftId) return false;
    return run(
      () => sendCommand({command: 'log-production', clientCommandId: commandId, shiftId, entry}),
      'Записано.',
    );
  }, [commandId, run, state]);

  const correctProduction = useCallback(async (input: CorrectionInput): Promise<boolean> => {
    const shiftId = state?.shift?.id;
    if (!shiftId) return false;
    return run(() => sendCommand({command: 'correct-production', clientCommandId: commandId, shiftId, ...input}),
      'Поправка записана.');
  }, [commandId, run, state]);

  if (forbidden) {
    return (
      <div className="app">
        <div className="scr">
          <h2 className="h">{forbidden}</h2>
          <p className="note">
            Смену ведёт машинист, закреплённый за установкой. Записи о выработке и осмотрах
            подаёт он.
          </p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="app">
        <div className="scr">
          <h2 className="h">Нет связи с сервером</h2>
          <p className="note bad">{error}</p>
          <button className="b" type="button" disabled={busy} onClick={() => void reload()}>
            Повторить
          </button>
          <p className="note">
            Введённые данные сохранены на телефоне и отправятся, когда связь появится.
          </p>
        </div>
      </div>
    );
  }
  if (!state) {
    return <div className="app"><div className="scr"><p className="note">Читаем состояние смены…</p></div></div>;
  }

  const shiftId = state.shift?.id ?? null;
  const oldShift = state.shift && state.shift.productionDate < state.productionDate
    && (state.shift.state === 'STARTED' || state.shift.state === 'HANDOVER_PENDING')
    ? state.shift : null;
  const editingOldShift = oldShift && editingShiftId === shiftId;
  const addWork = () => { setEditingShiftId(shiftId); setTab('WORK'); };

  /*
    Кнопка «Следующий шаг» в нижнем меню между «Работой» и «Дефектами» (решение
    владельца 09.10.2026; прежняя панель «Главная / Следующий шаг / Завершить
    смену» убрана). Что считать следующим шагом, решает фаза сервера
    (shift-next-step); здесь только переходы этого модуля. Экран фазы (допуск,
    приём, осмотр, сдача) и есть главный экран: goHome закрывает обходные шаги
    и вкладку.
  */
  const goHome = () => { setEditingShiftId(null); setAdmissionStep(null); setSafetyStage(null); setTab('SHIFT'); };
  const goNext = () => {
    const step = nextStep(state);
    const action = step.action;
    if (action.kind !== 'WAIT_ADMISSION' && action.kind !== 'NONE') {
      setNotice(step.hint);
      setFocusRequest((request) => request + 1);
    }
    switch (action.kind) {
      case 'ADMISSION': setSafetyStage(null); setTab('SHIFT'); setAdmissionStep(action.open); break;
      case 'WAIT_ADMISSION': void reload(); break;
      case 'LOG_WORK': setAdmissionStep(null); setSafetyStage(null); setTab('WORK'); break;
      case 'ACCEPT_EQUIPMENT':
      case 'CHECKLIST':
      case 'SERVICE_AFTER':
      case 'CLOSE_SHIFT': goHome(); break;
      default: break;
    }
  };

  const body = () => {
    /*
      Шаг допуска перекрывает экран фазы: у каждого свой порядок и своя кнопка.
      Проверка знаний взята готовой из рабочего места `/operator` — свой банк
      вопросов у модуля заводить незачем, он один на продукт.
    */
    if (admissionStep === 'PPE') {
      return (
        <PpeScreenV5
          busy={busy}
          onBack={() => setAdmissionStep(null)}
          onConfirm={(items) => {
            setAdmissionStep(null);
            void run(() => sendCommand({
              command: 'confirm-ppe', productionDate: state.productionDate, items,
            }), 'Средства защиты проверены.');
          }}
        />
      );
    }
    if (admissionStep === 'BRIEFING') {
      return (
        <BriefingScreenV5
          state={state}
          busy={busy}
          onBack={() => setAdmissionStep(null)}
          onAcknowledge={() => {
            setAdmissionStep(null);
            void run(() => sendCommand({command: 'acknowledge-briefing'}), 'Ознакомление записано.');
          }}
        />
      );
    }
    if (admissionStep === 'KNOWLEDGE') {
      return (
        <KnowledgeScreen
          busy={busy}
          error={error}
          onBack={() => setAdmissionStep(null)}
          onDone={(picks, attemptToken) => {
            setAdmissionStep(null);
            void run(() => sendCommand({
              command: 'submit-knowledge', attemptToken, picks,
            }), 'Проверка знаний записана.');
          }}
        />
      );
    }

    if (tab === 'DEFECTS') {
      return (
        <div className="scr">
          <p className="kicker">Открытые неисправности</p>
          {state.defects.length === 0
            ? <p className="note good">Открытых неисправностей нет</p>
            : state.defects.map((defect) => (
              <Rowline
                key={defect.id}
                label={defect.title}
                note={`${defect.reportedByMe ? 'записали вы' : defect.reportedByName} · ${dateRu(defect.reportedAt)}`}
                badge="открыт"
                tone="warn"
              />
            ))}
        </div>
      );
    }

    if (tab === 'EVENTS') {
      return <IncidentScreen state={state} busy={busy} onReport={reportIncident} />;
    }

    if (tab === 'MORE') {
      return (
        <div className="scr">
          <p className="kicker">Журнал смены</p>
          {state.entries.length === 0
            ? <p className="note">За смену пока ничего не записано</p>
            : state.entries.map((entry) => (
              <Rowline
                key={entry.id}
                label={entry.label}
                note={timeRu(entry.occurredAt)}
                badge={`${formatNumber(entry.value, 0)}${entry.kind === 'DOWNTIME' ? ' ч' : ' шт'}`}
              />
            ))}
          <p className="kicker">Смена</p>
          <Rowline label="Этап" badge={PHASE_LABELS[state.phase]} />
          <Rowline label="Производственные сутки" badge={dateRu(state.productionDate)} />
        </div>
      );
    }

    if (tab === 'WORK' && state.phase !== 'WORK' && state.phase !== 'CLOSING') {
      return (
        <div className="scr">
          <p className="note warn">
            Учёт откроется после допуска и осмотра. Сейчас: {PHASE_LABELS[state.phase]}
          </p>
        </div>
      );
    }

    // Открытый по сроку чек-лист ТБ перекрывает рабочий экран: человек его сам
    // и открыл, и возврат — по кнопке «Завершить» внизу списка.
    if (oldShift && state.phase === 'WORK' && !editingOldShift && !safetyStage) {
      return (
        <div className="scr">
          <p className="kicker">Сдача смены за {dateRu(oldShift.productionDate)}</p>
          <button className="b gh" type="button" disabled={busy} onClick={addWork}>
            Дописать отчёт за {dateRu(oldShift.productionDate)}
          </button>
          <button className="b" type="button" disabled={busy} onClick={() => {
            goHome();
            if (shiftId) void run(() => sendCommand({command: 'finish-work', shiftId}), 'Работа завершена.');
          }}>
            Перейти к сдаче смены
          </button>
        </div>
      );
    }

    if ((state.phase === 'WORK' || (state.phase === 'CLOSING' && tab === 'WORK'))
      && (!oldShift || editingOldShift) && !safetyStage) {
      return (
        <>
        {editingOldShift ? <button className="b gh" type="button" onClick={goHome}>К сдаче смены</button> : null}
        <WorkScreen
          state={state}
          busy={busy}
          onLog={logProduction}
          onCorrect={correctProduction}
          correctionError={actionError}
          onOpenSafety={setSafetyStage}
          afterFinish={state.phase !== 'WORK' || Boolean(oldShift)}
          onIncident={()=>setTab('EVENTS')}
          onFinish={() => {
            if (shiftId) void run(() => sendCommand({command: 'finish-work', shiftId}), 'Работа завершена.');
          }}
        />
        </>
      );
    }

    if (state.phase === 'IDENTITY') {
      return (
        <AdmissionScreen
          state={state}
          busy={busy}
          onPpe={() => setAdmissionStep('PPE')}
          onBriefing={() => setAdmissionStep('BRIEFING')}
          onKnowledge={() => setAdmissionStep('KNOWLEDGE')}
        />
      );
    }

    if (state.phase === 'ADMISSION') {
      return (
        <AcceptScreen
          state={state}
          busy={busy}
          onAccept={(equipmentId) => void run(
            () => sendCommand({
              command: 'accept-equipment',
              clientCommandId: commandId,
              equipmentId,
              shiftType: 'DAY',
            }),
            'Машина принята.',
          )}
        />
      );
    }

    if (checklist) {
      return (
        <ChecklistScreen
          checklist={checklist}
          answers={answers}
          measures={measures}
          notes={notes}
          media={media}
          uploading={uploading}
          photoErrors={photoErrors}
          meterReplaced={meterReplacement?.shiftId === shiftId && meterReplacement?.stage === stage}
          onMeterReplacement={(replaced) => setMeterReplacement(replaced && shiftId && stage ? {shiftId, stage} : null)}
          busy={busy}
          lastMeter={state.assignment?.lastMeter ?? null}
          onAnswer={(itemId, answer) => setAnswers((current) => ({...current, [itemId]: answer}))}
          onMeasure={(key, value) => setMeasures((current) => ({...current, [key]: value}))}
          onNote={(itemId, value) => setNotes((current) => ({...current, [itemId]: value}))}
          onPhoto={attachChecklistPhoto}
          onSubmit={submitChecklist}
        />
      );
    }

    return (
      <CloseScreen
        state={state}
        busy={busy}
        unsent={queued.length}
        onFlush={() => void flushQueued()}
        onAddWork={addWork}
        onClose={() => {
          if (shiftId) void run(() => sendCommand({command: 'close-shift', shiftId, comment: ''}), 'Смена закрыта.');
        }}
      />
    );
  };

  return (
    <div className="app" ref={stepScreen}>
      <Bar online={online} />
      <Top state={state} />
      {oldShift ? (
        <div className="scr">
          <p className="note warn">Не сдана смена за {dateRu(oldShift.productionDate)}</p>
          <p className="note">Сегодняшняя работа — после открытия новой смены. Здесь можно дописать только выполненное за {dateRu(oldShift.productionDate)} и сдать смену.</p>
        </div>
      ) : null}
      {notice ? <p className="note">{notice}</p> : null}
      <OfflineQueueBanner items={queued} onRetry={retryQueued} onDiscard={discardQueued} />
      {body()}
      {/* Кнопка «Следующий шаг» стоит в самом меню — между «Работой» и «Дефектами». */}
      <div className="v5-bottom">
        <Dock
          active={tab}
          onSelect={setTab}
          extra={{
            after: 'WORK',
            node: (
              <NextStepTab
                step={nextStep(state)}
                busy={busy}
                onNext={goNext}
                onFinishWork={() => {
                  if (!shiftId) return;
                  goHome();
                  void run(() => sendCommand({command: 'finish-work', shiftId}), 'Работа завершена.');
                }}
                labelSize="12px"
                ringColor="var(--surface-2, #fff)"
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
