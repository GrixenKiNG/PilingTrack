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
 * ОСМОТРЫ — ИЗ КАТАЛОГА В КОДЕ. Все четыре списка смены (предсменный осмотр,
 * ЕО до работы, готовность площадки, ЕО после работы) приходят из
 * `checklist-catalog.ts` и сдаются командой `submit-checklist` — теми же, что
 * у остальных модулей. Раньше их было три разных источника: шаблоны механика
 * для осмотров и два списка, зашитых в экран, которые нигде не сохранялись.
 */

import {OperatorWorkOverview} from '../operator-mobile/operator-work-overview';
import { formatDowntimeHours } from '@/lib/downtime-hours';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/api';
import { getEquipmentPhoto } from '@/components/piling/admin-equipment/equipment-photo';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import type { OperatorShiftFacts } from '@/modules/readiness/application/operator-shift-query';
import type { ClearanceDocument } from '@/modules/users';
import { WeatherCard } from './weather-card';
import { DefectSheet } from './defect-sheet';
import { DowntimeSheet, DrillingSheet, HandoverSheet, PileSheet } from './sheets';
import { PilePassportForm } from '@/components/piling/operator-mobile/screens/pile-passport-form';
import { IncidentsTab } from '@/components/piling/operator-mobile/screens/incidents-tab';
import {
  BigCheck, BottomTabs, CheckRow, RowList, StepButton, StepShell, ValueRow, type V2Tab,
} from './ui';
import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  fetchState, QueuedOffline, sendCommand, type ProductionEntryInput,
} from '@/components/piling/operator-mobile/api';
import { SafetyTab } from '@/components/piling/operator-mobile/screens/safety-tab';
import { PpeScreen } from '@/components/piling/operator-mobile/screens/ppe-screen';
import { BriefingScreen } from '@/components/piling/operator-mobile/screens/briefing-screen';
import { KnowledgeScreen } from '@/components/piling/operator-mobile/screens/knowledge-screen';
import { ChecklistScreen } from '@/components/piling/operator-mobile/screens/checklist-screen';
import { knownAnswers } from '@/components/piling/operator-mobile/safety/known-answers';
import { V2_STEP_STAGE, V2_STEP_TITLE, resolveV2State, stepCaption } from './shift-flow';

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

/**
 * Личный допуск одной строкой, раскрывается касанием.
 *
 * Список из тринадцати удостоверений — это лист на полэкрана, который человек
 * видит каждое утро и мимо которого проходит, не читая. Ему нужен ответ на
 * один вопрос: пускают ли сегодня. Сроки нужны раз в несколько месяцев, когда
 * что-то подходит к концу, — тогда их и открывают.
 */
function ClearanceRow({ cleared, operatorName, documents }: {
  cleared: boolean;
  operatorName: string;
  documents: ClearanceDocument[];
}) {
  const [open, setOpen] = useState(false);
  const attention = documents.filter(
    (document) => document.status === 'expired'
      || document.status === 'missing'
      || document.status === 'expiring',
  );
  const nearest = documents
    .map((document) => document.expiresAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left active:bg-muted/60"
      >
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
          cleared ? 'bg-success' : 'bg-warning')}>
          {cleared ? '✓' : '!'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            {cleared ? 'Допуск подтверждён' : 'К работе не допущен'}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {operatorName} · документов: {documents.length}
            {attention.length > 0
              ? ' · требуют внимания: ' + attention.length
              : nearest ? ' · ближайший срок ' + new Date(nearest).toLocaleDateString('ru-RU') : ''}
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">{open ? '⌄' : '›'}</span>
      </button>

      {open && (
        documents.length > 0 ? (
          <RowList>
            {documents.map((document) => (
              <li key={document.typeId}>
                <ValueRow
                  label={document.typeName}
                  value={documentStatusText(document)}
                  tone={document.status === 'expired' || document.status === 'missing'
                    || document.status === 'expiring' ? 'warn' : 'ok'}
                />
              </li>
            ))}
          </RowList>
        ) : (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Обязательные документы администратором не заданы — проверять нечего
          </p>
        )
      )}
    </div>
  );
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
  const [accepted, setAccepted] = useState(false);
  /*
    Ключ команды осмотра и его ошибка.

    Ключ переживает нажатие: на морозе в перчатке по кнопке попадают дважды, и
    второй запрос с тем же ключом сервер узнаёт как повтор вместо второго
    осмотра. Новый ключ выдаётся только после удачной сдачи.
  */
  const [checklistCommandId, setChecklistCommandId] = useState(() => crypto.randomUUID());
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [defectOpen, setDefectOpen] = useState(false);
  const [pileOpen, setPileOpen] = useState(false);
  const [passportOpen, setPassportOpen] = useState(false);
  const [drillingOpen, setDrillingOpen] = useState(false);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [tab, setTab] = useState<V2Tab>('shift');
  /*
    Снимок рабочего места (`/api/operator/mobile/state`) — второй источник
    экрана, и он же единственный источник выработки.

    ПОЧЕМУ ВЫРАБОТКА ЖИВЁТ ЗДЕСЬ, А НЕ В СВОЁМ СЛОЕ. Раньше модуль писал сваи и
    простои через `/api/reports/upsert` — своим путём, не тем, которым пишут
    остальные четыре версии. Расходились не только оформление отчёта (чужой
    номер вместо «RM-<смена>-<дата>», пустые время смены, моточасы и топливо),
    но и правила: `upsert` требует, чтобы марка была в плане объекта, а
    `log-production` — нет. На объекте без плана один модуль записывал сваю, а
    этот отказывал, и спорить об этом можно было бесконечно, потому что оба
    поступали по-своему верно. Путь оставлен один.

    Контур готовности, на котором держится остальной экран, про выработку,
    СИЗ, ознакомление и проверку знаний не знает — это разные наборы фактов.
  */
  const [mobile, setMobile] = useState<OperatorMobileState | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);
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

  /** Перечитать снимок рабочего места — источник выработки, допуска и ТБ. */
  const loadMobile = useCallback(async () => {
    try {
      setMobile(await fetchState({}));
      setMobileError(null);
    } catch (cause) {
      setMobileError(cause instanceof Error ? cause.message : 'Рабочее место недоступно');
    }
  }, []);

  /* Шаги допуска записываются теми же командами, что и в остальных модулях:
     своих у вкладки нет — иначе один и тот же факт писался бы двумя путями. */
  const runSafety = useCallback(async (command: Parameters<typeof sendCommand>[0]) => {
    setBusy(true);
    try {
      await sendCommand(command);
      await loadMobile();
      setSafetyStep(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Действие не выполнено');
    } finally {
      setBusy(false);
    }
  }, [loadMobile]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка фактов смены
    void load();
  }, [load]);

  /*
    Снимок читаем сразу, а не при открытии вкладки ТБ.

    Раньше он грузился лениво — вкладку за смену открывали не все. Теперь на
    нём держится выработка: счётчики смены, журнал записей и справочники. Без
    него экран работы пуст, поэтому он больше не ждёт касания.
  */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- снимок рабочего места
    void loadMobile();
  }, [loadMobile]);

  /**
   * Ответы, которые на площадке даёт не человек, а измерение.
   *
   * Ветер оператор всё равно не «проверяет» — он смотрит на ту же цифру,
   * которую приложение уже получило и показало на приёмке. Повторный вопрос
   * не добавляет ни знания, ни ответственности, зато учит пролистывать список.
   *
   * Порог здесь тот же, по которому карточка погоды рисует предупреждение:
   * два разных порога на двух экранах одной смены — это не осторожность, а
   * противоречие. ВНИМАНИЕ: карточка считает опасным ветром 20 м/с, а правила
   * смены в modules/operator-mobile — 15 м/с. Расхождение вынесено владельцу,
   * до его решения экраны v2 держатся одного числа между собой.
   *
   * Ветер выше порога ответа не получает: там решает человек на площадке.
   */

  const postDone = mobile?.checklists.find((item) => item.stage === 'EO_AFTER')?.done ?? false;
  const state = facts
    ? resolveV2State(facts, mobile?.phase ?? null, postDone, { accepted, finishing })
    : null;
  const elapsed = useElapsed(facts?.shift?.startedAt ?? null);

  /**
   * Пока контур готовности держит машину — перечитываем факты.
   *
   * ПОЧЕМУ ЭТО НУЖНО. Оценка готовности считается НЕ в момент запроса: закрытие
   * осмотра кладёт в очередь событие, и снимок обновляется через долю секунды
   * после ответа сервера. Экран успевал прочитать факты в этот зазор, получал
   * «Нет осмотра за сегодня» по только что закрытому осмотру — и застревал
   * навсегда: кнопка на этом шаге выключена, перечитать было нечем.
   *
   * Отсюда короткий опрос вместо одного чтения. Он живёт только на шаге пуска
   * и только пока есть блокировки: как только машину пустили, опрос прекращается.
   */
  const blockedAtStartup = state?.step === 'startup' && state.blockers.length > 0;
  useEffect(() => {
    if (!blockedAtStartup) return;
    const timer = setInterval(() => { void load(); }, 6000);
    return () => clearInterval(timer);
  }, [blockedAtStartup, load]);

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
  /**
   * Выработка смены — из снимка рабочего места.
   *
   * Счётчики и журнал считает сервер по записанным командам, а не экран по
   * своему черновику: черновик, разошедшийся с сервером, — это спор бригадира
   * с диспетчером в конце месяца, и именно он здесь и случался.
   */
  const production = mobile?.production ?? null;
  const entries = mobile?.entries ?? [];
  const grades = mobile?.dictionaries.pileGrades ?? [];
  const drillingTypes = mobile?.dictionaries.drillingTypes ?? [];
  const reasons = mobile?.dictionaries.downtimeReasons ?? [];
  const totalPiles = production?.piles.count ?? 0;
  const totalDrilling = production?.drilling.count ?? 0;
  const totalDowntime = production?.downtimeHours ?? 0;
  // Выработку запрещает сервер; экран гасит кнопки той же причиной.


  /*
    Ключ команды происшествия живёт дольше формы: снимки привязываются к нему
    ДО того, как запись появилась, — привязать их иначе не к чему. После
    удачной записи ключ меняем, иначе фото следующего происшествия уехало бы
    к предыдущему.
  */
  const [incidentCommandId, setIncidentCommandId] = useState(() => crypto.randomUUID());

  const reportIncident = useCallback(async (input: {
    category: string; signs: string[]; injured: boolean; description: string; mediaIds: string[];
  }) => {
    const shiftId = mobile?.shift?.id ?? facts?.shift?.id;
    if (!shiftId) {
      toast.error('Смена не найдена — записать некуда');
      return false;
    }
    setBusy(true);
    try {
      await sendCommand({
        command: 'report-incident',
        clientCommandId: incidentCommandId,
        shiftId,
        category: input.category,
        signs: input.signs,
        injured: input.injured,
        description: input.description,
        mediaIds: input.mediaIds,
      });
      setIncidentCommandId(crypto.randomUUID());
      await loadMobile();
      return true;
    } catch (cause) {
      // Легла в очередь — запись принята устройством: форму закрываем и ключ
      // меняем, как при успехе.
      if (cause instanceof QueuedOffline) {
        setIncidentCommandId(crypto.randomUUID());
        toast.info(cause.message);
        return true;
      }
      toast.error(cause instanceof Error ? cause.message : 'Происшествие не записано');
      return false;
    } finally {
      setBusy(false);
    }
  }, [mobile?.shift?.id, facts?.shift?.id, incidentCommandId, loadMobile]);

  /**
   * Сдать осмотр — той же командой, что и остальные модули.
   *
   * Порядок этапов проверяет сервер: он знает, что до ЕО площадку не смотрят,
   * и откажет раньше, чем это сделает экран. Вторая копия правила здесь рано
   * или поздно разошлась бы с первой и начала разрешать запрещённое.
   */
  const submitChecklist = useCallback(async (stage: ChecklistStage, answers: ChecklistAnswer[]) => {
    const shiftId = mobile?.shift?.id ?? facts?.shift?.id;
    const equipmentId = mobile?.assignment?.equipmentId ?? facts?.equipment?.id;
    if (!shiftId || !equipmentId) {
      setChecklistError('Смена не найдена — осмотр не к чему приложить');
      return;
    }
    setBusy(true);
    setChecklistError(null);
    try {
      await sendCommand({
        command: 'submit-checklist',
        clientCommandId: checklistCommandId,
        shiftId,
        equipmentId,
        stage,
        answers,
      });
      setChecklistCommandId(crypto.randomUUID());
      await Promise.all([loadMobile(), load()]);
    } catch (cause) {
      setChecklistError(cause instanceof Error ? cause.message : 'Осмотр не принят');
    } finally {
      setBusy(false);
    }
  }, [mobile?.shift?.id, mobile?.assignment?.equipmentId, facts?.shift?.id, facts?.equipment?.id,
    checklistCommandId, loadMobile, load]);

  /**
   * Записать выработку той же командой, что и остальные модули.
   *
   * Ключ команды — свой на каждую запись: сервер узнаёт по нему повтор и
   * второй сваи не заводит, если ответ потерялся в дороге. Это же делает
   * запись пригодной для очереди на устройстве: обрыв связи её не теряет.
   */
  // Ключ переживает нажатие: двойное касание в перчатке не должно давать две
  // записи. Новый ключ — только после принятой записи.
  const [productionCommandId, setProductionCommandId] = useState(() => crypto.randomUUID());
  const logProduction = useCallback(async (entry: ProductionEntryInput) => {
    const shiftId = mobile?.shift?.id ?? facts?.shift?.id;
    if (!shiftId) {
      toast.error('Смена не найдена — записать некуда');
      return false;
    }
    setBusy(true);
    try {
      await sendCommand({
        command: 'log-production',
        clientCommandId: productionCommandId,
        shiftId,
        entry,
      });
      setProductionCommandId(crypto.randomUUID());
      await loadMobile();
      return true;
    } catch (cause) {
      // Легла в очередь — запись принята устройством. Раньше это показывалось
      // ошибкой, форма оставалась открытой, машинист жал снова — и с новым
      // ключом в очередь ложилась вторая такая же запись: сваи задваивались.
      if (cause instanceof QueuedOffline) {
        setProductionCommandId(crypto.randomUUID());
        toast.info(cause.message);
        return true;
      }
      toast.error(cause instanceof Error ? cause.message : 'Запись не прошла');
      return false;
    } finally {
      setBusy(false);
    }
  }, [mobile?.shift?.id, facts?.shift?.id, productionCommandId, loadMobile]);

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

  /**
   * Принять машину.
   *
   * ПРИЁМКА ИДЁТ ТОЙ ЖЕ КОМАНДОЙ, ЧТО И У ОСТАЛЬНЫХ МОДУЛЕЙ.
   *
   * Раньше модуль открывал смену через контур готовности
   * (`POST /api/readiness/shifts` + команда `start`). С переходом осмотров на
   * каталог это перестало сходиться: контур готовности не пускает смену, пока
   * нет «осмотра за сегодня» в его собственной таблице `Inspection`, а осмотр
   * каталога пишется в `OperatorChecklistExecution` и такой записи не делает.
   * Получался замкнутый круг — смена не пускалась без осмотра, а осмотр не
   * начинался без пущенной смены. Экран возвращал человека на приёмку по кругу
   * и ничего не объяснял.
   *
   * `accept-equipment` заводит смену сразу живой и снимает показания погоды и
   * условий — то, ради чего приёмка и существует. Приём ПЕРЕДАЧИ от прошлой
   * смены остаётся на контуре готовности: это отдельный факт со своим
   * журналом, и он у модуля свой.
   */
  const acceptOn = async (equipmentId: string) => {
    setBusy(true);
    try {
      const hour = new Date().getHours();
      await sendCommand({
        command: 'accept-equipment',
        clientCommandId: crypto.randomUUID(),
        equipmentId,
        shiftType: hour >= 20 || hour < 8 ? 'NIGHT' : 'DAY',
      });
      setAccepted(true);
      await Promise.all([load(), loadMobile()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось принять машину');
    } finally {
      setBusy(false);
    }
  };

  const acceptEquipment = async () => {
    const incoming = facts?.incomingHandover;

    if (incoming && facts?.shift && incoming.shiftId !== facts.shift.id) {
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
        await Promise.all([load(), loadMobile()]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось принять машину');
      } finally {
        setBusy(false);
      }
      return;
    }

    const equipmentId = mobile?.assignment?.equipmentId
      ?? facts?.equipment?.id
      ?? facts?.assignments[0]?.equipmentId;
    if (!equipmentId) {
      toast.error('Установка за вами не закреплена');
      return;
    }
    setBusy(true);
    try {
      const hour = new Date().getHours();
      await sendCommand({
        command: 'accept-equipment',
        clientCommandId: crypto.randomUUID(),
        equipmentId,
        shiftType: hour >= 20 || hour < 8 ? 'NIGHT' : 'DAY',
      });
      setAccepted(true);
      await Promise.all([load(), loadMobile()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось принять машину');
    } finally {
      setBusy(false);
    }
  };

  /** Передать смену следующему оператору — последняя команда цикла. */
  /**
   * Сдать отчёт — той же командой и с тем же содержимым, что и остальные модули.
   *
   * Смену она не закрывает: здесь её принимает следующий оператор, и передача
   * (ниже) работает с ещё живой сменой.
   */
  const submitReport = useCallback(async () => {
    const shiftId = mobile?.shift?.id ?? facts?.shift?.id;
    if (!shiftId) return;
    setBusy(true);
    try {
      await sendCommand({command: 'submit-report', shiftId, comment: ''});
      await Promise.all([loadMobile(), load()]);
      toast.success('Отчёт отправлен');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Отчёт не отправлен');
    } finally {
      setBusy(false);
    }
  }, [mobile?.shift?.id, facts?.shift?.id, loadMobile, load]);

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


  if (safetyStep && mobile) {
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
          error={mobileError}
          onBack={back}
          onConfirm={(items) => void runSafety({
            command: 'confirm-ppe', productionDate: mobile.productionDate, items,
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
        error={mobileError}
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
  // Секундомер приёмки в подписи виден до пуска: после него он теряет смысл,
  // а место занимает счётчик отработанного времени.
  const stepLabel = step === 'work' || step === 'closed'
    ? stepCaption(step)
    : `${stepCaption(step)}${prepElapsed ? ` · ${prepElapsed}` : ''}`;

  // ---------- 1. Допуск и приёмка ----------
  //
  // Один экран вместо двух (решение владельца 18.09.2026). Раньше человек
  // подтверждал допуск кнопкой «Продолжить», а следом принимал машину кнопкой
  // «Принять установку» — два нажатия подряд, из которых первое ничего не
  // решало: документы проверены автоматически, и оператор знает их наизусть.
  //
  // Допуск здесь свёрнут в одну строку и раскрывается касанием. Раскрытым он
  // был листом на полэкрана, мимо которого проходят каждое утро.
  if (step === 'acceptance') {
    const cleared = state.blockers.length === 0;
    const documents = facts.clearance.documents;
    // До открытия смены кнопки внизу нет: машину выбирают из списка, и
    // единственная закреплённая — тоже выбор, а не подстановка за человека.
    const canAct = cleared && Boolean(facts.shift);
    return (
      <StepShell
        title={tab === 'safety' ? 'Техника безопасности' : V2_STEP_TITLE.acceptance}
        subtitle={stepLabel}
        tone={cleared ? 'green' : 'blue'}
        /*
          Вкладка «ТБ» нужна ИМЕННО НА ЭТОМ ШАГЕ: СИЗ, инструкция и проверка
          знаний проходятся до смены, а не после. Дальше по ходу смены панель
          появляется только на экране работы: бросать осмотр на середине нельзя.
        */
        footer={(
          <>
            {tab === 'shift' && canAct ? (
              <StepButton label="Принять установку" onClick={() => void acceptEquipment()} busy={busy} />
            ) : null}
            <BottomTabs active={tab} onSelect={setTab} />
          </>
        )}
      >
        {tab !== 'shift' ? (
          tab === 'safety'
            ? (
              mobile
                ? <SafetyTab state={mobile} onOpen={setSafetyStep} />
                : <p className="text-sm text-muted-foreground">{mobileError ?? 'Читаем ваш допуск…'}</p>
            )
            : (
              <p className="text-sm text-muted-foreground">
                Техника, журнал и прочие разделы открываются после начала работы:
                до приёмки установки показывать там нечего.
              </p>
            )
        ) : (
        <>
        <ClearanceRow
          cleared={cleared}
          operatorName={user?.name?.trim() || 'Оператор'}
          documents={documents}
        />

        <Blockers items={state.blockers} />

        {facts.clearance.warnings.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
            {facts.clearance.warnings.map((item) => (
              <li key={item} className="text-sm text-warning-strong">{item}</li>
            ))}
          </ul>
        )}

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
                    onToggle={() => void acceptOn(assignment.equipmentId)}
                  />
                </li>
              ))}
            </RowList>
          </>
        )}

        {/* Погода на площадке — по геопозиции телефона. Ветер это прямое
            ограничение свайных работ, и узнать о нём надо до подъёма мачты. */}
        {/* Ответы, которые система знает сама (ветер при свежем прогнозе),
            подставляет общий модуль `known-answers` прямо в экране чек-листа —
            своей копии этого правила у модуля больше нет. */}
        <WeatherCard
          siteId={siteId}
          siteName={facts.assignments.find((item) => item.siteId === siteId)?.siteName ?? null}
        />

        </>
        )}
      </StepShell>
    );
  }

  // ---------- 3–5. Осмотры каталога: предсменный, ЕО до работы, площадка, ЕО после ----------
  //
  // ОДИН ЭКРАН НА ЧЕТЫРЕ ЭТАПА. Раньше это были три разных механизма: осмотр
  // через контур готовности (шаблоны механика), площадка и пуск — списками,
  // зашитыми в экран и нигде не сохранявшимися. Теперь все четыре — этапы
  // одного каталога, и экран у них тот же, что у действующего `/operator`:
  // свёрнутые разделы, «Весь раздел в норме», замеры с границами, ответы
  // системы по погоде. Расходиться этим экранам больше не на чем.
  const catalogStage = V2_STEP_STAGE[step];
  if (catalogStage) {
    const list = mobile?.checklists.find((item) => item.stage === catalogStage) ?? null;
    if (!mobile || !list) {
      return (
        <StepShell title={V2_STEP_TITLE[step]} subtitle={stepLabel}>
          <p className="text-sm text-muted-foreground">
            {mobileError ?? 'Читаем список осмотра…'}
          </p>
          <button
            type="button"
            onClick={() => void loadMobile()}
            className="min-h-12 w-full rounded-lg border border-border bg-card text-sm font-semibold text-foreground"
          >
            Обновить
          </button>
        </StepShell>
      );
    }
    return (
      <StepShell title={V2_STEP_TITLE[step]} subtitle={stepLabel}>
        <ChecklistScreen
          checklist={list}
          warnings={mobile.warnings}
          busy={busy}
          error={checklistError}
          commandId={checklistCommandId}
          lastMeter={mobile.assignment?.lastMeter ?? null}
          known={knownAnswers(catalogStage, mobile)}
          onSubmit={(answers) => void submitChecklist(catalogStage, answers)}
        />
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
          {tab === 'shift' && mobile && <OperatorWorkOverview state={mobile} variant="v2" busy={busy}
            onAction={(kind)=>{if(kind==='PILES')setPileOpen(true);else if(kind==='PASSPORT')setPassportOpen(true);else if(kind==='DRILLING')setDrillingOpen(true);else setDowntimeOpen(true);}}
            onIncident={()=>setTab('safety')} onDefect={()=>setDefectOpen(true)} onFinish={()=>setFinishing(true)} />}

          {tab === 'safety' && (
            mobile
              ? (
                <>
                  <SafetyTab state={mobile} onOpen={setSafetyStep} />
                  {/* Происшествие — про смену, а не про машину: ушибся человек,
                      посторонний в опасной зоне, разлили масло. Дефект чинит
                      механик, происшествие разбирают, и место ему здесь. */}
                  <IncidentsTab
                    state={mobile}
                    busy={busy}
                    error={mobileError}
                    commandId={incidentCommandId}
                    onReport={reportIncident}
                  />
                </>
              )
              : (
                <p className="text-sm text-muted-foreground">
                  {mobileError ?? 'Читаем ваш допуск…'}
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
          {/* Журнал — поимённо, как его отдаёт сервер, а не свёрнутый по
              маркам. Поправка к записи видна рядом с ней: гладкий журнал без
              следов правок непроверяем. */}
          {tab === 'more' && (
            entries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">За смену пока ничего не записано</p>
            ) : (
              <RowList>
                {entries.map((row) => (
                  <li key={row.id}>
                    <ValueRow
                      label={row.label}
                      value={row.kind === 'DOWNTIME'
                        ? formatDowntimeHours(row.value)
                        : `${row.value} ${row.kind === 'PILES' ? 'шт' : 'скв'}`
                          + (row.meters != null ? ` · ${formatNumber(row.meters)} м` : '')}
                      tone={row.kind === 'DOWNTIME' ? 'warn' : undefined}
                    />
                    {row.corrections.map((fix, index) => (
                      <p key={index} className="px-3 pb-1.5 text-xs text-muted-foreground">
                        поправка {fix.delta > 0 ? `+${fix.delta}` : fix.delta}: {fix.note}
                      </p>
                    ))}
                  </li>
                ))}
              </RowList>
            )
          )}

          {tab === 'more' && (
            <RowList>
              <li><ValueRow label="Смена" value={facts.shift?.type === 'NIGHT' ? 'Ночная' : 'Дневная'} /></li>
              <li><ValueRow label="Объект" value={mobile?.assignment?.siteName ?? '—'} /></li>
            </RowList>
          )}
        </StepShell>

        <PileSheet
          open={pileOpen}
          grades={grades}
          busy={busy}
          onClose={() => setPileOpen(false)}
          onAdd={(gradeId, count) => void (async () => {
            if (await logProduction({ kind: 'PILES', pileGradeId: gradeId, count })) {
              setPileOpen(false);
              toast.success(`Записано: ${count} шт`);
            }
          })()}
        />
        <DrillingSheet
          open={drillingOpen}
          types={drillingTypes}
          busy={busy}
          onClose={() => setDrillingOpen(false)}
          onAdd={(typeId, count, metersPerUnit) => void (async () => {
            if (await logProduction({ kind: 'DRILLING', typeId, count, metersPerUnit })) {
              setDrillingOpen(false);
              toast.success(`Записано: ${count} скв`);
            }
          })()}
        />
        {passportOpen && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background">
            <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-3 text-foreground">
              <button type="button" onClick={() => setPassportOpen(false)}
                className="-ml-1 flex h-11 w-11 items-center justify-center rounded-lg text-signal-strong hover:bg-secondary">
                ✕<span className="sr-only">Закрыть</span>
              </button>
              <p className="text-base font-semibold">Свая с паспортом</p>
            </header>
            <div className="flex-1 overflow-y-auto p-4">
              <PilePassportForm
                grades={grades}
                busy={busy}
                onSubmit={async (pileGradeId, passport) => {
                  const ok = await logProduction({ kind: 'PILE_PASSPORT', pileGradeId, passport });
                  if (ok) {
                    setPassportOpen(false);
                    toast.success('Свая записана с паспортом');
                  }
                  return ok;
                }}
              />
            </div>
          </div>
        )}
        <DowntimeSheet
          open={downtimeOpen}
          reasons={reasons}
          busy={busy}
          onClose={() => setDowntimeOpen(false)}
          onAdd={(reasonId, startedAt, endedAt, comment) => void (async () => {
            if (await logProduction({
              kind: 'DOWNTIME', reasonId, startedAt, endedAt, comment: comment || undefined,
            })) {
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
    /*
      Сдан ли отчёт, спрашиваем у сервера, а не у своего черновика: квитанция
      появляется ровно тогда, когда отчёт стал сданным, и разойтись с сервером
      она не может.
    */
    const submitted = mobile?.receipt != null;
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
                : void submitReport()}
              busy={busy}
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
            <li>
              <ValueRow label="Сваи выполнено"
                value={`${totalPiles} шт · ${formatNumber(production?.piles.meters ?? 0)} м.п.`} />
            </li>
            <li>
              <ValueRow label="Бурение"
                value={`${totalDrilling} скв · ${formatNumber(production?.drilling.meters ?? 0)} м`} />
            </li>
            <li>
              <ValueRow label="Простой" value={formatDowntimeHours(totalDowntime)}
                tone={totalDowntime > 0 ? 'warn' : undefined} />
            </li>
            <li>
              {/* Спрашиваем каталог, а не контур готовности: осмотр после
                  работы теперь чек-лист ЕО, и строка «не закрыт» по уже
                  сданному списку — это ложь на последнем экране смены. */}
              <ValueRow
                label="ЕО после работы"
                value={postDone ? 'сдан' : 'не сдан'}
                tone={postDone ? 'ok' : 'warn'}
              />
            </li>
            <li>
              <ValueRow
                label="Отчёт"
                value={mobile?.receipt?.reportId ?? 'черновик'}
                tone={submitted ? 'ok' : 'warn'}
              />
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
            setAccepted(false);
            setFinishing(false);
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
        <li>
          <ValueRow label="Сваи выполнено"
            value={`${totalPiles} шт · ${formatNumber(production?.piles.meters ?? 0)} м.п.`} />
        </li>
        <li>
          <ValueRow label="Бурение"
            value={`${totalDrilling} скв · ${formatNumber(production?.drilling.meters ?? 0)} м`} />
        </li>
        <li><ValueRow label="Простой" value={formatDowntimeHours(totalDowntime)} /></li>
        {facts.meterCurrent != null && (
          <li><ValueRow label="Моточасы" value={`${formatNumber(facts.meterCurrent)} м/ч`} /></li>
        )}
        {/* Номер отчёта — то, чем смена опознаётся в разговоре с диспетчером.
            Без него человек не знает, что именно ушло. */}
        {mobile?.receipt && (
          <li><ValueRow label="Отчёт" value={mobile.receipt.reportId} tone="ok" /></li>
        )}
      </RowList>
    </StepShell>
  );
}

