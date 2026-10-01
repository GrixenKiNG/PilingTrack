'use client';

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {Ellipsis, HardHat, ShieldCheck, Wrench} from 'lucide-react';
import {logoutClient} from '@/lib/api';
import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState, OperatorPhase,
} from '@/modules/operator-mobile/contracts';
import {
  ApiError, currentPosition, fetchState, newCommandId, operatorErrorDetails, operatorErrorText, QueuedOffline,
  sendCommand, type ProductionEntryInput,
} from './api';
import {OfflineQueueBanner} from './offline-queue-banner';
import {useOfflineQueue} from './use-offline-queue';
import {OperatorStatusStrip} from './operator-status-strip';
import {BigButton, Panel, PanelTitle, PhaseBar, Screen, TabBar} from './ui';
import {IdentityScreen} from './screens/identity-screen';
import {BriefingScreen} from './screens/briefing-screen';
import {KnowledgeScreen, isKnowledgeAttemptExpired} from './screens/knowledge-screen';
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
import {knownAnswers} from './safety/known-answers';
import './operator-type.css';

/** Чек-лист, закрывающий фазу. Тот же порядок, что на сервере. */
const PHASE_STAGE: Partial<Record<OperatorMobileState['phase'], ChecklistStage>> = {
  PRESHIFT_INSPECTION: 'PRESHIFT_INSPECTION',
  STARTUP: 'EO_BEFORE',
  SITE_READY: 'SITE_READY',
};

/**
 * Истёкший вход на команде — уводим на вход, но не мгновенно.
 *
 * Задержка нужна, чтобы машинист успел прочитать, почему экран уходит: без неё
 * перезагрузка выглядит как сбой приложения. Тот же переход, что на загрузке
 * состояния (`reload`).
 */
const AUTH_REDIRECT_MS = 2500;
const AUTH_EXPIRED_NOTICE =
  'Сессия истекла. Записи сохранены на телефоне и уйдут после входа.';

/**
 * Текст о несвежем экране после принятой команды.
 *
 * Обещал «обновится автоматически при связи», но автоматического перечитывания
 * не было: экран оставался несвежим до следующего действия (аудит F-V1-QUIET-RELOAD-b).
 * Теперь обещание исполняется — ниже повторное перечитывание, — а к записи
 * приписано прямое «не вводите повторно».
 */
const STALE_SCREEN_NOTICE =
  'Записано. Экран не обновился — обновим, как появится связь. Не вводите запись повторно.';

/**
 * Текст о несвежем экране после ОТКЛОНЁННОЙ команды (F-V1-409-NOTICE-TEXT).
 *
 * На 409 запись не принята — сервер уже в другом состоянии. Прежний
 * `STALE_SCREEN_NOTICE` утверждал «Записано … не вводите запись повторно»:
 * машинист прочитал бы это как «отказ принят» и не ввёл бы отклонённую запись
 * снова — молчаливая потеря. Поэтому здесь только про несвежесть экрана, без
 * «Записано» и без «не вводите повторно»; сам текст отказа 409 остаётся на
 * месте (`actionError`).
 */
const STALE_AFTER_REJECT_NOTICE =
  'Экран не обновился — обновим, как появится связь.';

/**
 * Как часто повторять тихое перечитывание, пока экран остаётся несвежим.
 *
 * Пятнадцать секунд — не чаще: сбой перечитывания обычно значит недоступный
 * сервер, и долбить его каждую секунду незачем. События `online` и возврата на
 * вкладку пробуют раньше таймера.
 */
const QUIET_RELOAD_EVERY_MS = 15_000;

/**
 * Разделы, доступные после начала работы.
 *
 * До этого экран ведёт человека по порядку — допуск, приём, осмотр, пуск,
 * площадка, — и порядок здесь не удобство, а безопасность. Когда работа
 * началась, ведение заканчивается, и машинист сам решает, куда смотреть.
 */
type WorkTab = 'SHIFT' | 'SAFETY' | 'EQUIPMENT' | 'MORE';

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
  /**
   * Отказ сервера (5xx) на загрузке состояния, в отличие от обрыва связи.
   *
   * Держится отдельно от `loadError`: текст «восстановите связь» на 500/503
   * отправляет машиниста искать сеть, которой нет проблем, тогда как чинить
   * надо сервер — об этом и должен узнать диспетчер (R76, находка 4).
   */
  const [serverFault, setServerFault] = useState(false);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * Короткое уведомление над текущим экраном — «запись принята».
   *
   * Держится отдельно от `actionError`: отказ команды и успешная команда,
   * после которой не удалось перечитать состояние, — разные вещи, и красная
   * плашка отказа здесь была бы неправдой. Пока это единственный повод для
   * заметки: сбой «тихого» перечитывания после принятой команды (аудит R76,
   * находка 9).
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Экран остался несвежим после принятой команды: тихое перечитывание упало.
   *
   * Отдельно от `notice`, потому что уведомление бывает двух разных родов: об
   * этом сбое (лечится повтором перечитывания) и об истёкшей сессии (лечится
   * входом). Повторять `reload` на втором значило бы стучаться в закрытую дверь
   * (аудит F-V1-QUIET-RELOAD-b).
   */
  const [staleScreen, setStaleScreen] = useState(false);
  /** Тихое перечитывание уже идёт: параллельных вызовов не заводим. */
  const reloadingQuietly = useRef(false);
  /**
   * Подробности последнего отказа — что именно не заполнено.
   *
   * Держатся рядом с текстом отказа и снимаются вместе с ним: общая фраза
   * «Паспорт заполнен не полностью» без списка полей бесполезна (аудит R76,
   * находка 10). Отбор строк из `ApiError.details` — `operatorErrorDetails`.
   */
  const [actionErrorDetails, setActionErrorDetails] = useState<string[]>([]);
  /**
   * Отказ проверки знаний из-за просроченной попытки. Держится отдельно от
   * `actionError`: экрану мало текста отказа, ему нужно знать, что повтор
   * бесполезен и что выход один — взять новый набор вопросов. У самого экрана
   * ответа сервера нет, поэтому примету считает рабочее место.
   *
   * Снимается началом нового действия или кнопкой «Начать заново», и этого
   * достаточно: попасть в это состояние можно только на итоговом экране
   * проверки, а там других кнопок нет.
   */
  const [knowledgeExpired, setKnowledgeExpired] = useState(false);
  const [busy, setBusy] = useState(false);
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
  /** Таймер перехода на вход после истёкшей сессии: снимаем при размонтировании. */
  const authRedirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /**
   * Перечитать состояние смены.
   *
   * `quiet` — вызов после уже принятой команды. Там сбой перечитывания значит
   * лишь несвежий экран, а не «нет связи»: если показать его как отказ на весь
   * экран, машинист решит, что запись не прошла, и отправит её второй раз
   * (аудит R76, находка 9; в v5 для этого тот же режим). Поэтому ошибку отдаём
   * наверх — вызывающий скажет о ней коротким уведомлением, оставив экран.
   *
   * 401 и 403 «тихими» не бывают: истёкшая сессия и роль — не несвежий экран,
   * и обрабатываются здесь же, до выхода наружу.
   */
  const reload = useCallback(async (options: {quiet?: boolean} = {}) => {
    try {
      const next = await fetchState({
        coordinates: coordinates.current,
        ...(equipmentId ? {equipmentId} : {}),
      });
      setState(next);
      setLoadError(null);
      setServerFault(false);
      // Экран снова свежий — прежняя заметка о несвежести больше не верна.
      setNotice(null);
      setStaleScreen(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- намеренно: сессия истекла, полная перезагрузка сбрасывает кэш маршрутов и память вкладки прежнего входа
        window.location.href = '/login';
        return;
      }
      // Отказ по роли — не обрыв связи, и показывать его как «нет сети» значит
      // отправить помощника машиниста жать «Повторить» до вечера.
      if (error instanceof ApiError && error.status === 403) {
        setForbidden(error.message);
        return;
      }
      // Тихое перечитывание: экран остаётся прежним, о сбое скажет вызывающий.
      if (options.quiet) throw error;
      // 5xx — сломан сервер, а не связь: совет «восстановите связь» здесь врёт,
      // и машинист ищет причину не там.
      setServerFault(error instanceof ApiError && error.status >= 500);
      setLoadError(operatorErrorText(error));
    }
  }, [equipmentId]);

  useEffect(() => {
    void (async () => {
      coordinates.current = await currentPosition();
      await reload();
    })();
  }, [reload]);

  /**
   * Тихое перечитывание, пригодное для повтора: не бросает наружу и не
   * запускается вторым, пока идёт первое.
   *
   * Успех сам снимает уведомление (это делает `reload`), сбой оставляет экран
   * несвежим — и повод для следующей попытки.
   */
  const quietReload = useCallback(async () => {
    if (reloadingQuietly.current) return;
    reloadingQuietly.current = true;
    try {
      await reload({quiet: true});
    } catch {
      // Экран остался несвежим: уведомление не снимаем, повторим по следующему поводу.
    } finally {
      reloadingQuietly.current = false;
    }
  }, [reload]);

  /**
   * Пока экран несвежий — повторять тихое перечитывание, не дожидаясь действия
   * человека.
   *
   * Прежнее уведомление обещало «обновится автоматически при связи», но
   * перечитывал экран только слив очереди, а после удачной немедленной команды
   * очередь пуста: счётчик свай и фаза оставались прежними, и машинист мог
   * ввести ту же сваю второй раз (ключи команд после успеха новые). Поводы —
   * событие `online`, возврат на вкладку и таймер; успешное чтение снимает
   * `notice`, а с ним и подписки, и таймер (аудит F-V1-QUIET-RELOAD-b).
   */
  useEffect(() => {
    if (!staleScreen) return;
    const retry = () => { void quietReload(); };
    const onVisible = () => {
      if (globalThis.document?.visibilityState === 'visible') retry();
    };
    const timer = setInterval(() => {
      // Флаг браузера врёт и в обе стороны, но при явном «сети нет» стучаться
      // смысла нет — дождёмся события `online`.
      if (globalThis.navigator?.onLine === false) return;
      retry();
    }, QUIET_RELOAD_EVERY_MS);
    globalThis.addEventListener?.('online', retry);
    globalThis.document?.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener?.('online', retry);
      globalThis.document?.removeEventListener('visibilitychange', onVisible);
    };
  }, [staleScreen, quietReload]);

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

  /** Отложенный переход на вход не должен сработать после ухода с экрана. */
  useEffect(() => () => {
    if (authRedirectTimer.current !== null) clearTimeout(authRedirectTimer.current);
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
    setActionErrorDetails([]);
    setKnowledgeExpired(false);
    setNotice(null);
    setStaleScreen(false);
    try {
      await work();
      setChecklistCommandId(newCommandId());
      setProductionCommandId(newCommandId());
      setIncidentCommandId(newCommandId());
      setCorrectionCommandId(newCommandId());
      setDetour(null);
      /*
        ТИХОЕ ПЕРЕЧИТЫВАНИЕ (аудит R76, находка 9). Команда уже принята
        сервером, а это чтение лишь освежает экран. Упади оно полноэкранным
        «Нет связи» — машинист прочитал бы «моя свая не записалась» и набрал
        бы её заново. Поэтому экран остаётся прежним, а человек получает
        короткую заметку.
      */
      try {
        await reload({quiet: true});
      } catch {
        setNotice(STALE_SCREEN_NOTICE);
        setStaleScreen(true);
      }
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
        setActionErrorDetails([]);
        /*
          ИСТЁКШИЙ ВХОД — НЕ ПРОСТО ОЧЕРЕДЬ (аудит R76, находка 8). Отложенная
          по 401 запись сольётся после входа того же пользователя: очередь
          привязана к человеку (`ownerId` в `offline-queue.ts`), а
          `use-offline-queue.ts` шлёт её при появлении вошедшего. Но пока входа
          нет, ни одна запись не уйдёт, а машинист об этом не знает — прежний
          экран лишь молча копил «Ожидает отправки: N», и он продолжал вводить
          сваи. Поэтому говорим прямо и тем же переходом, что на загрузке
          состояния (`reload`), уводим на вход — с задержкой, чтобы успеть
          прочитать причину.
        */
        if (error.reason === 'auth') {
          setNotice(AUTH_EXPIRED_NOTICE);
          authRedirectTimer.current = setTimeout(() => {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- намеренно: сессия истекла, полная перезагрузка сбрасывает кэш маршрутов и память вкладки прежнего входа
            window.location.href = '/login';
          }, AUTH_REDIRECT_MS);
        } else {
          /*
            ОБРЫВ СВЯЗИ — НЕ МОЛЧАНИЕ (аудит R76, находка 18). Запись легла на
            устройство, форма закрылась, и машинист не получает ни одного слова о
            том, что введённое не потеряно: остаётся только плашка вверху, которую
            на рабочем экране легко не заметить. Говорим тем же коротким
            уведомлением, что и о несвежем экране, но без кнопки «Обновить»:
            перечитывать нечего — сервер этой записи ещё не видел.
          */
          setNotice(error.message);
        }
        return true;
      }
      setActionError(operatorErrorText(error));
      setActionErrorDetails(operatorErrorDetails(error));
      // Просроченная попытка проверки знаний — единственный отказ, который
      // повтором не лечится: экран предложит новую попытку вместо кнопки
      // повторной отправки. Признак считает `isKnowledgeAttemptExpired` (400 и
      // текст отказа `admission.ts:314`).
      if (error instanceof ApiError && isKnowledgeAttemptExpired(error)) setKnowledgeExpired(true);
      // 409 — сервер уже в другом состоянии (ответ на прошлое нажатие
      // потерялся, смена закрыта): перечитываем, чтобы экран не спорил с ним.
      // Другие ошибки не перечитываем: без связи это сменило бы экран с
      // введёнными цифрами на «Нет связи».
      //
      // ПЕРЕЧИТЫВАНИЕ ТИХОЕ (аудит R82, находка 4). Прежний обычный `reload`
      // на сбое чтения (сеть/5xx) заменял весь экран на «Нет связи» / «Сервер
      // не отвечает» и уносил с собой текст отказа 409 вместе с формой:
      // машинист не успевал прочитать, что именно произошло. Теперь сбой лишь
      // помечает экран несвежим — тот же `staleScreen` и тот же повтор, что
      // после принятой команды, — а отказ 409 остаётся на месте. Текст заметки
      // другой: запись отклонена, а не принята (F-V1-409-NOTICE-TEXT).
      if (error instanceof ApiError && error.status === 409) {
        try {
          await reload({quiet: true});
        } catch {
          setNotice(STALE_AFTER_REJECT_NOTICE);
          setStaleScreen(true);
        }
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  // Что лежит на устройстве и ещё не ушло: машинист видит это постоянно, а не
  // узнаёт по факту пропажи. Когда слать — решает общий хук (use-offline-queue).
  const {queued, flush: flushQueued, retry: retryQueued, retryFailed, discard: discardQueued} = useOfflineQueue(reload);

  if (forbidden) {
    return (
      <OperatorFrame>
        {/*
          Строка состояния и плашка очереди нужны и здесь (аудит R76, находка 17).
          Отказ по роли не отменяет записей, уже лежащих на устройстве: без плашки
          машинист не увидит ни причины отклонённых записей, ни кнопок «Повторить»/
          «Удалить запись», а строка состояния обещает «причина показана ниже»,
          когда ниже ничего нет.
        */}
        <OperatorStatusStrip online={online} items={queued} />
        <OfflineQueueBanner items={queued} onRetry={retryQueued} onDiscard={discardQueued} />
        <Screen
          title="Рабочее место машиниста"
          /*
            Выход из отказа по роли. Раньше экран 403 был тупиком: ни выйти,
            ни войти другим пользователем — только текст причины (аудит R76,
            находки 23 и 26). Смена человека возможна только сменой сессии,
            поэтому кнопка делает то же, что выход в остальных экранах
            приложения, — `logoutClient` (оболочка затем уводит на /login).
          */
          footer={<BigButton onClick={() => void logoutClient()}>Войти другим пользователем</BigButton>}
        >
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
        {/*
          Плашка очереди — сразу под строкой состояния (аудит R76, находка 17).
          Строка состояния при отклонённых записях пишет «Сервер отклонил запись —
          причина показана ниже», а ниже ничего не было: карточки с причиной и
          кнопками оставались на невидимом экране работы.
        */}
        <OfflineQueueBanner items={queued} onRetry={retryQueued} onDiscard={discardQueued} />
        <Screen
          title={serverFault ? 'Сервер не отвечает' : 'Нет связи'}
          footer={<BigButton onClick={() => void reload()}>Повторить</BigButton>}
        >
          <Panel tone="danger">
            <PanelTitle tone="danger">{loadError}</PanelTitle>
            <p className="mt-1 text-sm">
              {serverFault
                ? 'Связь есть, но сервер временно не работает. Сообщите механику или диспетчеру и повторите через несколько минут.'
                : 'Без загруженного состояния нельзя безопасно открыть или закрыть смену. Восстановите связь и повторите. Уже сохранённые на устройстве выработка и события не пропадут.'}
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
        {
          id: 'SAFETY',
          label: 'ТБ',
          icon: <ShieldCheck />,
          // На значке — число непройденных шагов допуска. Ноль значка не рисует.
          badge: admissionBlockers(admissionSteps(state)).length,
        },
        {id: 'EQUIPMENT', label: 'Техника', icon: <Wrench />, badge: state.defects.length},
        {
          id: 'MORE',
          label: 'Ещё',
          icon: <Ellipsis />,
          // Происшествия переехали сюда, поэтому их счётчик — на «Ещё»: иначе
          // неразобранное событие пропадало бы с глаз вместе со вкладкой.
          badge: alarmingIncidents,
          alarming: alarmingIncidents > 0,
        },
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
        : workTab === 'SAFETY' ? 'Техника безопасности' : 'Ещё';
      return (
        <Screen title={title} subtitle={state.assignment?.equipmentName} tabs={tabBar}>
          {workTab === 'EQUIPMENT' ? <EquipmentTab state={state} /> : null}
          {workTab === 'SAFETY' ? (
            <SafetyTab
              state={state}
              onOpen={(step) => setDetour(
                step === 'PPE' ? {kind: 'PPE'}
                  : step === 'BRIEFING' ? {kind: 'BRIEFING'} : {kind: 'KNOWLEDGE'},
              )}
            />
          ) : null}
          {/*
            «Ещё» собирает то, что открывают редко: происшествия (форма внутри
            свёрнута) и свои допуски. Отдельные вкладки под них съедали ширину
            панели: в рукавице палец — это 20 мм, и пять кнопок на 375 px дают
            по 75 px, четыре — по 94 px.
          */}
          {workTab === 'MORE' ? (
            <>
              <IncidentsTab
                state={state}
                busy={busy}
                error={actionError}
                commandId={incidentCommandId}
                onReport={reportIncident}
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
          error={actionError}
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
          expired={knowledgeExpired}
          // Новая попытка начата: прежний отказ снимаем, иначе он висел бы на
          // экране поверх новых вопросов.
          onRestart={() => { setActionError(null); setActionErrorDetails([]); setKnowledgeExpired(false); }}
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
          errorDetails={actionErrorDetails}
          commandId={checklistCommandId}
          lastMeter={state.assignment?.lastMeter ?? null}
          known={knownAnswers(checklist.stage, state)}
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
            errorDetails={actionErrorDetails}
            onSelectEquipment={setEquipmentId}
            onAccept={(input) => void run(() => sendCommand({
              command: 'accept-equipment',
              clientCommandId: newCommandId(),
              ...input,
            }))}
          />
        );
      case 'WORK':
        if (!shift) return <ShiftMissingScreen onReload={() => void reload()} />;
        return (
          <WorkScreen
            state={state}
            busy={busy}
            error={actionError}
            errorDetails={actionErrorDetails}
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
        if (!shift) return <ShiftMissingScreen onReload={() => void reload()} />;
        return (
          <ClosingScreen
            state={state}
            busy={busy}
            error={actionError}
            errorDetails={actionErrorDetails}
            onOpenService={() => setDetour({kind: 'CHECKLIST', stage: 'EO_AFTER'})}
            onClose={(comment) => void run(() => sendCommand({
              command: 'close-shift',
              shiftId: shift.id,
              comment,
            }))}
            tabs={tabBar}
            /*
              Ждущие и отклонённые считаются раздельно: отправка пропускает
              `FAILED`, и общий счётчик запирал закрытие смены без выхода
              (аудит R76, F-V1-CLOSE-FAILED).
            */
            pending={queued.filter((item) => item.state === 'PENDING').length}
            failed={queued.filter((item) => item.state === 'FAILED').length}
            onSendNow={() => void flushQueued()}
            onRetryFailed={retryFailed}
          />
        );
      case 'CLOSED':
        /*
          Отказ, из-за которого экран сюда и попал, не теряем (аудит R82,
          находка 5): смену закрыли на другом устройстве, машинист ввёл сваю и
          получил 409, и без этой строки итог смены молча отличался бы от
          введённого. Плашку с отклонённой записью рисует оболочка выше.
        */
        return (
          <ClosedScreen
            state={state}
            tabs={tabBar}
            error={actionError}
            errorDetails={actionErrorDetails}
          />
        );
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
      <OfflineQueueBanner items={queued} onRetry={retryQueued} onDiscard={discardQueued} />
      {/*
        Короткое уведомление о принятой записи, экран при этом остаётся
        прежним (аудит R76, находка 9). Тон предупреждения, а не отказа:
        запись на сервере есть, несвежим может быть только экран. `role`
        без `alert` — объявление не должно прерывать чтение экрана.
      */}
      {notice ? (
        <div className="px-3 pt-2">
          <Panel tone="warning">
            <p role="status" className="text-sm font-medium">{notice}</p>
            {/*
              Ручной выход к тому же тихому перечитыванию: машинист видит, что
              экран несвежий, и может обновить его сам, не дожидаясь связи или
              таймера. Кнопки нет у уведомления об истёкшей сессии — там нужен
              вход, а не перечитывание (F-V1-QUIET-RELOAD-b).
            */}
            {staleScreen ? (
              <div className="mt-2">
                <BigButton tone="ghost" onClick={() => void quietReload()}>Обновить</BigButton>
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}
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
 * Работа или сдача, а смены в состоянии нет.
 *
 * Раньше это была голая строка «Смена не найдена.» — тупик без выхода и без
 * объяснения (аудит R76, находки 23 и 26). Причина у состояния без смены ровно
 * одна: смену закрыли на другом устройстве, и сервер отдаёт факты уже без неё.
 * Поэтому говорим об этом прямо и даём перечитать состояние — тот же `reload`,
 * что у экрана «Нет связи».
 */
function ShiftMissingScreen({onReload}: {onReload: () => void}) {
  return (
    <Screen title="Смена" footer={<BigButton onClick={onReload}>Обновить</BigButton>}>
      <Panel>
        <PanelTitle>Смена не найдена.</PanelTitle>
        <p className="mt-1 text-sm text-muted-foreground">Смену могли закрыть на другом устройстве.</p>
      </Panel>
    </Screen>
  );
}

