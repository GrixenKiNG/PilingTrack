'use client';

import {OperatorWorkOverview} from '../operator-work-overview';
import {useState, type ReactNode} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import type {ProductionEntryInput} from '../api';
import {
  DOWNTIME_QUICK_HOURS, downtimeHoursProblem, formatDowntimeHoursOnly, parseDowntimeHours,
} from '@/lib/downtime-hours';
import {BigButton, ErrorNote, Fact, Panel, PanelTitle, Screen, VolumeFact} from '../ui';
import {PermitPanel, WarningsPanel} from '../warnings-panel';
import {EntriesList} from './entries-list';
import {PilePassportForm} from './pile-passport-form';

type Tab = 'PILES' | 'DRILLING' | 'DOWNTIME';

const TABS: {value: Tab; label: string}[] = [
  {value: 'PILES', label: 'Сваи'},
  {value: 'DRILLING', label: 'Бурение'},
  {value: 'DOWNTIME', label: 'Простой'},
];

/**
 * Рабочий экран: учёт выработки по ходу смены.
 *
 * ПОЧЕМУ ЗАПИСЬ ПО ХОДУ, А НЕ ОТЧЁТ В КОНЦЕ. Отчёт, заполняемый в 19:00 по
 * памяти, — это оценка. Свая, отмеченная сразу, помнит время; простой,
 * отмеченный сразу, помнит причину.
 *
 * ПОЧЕМУ БУРЕНИЕ ВВОДИТСЯ КАК В ОТЧЁТЕ. Количество скважин и метры на одну,
 * объём считается умножением. Так это устроено в отчёте за смену; вводить одни
 * и те же данные двумя способами — это два разных числа в аналитике.
 */
/**
 * Насколько свежа погода. Сервис отдаёт время измерения, а не время
 * запроса, и разница до пятнадцати минут — обычное дело из-за кэша.
 */
function weatherAge(at: string): string {
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return 'по метеосервису';
  if (minutes < 2) return 'сейчас';
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.round(minutes / 60)} ч назад`;
}

export function WorkScreen({state, onLog, onFinish, onOpenSafety, busy, error, errorDetails, tabs, onCorrect}: {
  state: OperatorMobileState;
  /** Возвращает признак удачи: по нему экран решает, чистить ли форму. */
  onLog: (entry: ProductionEntryInput) => Promise<boolean>;
  onFinish: () => void;
  onOpenSafety: (stage: 'TB_PILING' | 'TB_DRILLING') => void;
  busy: boolean;
  error: string | null;
  /** Подробности отказа: какие поля не заполнены (аудит R76, находка 10). */
  errorDetails?: string[];
  /** Нижние вкладки. Рисует оболочка — экран лишь отдаёт их в Screen. */
  tabs?: ReactNode;
  /** Поправка к ошибочной записи. Возвращает признак удачи. */
  onCorrect: (input: {
    entryId: string; kind: 'PILES' | 'DRILLING' | 'DOWNTIME'; actual: number; reason: string;
  }) => Promise<boolean>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('PILES');
  /**
   * Как записывают сваи.
   *
   * Паспорт стоит первым и включён по умолчанию: он и есть исполнительный
   * документ, а пачка — способ добрать задним числом то, что записать сразу не
   * вышло. Порядок кнопок здесь и есть указание, как правильно.
   */
  const [pileMode, setPileMode] = useState<'PASSPORT' | 'BATCH'>('PASSPORT');
  const [reference, setReference] = useState('');
  const [count, setCount] = useState('');
  const [metersPerUnit, setMetersPerUnit] = useState('');
  const [hoursText, setHoursText] = useState('');
  const [comment, setComment] = useState('');
  // Завершение работы обратного хода не имеет: смена уходит в сдачу, и
  // записать сваю после этого уже нельзя. Кнопка стоит вплотную к «Записать»,
  // и промах по ней в перчатке заканчивал смену досрочно. Второе нажатие
  // здесь — не бюрократия, а единственная защита от промаха.
  const [finishing, setFinishing] = useState(false);

  // Смена вкладки очищает форму: марка сваи не имеет смысла в простое, а «5»
  // из поля свай, оставшееся в поле часов, — это ошибочный отчёт. Сброс живёт
  // в обработчике, а не в эффекте: эффект дал бы лишний цикл отрисовки.
  //
  // НЕРАЗОБРАННЫЙ ОТКАЗ — ЧЕРНОВИК НЕ ТРОГАЕМ (аудит R82, находки 3 и 8).
  // Повторный вход в ту же форму из обзора смены идёт через этот же
  // обработчик, и безусловная чистка стирала введённое: машинисту, получившему
  // отказ («Паспорт заполнен не полностью», «Смена уже закрыта»), приходилось
  // набирать 5–10 минут заново по памяти, а копии на устройстве уже нет —
  // запись снял тот же отказ. Отказ считается разобранным, когда родитель его
  // снял, то есть `error` пуст; новый ключ команды родитель выдаёт только
  // после успеха, и тогда поля чистит сам `submit`. Смена на ДРУГУЮ вкладку
  // чистит по-прежнему: «5» из поля свай в поле часов — это ошибочный отчёт.
  //
  // ПОКА ЗАПРОС В ПОЛЁТЕ, ВКЛАДКУ НЕ МЕНЯЕМ (аудит R82, находка 13). Смена
  // вкладки чистит поля, и нажатие «Записать» → «Бурение» стирало введённое
  // число раньше, чем машинист увидел отказ. Кнопки при `busy` заблокированы,
  // а этот ранний выход закрывает тот же путь для программного вызова.
  const switchTab = (next: Tab) => {
    if (busy) return;
    setTab(next);
    if (error && next === tab) return;
    setReference('');
    setCount('');
    setMetersPerUnit('');
    setHoursText('');
    setComment('');
  };

  const safetyOf = (stage: 'TB_PILING' | 'TB_DRILLING') =>
    state.checklists.find((checklist) => checklist.stage === stage) ?? null;
  const safetyDone = (stage: 'TB_PILING' | 'TB_DRILLING') => safetyOf(stage)?.done ?? false;

  // Паспорт заполняется своей формой: у неё своя кнопка и свои поля.
  const passportMode = tab === 'PILES' && pileMode === 'PASSPORT';

  const activeStage: 'TB_PILING' | 'TB_DRILLING' = tab === 'DRILLING' ? 'TB_DRILLING' : 'TB_PILING';
  const needsSafety = (tab === 'PILES' || tab === 'DRILLING') && !safetyDone(activeStage);
  // Срок подходит — предупреждаем, но работать не мешаем: запрет посреди
  // рабочего дня стоит дороже, чем напоминание за неделю.
  const safetySoon = safetyOf(activeStage)?.period?.warn ?? false;
  const safetyDaysLeft = safetyOf(activeStage)?.period?.daysLeft ?? null;

  const options = tab === 'PILES'
    ? state.dictionaries.pileGrades
    : tab === 'DRILLING'
      ? state.dictionaries.drillingTypes
      : state.dictionaries.downtimeReasons;

  // Простой — только часы (решение владельца 07.10.2026): без начала и конца и
  // без привязки ко времени работы в программе. Подпись под полем обязана
  // отвечать тому, что уйдёт на сервер.
  const downtimeHours = tab === 'DOWNTIME' ? parseDowntimeHours(hoursText) : null;

  const grade = state.dictionaries.pileGrades.find((item) => item.id === reference);
  const pileMeters = grade?.lengthMm ? (Number(count || 0) * grade.lengthMm) / 1000 : 0;
  const drillVolume = Number(count || 0) * Number(metersPerUnit || 0);

  /*
    Запрет закрывает ВЫРАБОТКУ и не трогает простой.

    Экран прячет кнопку, сервер отвечает отказом — и это разные защиты, а не
    дублирование: без серверной запрет обходится прямым запросом, без экранной
    человек упирается в отказ уже после того, как всё набрал.
  */
  const forbidden = tab !== 'DOWNTIME' && !state.permit.allowed;

  const ready = !forbidden && Boolean(reference) && (
    tab === 'PILES' ? Number(count) > 0
      : tab === 'DRILLING' ? Number(count) > 0 && Number(metersPerUnit) > 0
        : downtimeHours !== null
  );

  // Форма очищается только после того, как сервер подтвердил запись. Раньше
  // она очищалась сразу: обрыв связи стирал введённое вместе с надеждой
  // вспомнить, сколько там было свай. Марка сваи и причина простоя остаются
  // и после удачи — подряд пишут обычно одно и то же.
  const submit = async () => {
    const entry: ProductionEntryInput = tab === 'PILES'
      ? {kind: 'PILES', pileGradeId: reference, count: Number(count), comment: comment || undefined}
      : tab === 'DRILLING'
        ? {kind: 'DRILLING', typeId: reference, count: Number(count), metersPerUnit: Number(metersPerUnit)}
        : {
          kind: 'DOWNTIME', reasonId: reference,
          hours: downtimeHours ?? 0,
          comment: comment || undefined,
        };

    const recorded = await onLog(entry);
    if (!recorded) return;

    setCount('');
    setMetersPerUnit('');
    setHoursText('');
    setComment('');
  };

  const overviewScreen = (
    <Screen title="Моя смена" tabs={tabs}>
      {/*
        Строка отказа — вверху обзора и только у ВИДИМОЙ ветки. Обе ветки
        смонтированы (см. комментарий над `return`), и без этого условия один
        и тот же текст лежал бы в разметке дважды (аудит F-V1-ERROR-DETAILS-b).
      */}
      {formOpen ? null : <ErrorNote message={error} details={errorDetails} />}
      <WarningsPanel warnings={state.warnings} />
      <OperatorWorkOverview state={state} variant="base" busy={busy}
        onAction={(kind)=>{switchTab(kind==='PASSPORT'?'PILES':kind);setPileMode(kind==='PASSPORT'?'PASSPORT':'BATCH');setFormOpen(true);}}
        onFinish={()=>setFinishing(true)} />
      {finishing&&<Panel tone="warning"><PanelTitle>Завершить работу?</PanelTitle><p className="my-3 text-sm">Дальше — ЕО после работы. Новую выработку записывать будет нельзя.</p><BigButton tone="danger" disabled={busy} onClick={onFinish}>Да, работа завершена</BigButton><BigButton tone="ghost" onClick={()=>setFinishing(false)}>Продолжить работу</BigButton></Panel>}
    </Screen>
  );

  const workScreen = (
    <Screen
      tabs={tabs}
      title="Работа"
      subtitle={[
        state.assignment?.equipmentName,
        state.assignment?.siteName,
        state.shift ? `смена за ${new Date(state.shift.productionDate).toLocaleDateString('ru-RU')}` : null,
      ].filter(Boolean).join(' · ')}
      footer={(
        <>
          {/*
            Погода остаётся красным предупреждением, но не гасит учёт:
            установка не передаёт телеметрию, поэтому решение принимает
            ответственный на площадке. Чек-лист ТБ по виду работ остаётся
            обязательным действием, которое оператор выполняет прямо здесь.
          */}
          {!passportMode ? (
            <>
              {/*
                Отказ — в липком футере, вплотную над кнопкой: пока он стоял
                последним в `main`, то есть ниже списка записей, чем длиннее
                смена, тем дальше уезжала причина от кнопки (аудит R82,
                находки 6 и 7). Строка показывается только у видимой ветки,
                чтобы не дублировать обзор смены.
              */}
              {formOpen ? <ErrorNote message={error} details={errorDetails} /> : null}
              <BigButton
                onClick={() => void submit()}
                disabled={!ready || busy || needsSafety}
              >
                {busy ? 'Записываем…' : 'Записать'}
              </BigButton>
            </>
          ) : null}
          {finishing ? (
            <div className="space-y-2 rounded-lg border border-warning bg-warning/10 p-3">
              <p className="text-sm font-semibold">
                Завершить работу? Записывать выработку после этого нельзя.
              </p>
              <p className="text-2xs text-muted-foreground">
                За смену: {state.production.piles.count} свай, {state.production.drilling.count} скважин,
                {' '}простой {formatDowntimeHoursOnly(state.production.downtimeHours)}. Дальше — ЕО после работы.
              </p>
              <BigButton tone="danger" onClick={onFinish} disabled={busy}>
                Да, работа завершена
              </BigButton>
              <BigButton tone="ghost" onClick={() => setFinishing(false)}>Продолжить работу</BigButton>
            </div>
          ) : (
            <BigButton tone="ghost" onClick={() => setFinishing(true)}>Работа завершена</BigButton>
          )}
        </>
      )}
    >
      <button type="button" className="oc-form-back" onClick={()=>setFormOpen(false)}>← К смене</button>
      <PermitPanel permit={state.permit} />
      <WarningsPanel warnings={state.warnings} />

      <Panel>
        <PanelTitle>Учёт выполненных работ</PanelTitle>
        <div className="mt-2">
          <VolumeFact
            label="Свай за смену"
            count={state.production.piles.count}
            meters={state.production.piles.meters}
          />
          <VolumeFact
            label="Бурение"
            count={state.production.drilling.count}
            meters={state.production.drilling.meters}
          />
          {/* Без .toFixed(1): часы целые, и «0,0 ч» подсказывало бы, что
              бывает 0,3. Ранее записанные дробные показываем как есть. */}
          <Fact label="Простой" value={formatDowntimeHoursOnly(state.production.downtimeHours)} />
          {/*
            Ветер показываем вместе с тем, когда его измерили: работа
            прекращается при 15 м/с, и цифра без времени не даёт понять,
            это сейчас или полчаса назад. Сервис погоды держит ответ в кэше
            до пятнадцати минут, так что разница бывает существенной.
          */}
          {state.weather && state.weather.windMs !== null ? (
            <Fact
              label="Ветер"
              value={state.weather.windMs}
              unit={`м/с · ${weatherAge(state.weather.at)}`}
            />
          ) : (
            <Fact label="Ветер" value="нет данных" />
          )}
        </div>
      </Panel>

      <div className="flex gap-1.5 rounded-lg bg-secondary p-1">
        {TABS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => switchTab(option.value)}
            disabled={busy}
            className={cn(
              'min-h-11 flex-1 rounded-md text-sm font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              tab === option.value ? 'border bg-card font-semibold shadow-xs' : 'text-muted-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!needsSafety && safetySoon ? (
        <button
          type="button"
          onClick={() => onOpenSafety(activeStage)}
          className="w-full rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-left text-2xs font-semibold text-warning-strong"
        >
          {tab === 'PILES' ? 'ТБ по забивке' : 'ТБ по бурению'}: срок через{' '}
          {safetyDaysLeft ?? 0} дн. — можно пройти заранее
        </button>
      ) : null}

      {needsSafety ? (
        <Panel tone="warning">
          <PanelTitle tone="warning">Подошёл срок чек-листа ТБ</PanelTitle>
          <p className="mt-1 text-sm">
            {tab === 'PILES'
              ? 'Инструктаж по забивке проходят по графику. Срок вышел — пройдите заново.'
              : 'Инструктаж по бурению проходят по графику. Срок вышел — пройдите заново.'}
          </p>
          <div className="mt-3">
            <BigButton onClick={() => onOpenSafety(activeStage)}>
              Пройти чек-лист
            </BigButton>
          </div>
        </Panel>
      ) : passportMode ? (
        <div className="space-y-3">
          <PileModeSwitch mode={pileMode} onChange={setPileMode} />
          <PilePassportForm
            grades={state.dictionaries.pileGrades}
            busy={busy}
            error={formOpen ? error : null}
            errorDetails={formOpen ? errorDetails : undefined}
            onSubmit={(pileGradeId, passport) => onLog({kind: 'PILE_PASSPORT', pileGradeId, passport})}
          />
          {/*
            Список записанного стоит ОДИН раз — ниже, общим для всех режимов.
            Здесь он дублировался: в режиме паспорта машинист видел свои две
            сваи и поправку к ним дважды и не мог понять, записалось ли вдвое
            больше. Строку отказа форма паспорта теперь рисует сама — над своей
            кнопкой (аудит R82, находки 6 и 7).
          */}
        </div>
      ) : (
        <div className="space-y-3">
          {tab === 'PILES' ? <PileModeSwitch mode={pileMode} onChange={setPileMode} /> : null}
          <label className="block">
            <span className="text-2xs font-medium text-muted-foreground">
              {tab === 'PILES' ? 'Марка сваи' : tab === 'DRILLING' ? 'Тип бурения' : 'Причина простоя'}
            </span>
            <select
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-base shadow-xs"
            >
              <option value="">Выберите…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>

          {tab !== 'DOWNTIME' ? (
            <NumberField
              label={tab === 'PILES' ? 'Свай, шт' : 'Скважин, шт'}
              value={count}
              onChange={setCount}
            />
          ) : null}

          {tab === 'DRILLING' ? (
            <NumberField label="Метров на одну скважину" value={metersPerUnit} onChange={setMetersPerUnit} decimal />
          ) : null}

          {tab === 'DOWNTIME' ? (
            <div className="space-y-2">
              <label className="block">
                <span className="text-2xs font-medium text-muted-foreground">Простой, часов</span>
                <input
                  type="number" inputMode="decimal" step="0.25" min="0.25" max="24"
                  placeholder="Например: 1,5"
                  value={hoursText}
                  onChange={(event) => setHoursText(event.target.value)}
                  className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
                />
              </label>
              {/* Только часы: быстрый выбор тоже в часах. */}
              <div className="grid grid-cols-4 gap-2">
                {DOWNTIME_QUICK_HOURS.map((hours) => (
                  <button
                    key={hours} type="button"
                    onClick={() => setHoursText(String(hours))}
                    className="h-12 rounded-md border bg-card text-base font-semibold"
                  >
                    {formatDowntimeHoursOnly(hours)}
                  </button>
                ))}
              </div>
              {downtimeHours !== null ? (
                <p className="rounded-md bg-info/10 px-3 py-2 text-sm font-medium text-info-strong">
                  Простой: {formatDowntimeHoursOnly(downtimeHours)}
                </p>
              ) : null}
              {downtimeHoursProblem(hoursText) ? (
                <p className="text-sm font-medium text-destructive">{downtimeHoursProblem(hoursText)}</p>
              ) : null}
            </div>
          ) : null}

          {tab === 'PILES' && grade?.lengthMm && Number(count) > 0 ? (
            <p className="rounded-md bg-info/10 px-3 py-2 text-sm font-medium text-info-strong">
              Автоподсчёт: {count} шт × {grade.lengthMm / 1000} м = {pileMeters.toFixed(1)} м.п.
            </p>
          ) : null}
          {tab === 'DRILLING' && (count || metersPerUnit) ? (
            <p className="rounded-md bg-info/10 px-3 py-2 text-sm font-medium text-info-strong">
              Автоподсчёт: {count || 0} шт × {metersPerUnit || 0} м = {drillVolume.toFixed(1)} м.п.
            </p>
          ) : null}

          {tab !== 'DRILLING' ? (
            <label className="block">
              <span className="text-2xs font-medium text-muted-foreground">Комментарий</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border bg-card p-3 text-sm shadow-xs"
              />
            </label>
          ) : null}
        </div>
      )}

      <EntriesList entries={state.entries} busy={busy} onCorrect={onCorrect} />
    </Screen>
  );

  /*
    ОБЕ ВЕТКИ ОСТАЮТСЯ В ДЕРЕВЕ (аудит R82, находка 8).

    Раньше обзор смены возвращался отдельно (`if (!formOpen) return …`), и по
    «← К смене» дерево подменялось целиком: `PilePassportForm` размонтировался
    вместе со всеми пятнадцатью полями черновика. Паспорт заполняют 5–10 минут
    в перчатке, и одного нажатия (или промаха) хватало, чтобы потерять его —
    при том что копии на устройстве нет: запись снял отказ.

    Теперь смонтированы обе ветки, а лишняя выключена атрибутом `hidden`: она
    не видна и не читается экранным диктором, но состояние формы под ней цело.
    Обёртка — обычный `div` без классов: утилита Tailwind (`flex` у `Screen`)
    перебила бы `[hidden]` из preflight своим `display`, поэтому гасим уровнем
    выше самой `Screen`.
  */
  return (
    <>
      <div hidden={formOpen}>{overviewScreen}</div>
      <div hidden={!formOpen}>{workScreen}</div>
    </>
  );
}

/**
 * Паспорт или пачка.
 *
 * Пачка не спрятана: бывает, что сваю забили, а замеры взять не успели, и
 * запретить записать её вовсе значит получить смену, которой нет в отчёте.
 */
function PileModeSwitch({mode, onChange}: {
  mode: 'PASSPORT' | 'BATCH';
  onChange: (mode: 'PASSPORT' | 'BATCH') => void;
}) {
  return (
    <div className="flex gap-1.5 rounded-lg bg-secondary p-1">
      {([
        {value: 'PASSPORT' as const, label: 'Паспорт сваи'},
        {value: 'BATCH' as const, label: 'Пачкой'},
      ]).map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-11 flex-1 rounded-md text-sm font-medium transition-colors',
            mode === option.value ? 'border bg-card font-semibold shadow-xs' : 'text-muted-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({label, value, onChange, decimal}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimal?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-2xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode={decimal ? 'decimal' : 'numeric'}
        step={decimal ? '0.1' : '1'}
        min={decimal ? '0.1' : '1'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
      />
    </label>
  );
}
