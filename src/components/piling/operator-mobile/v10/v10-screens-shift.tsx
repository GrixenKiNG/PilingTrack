import { DOC_LABEL, DOC_TONE, DASH, dateRu, STEPS, PHASE_STAGE, stepIndex, type Go } from "./v10-shared";
import {OperatorWorkOverview, type WorkAction} from '../operator-work-overview';
import { useState } from 'react';
import {useLocalFormDraft} from '../use-local-form-draft';
import {
  DOWNTIME_QUICK_HOURS, downtimeHoursProblem, formatDowntimeHoursOnly, parseDowntimeHours,
} from '@/lib/downtime-hours';
import type { OperatorMobileState } from '@/modules/operator-mobile';
import {ShiftThanks} from '../shift-thanks';
import type {ProductionEntryInput} from '../api';
import {PilePassportForm} from '../screens/pile-passport-form';
import {V10Entries, type CorrectionInput} from './v10-entries';
import {formatNumber} from '@/lib/format';
import { Banner, Card, Metric, Nodata, Pair, Row } from './v10-ui';

/**
 * Экран шага, до которого очередь ещё не дошла: вместо формы — что сделать
 * сначала и кнопка туда. Сервер такой шаг всё равно отверг бы.
 */
export function NotYet({state, go}: {state: OperatorMobileState; go: Go}) {
  const current = STEPS[stepIndex(state.phase)];
  return (
    <>
      <Banner tone="warn" title="Этот шаг ещё не открыт" />
      <Card>
        <Row icon="check" tone="orange" title="Сначала" note={current ? current.title : 'Смена закрыта'} />
      </Card>
      {current ? (
        <button type="button" className="ov10-btn" onClick={() => go('step')}>
          Перейти: {current.title}
        </button>
      ) : null}
    </>
  );
}

export function ScreenToday({state, go}: {state: OperatorMobileState; go: Go}) {
  /*
   * Допуск объявляет СЕРВЕР своей фазой, а не экран по документам.
   *
   * Документы — только часть допуска: до работы человек ещё подтверждает СИЗ,
   * читает инструкцию и проходит проверку знаний. Пока сервер держит фазу
   * IDENTITY, зелёное «Допуск получен» по одним корочкам — это обещание,
   * которого сервер не давал.
   */
  const passed = state.phase !== 'IDENTITY';
  const {identity} = state;
  const left = [
    identity.ppe.confirmed ? null : 'СИЗ',
    identity.briefing.ok ? null : 'инструктаж',
    identity.knowledge.ok ? null : 'проверка знаний',
  ].filter(Boolean);

  /* `expiresAt` объявлен как `Date`, но через JSON приходит строкой — сравнение
     по `instanceof Date` не находило ни одной даты, и срок всегда был «не
     указан». Разбираем оба вида. */
  const nearest = state.identity.documents
    .filter((doc) => doc.required && doc.expiresAt)
    .map((doc) => new Date(doc.expiresAt as unknown as string))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return (
    <>
      {/* Запрет показываем ПЕРВЫМ и отдельно от допуска.
          «Допуск получен» и «работа запрещена» — не одно и то же: корочки в
          порядке, а выработку писать нельзя. Пока этой карточки не было,
          человек узнавал о запрете только упёршись в отказ сервера на вводе. */}
      {!state.permit.allowed ? (
        <Card>
          <Row
            icon="shield"
            tone="bad"
            title="Работа запрещена"
            note={state.permit.blocks.map((block) => `${block.title}: ${block.detail}`).join(' · ')}
          />
          <Row
            icon="check"
            title="Что записывать можно"
            note="Простой, дефект, происшествие и отчёт — как обычно."
          />
        </Card>
      ) : null}
      <Card>
        <Row
          icon="shield"
          tone={passed ? 'ok' : 'warn'}
          title={passed ? 'Допуск получен' : 'Допуск не пройден'}
          note={passed
            ? (nearest ? `ближайший срок документа ${dateRu(nearest)}` : 'сроки документов не указаны')
            : `осталось: ${left.join(', ')}`}
          chevron
          onClick={() => go(passed ? 'docs' : 'safety')}
        />
      </Card>
      <Card>
        <Row icon="pin" tone="orange" title="Объект"
          note={state.assignment?.siteName ?? 'не назначен'} chevron onClick={() => go('accept')} />
        <Row icon="equip" title="Установка"
          note={state.assignment?.equipmentName ?? 'не закреплена'} chevron onClick={() => go('accept')} />
      </Card>
      <StepLadder state={state} go={go} />
    </>
  );
}

/**
 * Лестница смены: сделанное — галочкой, текущее — единственная активная
 * строка и большая кнопка «Дальше», будущее — закрыто до своей очереди.
 */
function StepLadder({state, go}: {state: OperatorMobileState; go: Go}) {
  const current = stepIndex(state.phase);
  const next = STEPS[current];
  return (
    <>
      {next ? (
        <button type="button" className="ov10-btn" onClick={() => go('step')}>
          Дальше: {next.title}
        </button>
      ) : <ShiftThanks operatorName={state.operator?.name} reportSent={Boolean(state.receipt?.submittedAt)} />}
      <Card title="Порядок смены">
        {STEPS.map((step, index) => {
          const done = index < current;
          const now = index === current;
          return (
            <Row
              key={step.phase}
              icon={done ? 'check' : now ? 'work' : 'list'}
              tone={done ? 'ok' : now ? 'orange' : ''}
              title={`${index + 1}. ${step.title}`}
              note={done ? 'выполнено' : now ? 'сейчас' : 'откроется после предыдущего шага'}
              chevron={now}
              onClick={now ? () => go('step') : undefined}
            />
          );
        })}
      </Card>
    </>
  );
}

export function ScreenDocs({state}: {state: OperatorMobileState}) {
  if (state.identity.documents.length === 0) {
    return <Card><Nodata>Документы не заведены</Nodata></Card>;
  }
  return (
    <Card>
      {state.identity.documents.map((doc) => (
        <Row
          key={doc.typeId}
          icon="doc"
          tone={DOC_TONE[doc.verdict]}
          title={doc.name}
          note={[
            doc.number ? `№ ${doc.number}` : 'номер не указан',
            doc.expiresAt ? `до ${dateRu(doc.expiresAt)}` : DOC_LABEL[doc.verdict],
          ].join(' · ')}
        />
      ))}
    </Card>
  );
}

export function ScreenAccept({state, busy, onAccept, go}: {
  state: OperatorMobileState; busy: boolean; onAccept: () => void; go: Go;
}) {
  const {assignment, weather} = state;
  const accepted = state.phase !== 'IDENTITY' && state.phase !== 'ADMISSION';
  return (
    <>
      <Card>
        <Row icon="pin" tone="orange" title="Объект" note={assignment?.siteName ?? 'не назначен'} />
        <Row icon="equip" title="Установка"
          note={assignment ? `${assignment.equipmentName} · ${assignment.equipmentModel}` : 'не закреплена'} />
        <Row icon="user" title="Помощники" note={assignment?.assistants.join(', ') || 'нет'} />
      </Card>
      <div className="ov10-metrics">
        <Metric
          label="Моточасы"
          value={assignment?.lastMeter ? formatNumber(assignment.lastMeter.engineHours, 0) : DASH}
          note={assignment?.lastMeter ? `на ${dateRu(assignment.lastMeter.recordedAt)}` : 'нет показаний'}
        />
        <Metric
          label="Топливо"
          value={assignment?.fuelPercent === null || assignment?.fuelPercent === undefined
            ? DASH
            : `${formatNumber(assignment.fuelPercent, 0)}%`}
          note="на конец прошлой смены"
        />
      </div>
      <Card title="Погода">
        {weather ? (
          <>
            <Pair label="Температура" value={weather.temperatureC === null ? DASH : `${formatNumber(weather.temperatureC, 0)} °C`} />
            <Pair label="Ветер" value={weather.windMs === null ? DASH : `${formatNumber(weather.windMs, 1)} м/с`} />
            <Pair label="Осадки" value={weather.precipitationMmPerHour === null ? DASH : `${formatNumber(weather.precipitationMmPerHour, 1)} мм/ч`} />
          </>
        ) : <Nodata>Погода недоступна — координаты не переданы</Nodata>}
      </Card>
      {accepted
        ? <Banner tone="info" title="Установка уже принята" />
        : !state.identity.ppe.confirmed
          // Сервер не откроет смену без отметки о проверке СИЗ (решение владельца
          // 14.10.2026): ведём на нужный шаг, а не на отказ.
          ? (
            <>
              <Banner tone="warn" title="Сначала проверьте средства защиты">
                Без этой отметки смену начать нельзя.
              </Banner>
              <button type="button" className="ov10-btn" onClick={() => go('ppe')}>
                Проверить средства защиты
              </button>
            </>
          )
          : (
            <button type="button" className="ov10-btn" disabled={busy} onClick={onAccept}>
              {busy ? 'Принимаем…' : 'Принять установку'}
            </button>
          )}
      <button type="button" className="ov10-btn ghost" onClick={() => go('today')}>К порядку смены</button>
    </>
  );
}

/** Допуск на расхождение часов телефона и сервера — тот же, что у сервера. */
/**
 * Запись выработки прямо здесь (решение владельца 18.09.2026).
 *
 * Раньше на этом месте стояла плашка «формы живут на Смене машиниста» — то
 * есть модуль предлагал машинисту уйти в ДРУГОЙ модуль, чтобы записать сваю.
 * Модуль, из которого нельзя записать выработку, рабочим местом не является.
 *
 * Поля те же, что и в рабочем экране /operator, и уходят той же командой
 * log-production: сервер один, и правила приёмки записи тоже одни.
 */
function ProductionForm({state, busy, onLog, initialKind = 'PILES'}: {
  initialKind?: WorkAction;
  state: OperatorMobileState;
  busy: boolean;
  /** true — сервер принял запись (или она легла в очередь); только тогда форма очищается. */
  onLog: (entry: ProductionEntryInput) => Promise<boolean>;
}) {
  const localDraft = useLocalFormDraft(state.operator?.id, state.shift?.id && `production:v10:${state.shift.id}`, {
    kind: initialKind, optionId: '', count: '', meters: '', hoursText: '',
  }, (value) => !value.optionId && !value.count && !value.meters && !value.hoursText);
  const [kind, setKind] = localDraft.field('kind');
  const [optionId, setOptionId] = localDraft.field('optionId');
  const [count, setCount] = localDraft.field('count');
  const [meters, setMeters] = localDraft.field('meters');
  const [hoursText, setHoursText] = localDraft.field('hoursText');

  const options = kind === 'PILES' || kind === 'PASSPORT' ? state.dictionaries.pileGrades
    : kind === 'DRILLING' ? state.dictionaries.drillingTypes
      : state.dictionaries.downtimeReasons;

  const switchKind = (next: typeof kind) => {
    setKind(next);
    setOptionId('');
    setCount('');
    setMeters('');
    setHoursText('');
  };

  const amount = Number(count.replace(',', '.'));
  const perUnit = Number(meters.replace(',', '.'));
  // Простой — только часы, без привязки ко времени работы в программе
  // (решение владельца 07.10.2026): подпись под полем и то, что уйдёт на
  // сервер, — одна и та же величина.
  const downtimeHours = kind === 'DOWNTIME' ? parseDowntimeHours(hoursText) : null;
  // Запрет закрывает выработку и не трогает простой — domain/production-permit.ts.
  const forbidden = kind !== 'DOWNTIME' && !state.permit.allowed;
  const ready = !forbidden && optionId !== '' && (
    kind === 'DOWNTIME'
      ? downtimeHours !== null
      : Number.isFinite(amount) && amount > 0
        && (kind !== 'DRILLING' || (Number.isFinite(perUnit) && perUnit > 0))
  );

  // Поля очищаются только по успеху: при отказе сервера («простой раньше
  // начала смены», «пересекается с записанным») введённое остаётся на экране
  // рядом с причиной отказа, а не исчезает молча (жалоба 28.09.2026:
  // «простой не записывается»).
  const submit = async () => {
    if (!ready) return;
    let accepted = false;
    if (kind === 'PILES') accepted = await onLog({kind: 'PILES', pileGradeId: optionId, count: Math.round(amount)});
    else if (kind === 'DRILLING') {
      accepted = await onLog({kind: 'DRILLING', typeId: optionId, count: Math.round(amount), metersPerUnit: perUnit});
    } else if (downtimeHours !== null) {
      accepted = await onLog({kind: 'DOWNTIME', reasonId: optionId, hours: downtimeHours});
    }
    if (!accepted) return;
    setOptionId('');
    setCount('');
    setMeters('');
    setHoursText('');
    localDraft.clear({...localDraft.value, optionId: '', count: '', meters: '', hoursText: ''});
  };

  return (
    <Card title="Записать выработку">
      <div className="ov10-chips on-work">
        <button type="button" className={kind === 'PILES' ? 'on' : ''}
          aria-pressed={kind === 'PILES'} onClick={() => switchKind('PILES')}>Добавить сваю</button>
        <button type="button" className={kind === 'PASSPORT' ? 'on' : ''}
          aria-pressed={kind === 'PASSPORT'} onClick={() => switchKind('PASSPORT')}>Записать паспорт сваи</button>
        <button type="button" className={kind === 'DRILLING' ? 'on' : ''}
          aria-pressed={kind === 'DRILLING'} onClick={() => switchKind('DRILLING')}>Добавить бурение</button>
        <button type="button" className={kind === 'DOWNTIME' ? 'on' : ''}
          aria-pressed={kind === 'DOWNTIME'} onClick={() => switchKind('DOWNTIME')}>Записать простой</button>
      </div>

      {/* Паспорт — журнал забивки на одну сваю по СП 45.13330: номер, залоги,
          отказ, отметки головы. Форма общая со всеми модулями: требование к
          ней нормативное, и расходиться ей нельзя. */}
      {kind === 'PASSPORT' ? (
        <PilePassportForm
          draftUserId={state.operator?.id}
          draftShiftId={state.shift?.id}
          grades={state.dictionaries.pileGrades}
          busy={busy}
          onSubmit={(pileGradeId, passport) => onLog({kind: 'PILE_PASSPORT', pileGradeId, passport})}
        />
      ) : (
      <>
      <label className="ov10-field">
        <span className="lab">
          {kind === 'PILES' ? 'Марка сваи' : kind === 'DRILLING' ? 'Тип бурения' : 'Причина простоя'}
        </span>
        <select value={optionId} onChange={(event) => setOptionId(event.target.value)}>
          <option value="">Выберите…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </label>

      {forbidden ? (
        <p className="ov10-hint">
          Работа запрещена: {state.permit.blocks.map((block) => block.title).join('; ')}.
          Простой записывается как обычно.
        </p>
      ) : null}

      {kind === 'DOWNTIME' ? (
        <>
          <label className="ov10-field">
            <span className="lab">Простой, часов</span>
            <input type="number" inputMode="decimal" step="0.25" min="0.25" max="24"
              placeholder="Например: 1,5" value={hoursText}
              onChange={(event) => setHoursText(event.target.value)} />
          </label>
          {/* Только часы: быстрый выбор тоже в часах. */}
          <div className="ov10-chips">
            {DOWNTIME_QUICK_HOURS.map((hours) => (
              <button key={hours} type="button"
                onClick={() => setHoursText(String(hours))}>{formatDowntimeHoursOnly(hours)}</button>
            ))}
          </div>
          {downtimeHoursProblem(hoursText) ? <p className="ov10-hint">{downtimeHoursProblem(hoursText)}</p> : null}
          {downtimeHours !== null ? (
            <p className="ov10-hint">Простой: {formatDowntimeHoursOnly(downtimeHours)}</p>
          ) : null}
        </>
      ) : (
        <label className="ov10-field">
          <span className="lab">Количество, шт</span>
          <input inputMode="decimal" value={count}
            onChange={(event) => setCount(event.target.value)} />
        </label>
      )}

      {kind === 'DRILLING' ? (
        <label className="ov10-field">
          <span className="lab">Метров на скважину</span>
          <input inputMode="decimal" value={meters}
            onChange={(event) => setMeters(event.target.value)} />
        </label>
      ) : null}

      <button type="button" className="ov10-btn" style={{marginTop: 12}}
        disabled={busy || !ready} onClick={() => void submit()}>
        {busy ? 'Записываем…' : 'Записать'}
      </button>
      </>
      )}
    </Card>
  );
}

export function ScreenWork({state, busy, onLog, onCorrect, go}: {
  state: OperatorMobileState;
  busy: boolean;
  onLog: (entry: ProductionEntryInput) => Promise<boolean>;
  onCorrect: (input: CorrectionInput) => Promise<boolean>;
  go: Go;
}) {
  const [entry, setEntry] = useState<WorkAction | null>(null);
  // До своей очереди работа не открывается: сервер отверг бы любую запись.
  if (stepIndex(state.phase) < stepIndex('WORK')) return <NotYet state={state} go={go} />;
  // После «Завершить работу» выработка и простой принимаются до сдачи смены
  // (решение владельца 07.10.2026: оператор вносит выполненное и после работы).
  if (state.phase !== 'WORK') {
    return (
      <>
        <ProductionForm state={state} busy={busy} onLog={onLog} />
        <V10Entries entries={state.entries} busy={busy} onCorrect={onCorrect} />
        <button type="button" className="ov10-btn ghost" onClick={() => go(state.shift && state.shift.productionDate < state.productionDate ? 'closing' : 'step')}>{state.shift && state.shift.productionDate < state.productionDate ? 'К сдаче смены' : 'К ЕО после работы и закрытию'}</button>
      </>
    );
  }
  if (entry) return <><button type="button" className="oc-form-back" onClick={()=>setEntry(null)}>← К смене</button><ProductionForm key={entry} state={state} busy={busy} onLog={onLog} initialKind={entry} /></>;
  return (
    <>
      <OperatorWorkOverview state={state} variant="v10" busy={busy} onAction={setEntry}
        onIncident={()=>go('incidents')} onFinish={()=>go('closing')} />
      <V10Entries entries={state.entries} busy={busy} onCorrect={onCorrect} />
    </>
  );
}

/**
 * Техника: чек-листы смены и открытые неисправности.
 *
 * ЕО проходят здесь же (решение владельца 18.09.2026), но ПО ОЧЕРЕДИ (жалоба
 * 28.09.2026 «вразброс»): раньше экран раскладывал сразу все четыре списка,
 * и человек отвечал на ЕО после работы, не пройдя осмотр, — сервер отказывал.
 * Теперь сданное отмечено, текущий список открывается кнопкой, будущие закрыты.
 */
export function ScreenMaint({state, go}: {state: OperatorMobileState; go: Go}) {
  const currentStage = PHASE_STAGE[state.phase];
  const lists = state.checklists.filter((list) => list.stage !== 'TB_PILING'
    && list.stage !== 'TB_DRILLING');
  return (
    <>
      <Card title="Чек-листы смены">
        {lists.length === 0
          ? <Nodata>Чек-листы станут доступны после приёма установки</Nodata>
          : lists.map((list) => {
            const items = list.sections.flatMap((section) => section.items).length;
            if (list.done) {
              return <Row key={list.stage} icon="wrench" tone="ok" title={list.title} note={`сдано · ${items} пунктов`} />;
            }
            if (list.stage === currentStage) {
              return (
                <Row key={list.stage} icon="wrench" tone="orange" title={list.title}
                  note="сейчас — нажмите, чтобы пройти" chevron onClick={() => go('step')} />
              );
            }
            return <Row key={list.stage} icon="list" tone="" title={list.title} note="откроется в свою очередь" />;
          })}
      </Card>
      <Card title="Открытые неисправности">
        {state.defects.length === 0
          ? <Nodata>Открытых неисправностей нет</Nodata>
          : state.defects.map((defect) => (
            <Row key={defect.id} icon="warning" tone="warn" title={defect.title}
              note={`${defect.reportedByMe ? 'записали вы' : defect.reportedByName} · ${dateRu(defect.reportedAt)}`} />
          ))}
      </Card>
      <button type="button" className="ov10-btn ghost" onClick={() => go('today')}>К порядку смены</button>
    </>
  );
}
