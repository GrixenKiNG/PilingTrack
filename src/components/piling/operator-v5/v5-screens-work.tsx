import { dateRu, Rowline } from "./v5-shared";
import { useState } from 'react';
import {useLocalFormDraft} from '../operator-mobile/use-local-form-draft';
import {OperatorWorkOverview} from '../operator-mobile/operator-work-overview';
import type {CorrectionInput} from '../operator-mobile/screens/entries-list';
import {
  DOWNTIME_QUICK_HOURS, downtimeHoursProblem, formatDowntimeHoursOnly, parseDowntimeHours,
} from '@/lib/downtime-hours';
import type { ChecklistStage, OperatorMobileState } from '@/modules/operator-mobile';
import {PilePassportForm} from '../operator-mobile/screens/pile-passport-form';
import {formatNumber} from '@/lib/format';
import {ShiftThanks} from '../operator-mobile/shift-thanks';
import { type ProductionEntryInput } from '../operator-mobile/api';

/** F. Работа: плитки выработки и запись — экраны F1–F5 макета. */
export function WorkScreen({state, busy, onLog, onFinish, onOpenSafety, onIncident, afterFinish = false, onCorrect, correctionError}: {
  state: OperatorMobileState;
  busy: boolean;
  /** Признак успеха: по нему форма решает, чистить ли поля. */
  onLog: (entry: ProductionEntryInput) => Promise<boolean>;
  onFinish: () => void;
  onIncident: () => void;
  /** Открыть периодический чек-лист ТБ — срок вышел либо подходит. */
  onOpenSafety: (stage: ChecklistStage) => void;
  /** Работа завершена, смена ждёт сдачи: выработку и простой дописывают, «Завершить работу» нет. */
  afterFinish?: boolean;
  onCorrect?: (input: CorrectionInput) => Promise<boolean>;
  correctionError?: string | null;
}) {
  const localDraft = useLocalFormDraft(state.operator?.id, state.shift?.id && `production:v5:${state.shift.id}`, {
    kind: 'PILES' as 'PILES' | 'DRILLING' | 'DOWNTIME' | 'PASSPORT', optionId: '', count: '', meters: '', hoursText: '',
  }, (value) => !value.optionId && !value.count && !value.meters && !value.hoursText);
  const [formOpen, setFormOpen] = useState(localDraft.restored);
  const [kind, setKind] = localDraft.field('kind');
  const [optionId, setOptionId] = localDraft.field('optionId');
  const [count, setCount] = localDraft.field('count');
  const [meters, setMeters] = localDraft.field('meters');
  const [hoursText, setHoursText] = localDraft.field('hoursText');

  const options = kind === 'PILES' || kind === 'PASSPORT' ? state.dictionaries.pileGrades
    : kind === 'DRILLING' ? state.dictionaries.drillingTypes
      : state.dictionaries.downtimeReasons;

  /*
    Чек-листы ТБ периодические: их проходят по сроку инструкции, а не каждую
    смену. Показываем их здесь, на рабочем экране, потому что именно тут
    человек упирается в отказ сервера «подошёл срок чек-листа ТБ» — а пройти
    его в модуле раньше было негде вовсе.
  */
  const safety = state.checklists.filter((list) => list.period !== null);

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

  const pick = (next: typeof kind) => {
    setKind(next);
    setOptionId('');
    setCount('');
    setMeters('');
    setHoursText('');
  };

  // Форма чистится только после подтверждения сервером: отказ 400/409 не
  // должен уничтожать уже набранное число.
  const submit = async () => {
    if (!ready) return;
    let saved = false;
    if (kind === 'PILES') {
      saved = await onLog({kind: 'PILES', pileGradeId: optionId, count: Math.round(amount)});
    } else if (kind === 'DRILLING') {
      saved = await onLog({kind: 'DRILLING', typeId: optionId, count: Math.round(amount), metersPerUnit: perUnit});
    } else if (downtimeHours !== null) {
      saved = await onLog({kind: 'DOWNTIME', reasonId: optionId, hours: downtimeHours});
    }
    if (!saved) return;

    setOptionId('');
    setCount('');
    setMeters('');
    setHoursText('');
    localDraft.clear({...localDraft.value, optionId: '', count: '', meters: '', hoursText: ''});
  };

  if (!formOpen) return <div className="scr"><OperatorWorkOverview state={state} variant="v5" busy={busy}
    onCorrect={onCorrect} correctionError={correctionError}
    onAction={(next)=>{pick(next);setFormOpen(true);}} onFinish={onFinish} hideFinish={afterFinish} onIncident={onIncident}>
    {safety.filter(c=>c.period?.due||c.period?.warn).map(c=><button key={c.stage} type="button" className="oc-form-back" onClick={()=>onOpenSafety(c.stage)}>{c.title} · пройти проверку</button>)}
  </OperatorWorkOverview></div>;

  return (
    <div className="scr">
      <button type="button" className="oc-form-back" onClick={()=>setFormOpen(false)}>← К смене</button>
      <div className="tiles">
        <div className="tile">
          <span className="k">Сваи</span>
          <span className="v">{formatNumber(state.production.piles.count, 0)}</span>
          <span className="m">{formatNumber(state.production.piles.meters, 0)} м.п.</span>
        </div>
        <div className="tile">
          <span className="k">Бурение</span>
          <span className="v">{formatNumber(state.production.drilling.count, 0)}</span>
          <span className="m">{formatNumber(state.production.drilling.meters, 0)} м.п.</span>
        </div>
        <div className="tile">
          <span className="k">Простой</span>
          <span className="v">{formatDowntimeHoursOnly(state.production.downtimeHours)}</span>
        </div>
      </div>

      {safety.map((list) => (
        <Rowline
          key={list.stage}
          label={list.title}
          note={list.period?.due
            ? 'срок подошёл — пройдите, иначе запись не примут'
            : list.period?.warn
              ? `срок через ${list.period.daysLeft} дн. — можно пройти заранее`
              : `действует до ${dateRu(list.period?.validUntil)}`}
          badge={list.period?.due ? 'пройти' : list.period?.warn ? 'скоро' : 'в норме'}
          tone={list.period?.due ? 'bad' : list.period?.warn ? 'warn' : 'good'}
          onClick={list.period?.due || list.period?.warn
            ? () => onOpenSafety(list.stage)
            : undefined}
        />
      ))}

      <div className="seg">
        <button type="button" className={kind === 'PILES' ? 'on' : ''} onClick={() => pick('PILES')}>
          Свая
        </button>
        <button type="button" className={kind === 'PASSPORT' ? 'on' : ''} onClick={() => pick('PASSPORT')}>
          Паспорт
        </button>
        <button type="button" className={kind === 'DRILLING' ? 'on' : ''} onClick={() => pick('DRILLING')}>
          Бурение
        </button>
        <button type="button" className={kind === 'DOWNTIME' ? 'on' : ''} onClick={() => pick('DOWNTIME')}>
          Простой
        </button>
      </div>

      {/* Паспорт — журнал забивки на одну сваю: номер, залоги, отметки головы.
          Форма общая с остальными модулями, потому что требование к ней не
          наше, а нормативное (СП 45.13330), и расходиться ей нельзя. */}
      {kind === 'PASSPORT' ? (
        <PilePassportForm
          draftUserId={state.operator?.id}
          draftShiftId={state.shift?.id}
          grades={state.dictionaries.pileGrades}
          busy={busy}
          onSubmit={(pileGradeId, passport) => onLog({kind: 'PILE_PASSPORT', pileGradeId, passport})}
        />
      ) : (
      <div className="card">
        <span className="lbl">
          {kind === 'PILES' ? 'Марка сваи' : kind === 'DRILLING' ? 'Тип бурения' : 'Причина простоя'}
        </span>
        <select value={optionId} onChange={(event) => setOptionId(event.target.value)}>
          <option value="">Выберите…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        {forbidden ? (
          <p className="ov5-hint">
            Работа запрещена: {state.permit.blocks.map((block) => block.title).join('; ')}.
            Простой записывается как обычно.
          </p>
        ) : null}

        {kind === 'DOWNTIME' ? (
          <>
            <span className="lbl">Простой, часов</span>
            <input type="number" inputMode="decimal" step="0.25" min="0.25" max="24"
              placeholder="Например: 1,5" value={hoursText}
              onChange={(event) => setHoursText(event.target.value)} />
            {/* Только часы: быстрый выбор тоже в часах. */}
            {DOWNTIME_QUICK_HOURS.map((hours) => (
              <button key={hours} type="button" className="ov5-rowbtn"
                onClick={() => setHoursText(String(hours))}>{formatDowntimeHoursOnly(hours)}</button>
            ))}
            {downtimeHoursProblem(hoursText) ? <p className="ov5-hint">{downtimeHoursProblem(hoursText)}</p> : null}
            {downtimeHours !== null ? (
              <p className="ov5-hint">Простой: {formatDowntimeHoursOnly(downtimeHours)}</p>
            ) : null}
          </>
        ) : (
          <>
            <span className="lbl">Количество, шт</span>
            <input inputMode="decimal" value={count} onChange={(event) => setCount(event.target.value)} />
          </>
        )}
        {kind === 'DRILLING' ? (
          <>
            <span className="lbl">Метров на скважину</span>
            <input inputMode="decimal" value={meters} onChange={(event) => setMeters(event.target.value)} />
          </>
        ) : null}
        <button
          className={ready ? 'b' : 'b dis'}
          type="button"
          disabled={busy || !ready}
          onClick={() => void submit()}
        >
          {busy ? 'Записываем…' : 'Записать'}
        </button>
      </div>
      )}

      {afterFinish ? null : (
        <>
          <button className="b gh" type="button" disabled={busy} onClick={onFinish}>
            Завершить работу
          </button>
          <p className="note">Машина остановлена безопасно — дальше осмотр после смены.</p>
        </>
      )}
    </div>
  );
}

/**
 * G. Сдача смены и итог — экраны G4, G5 макета.
 *
 * НЕОТПРАВЛЕННЫЕ ЗАПИСИ ДЕРЖАТ КНОПКУ (F-R43-1). Закрытая смена отвечает
 * отложенной выработке 409 «Смена уже закрыта», и в отчёт она не попадает:
 * сначала очередь, потом закрытие.
 */
export function CloseScreen({state, busy, onClose, unsent, onFlush, onAddWork}: {
  state: OperatorMobileState;
  busy: boolean;
  onClose: () => void;
  /** Дописать выработку или простой до сдачи смены (решение владельца 07.10.2026). */
  onAddWork?: () => void;
  /** Записей на устройстве, ещё не принятых сервером. */
  unsent: number;
  /** Отправить их немедленно. */
  onFlush: () => void;
}) {
  const {receipt} = state;
  const tiles = (
    <div className="tiles">
      <div className="tile">
        <span className="k">Сваи</span>
        <span className="v">{formatNumber(state.production.piles.count, 0)}</span>
        <span className="m">{formatNumber(state.production.piles.meters, 0)} м.п.</span>
      </div>
      <div className="tile">
        <span className="k">Бурение</span>
        <span className="v">{formatNumber(state.production.drilling.count, 0)}</span>
        <span className="m">{formatNumber(state.production.drilling.meters, 0)} м.п.</span>
      </div>
      <div className="tile">
        <span className="k">Простой</span>
        <span className="v">{formatDowntimeHoursOnly(state.production.downtimeHours)}</span>
      </div>
    </div>
  );

  if (state.phase === 'CLOSED') {
    return (
      <>
        <div className="ok-head">
          <span className="t">Смена закрыта</span>
          <span className="s">Отчёт отправлен диспетчеру</span>
        </div>
        <div className="scr">
          <ShiftThanks operatorName={state.operator?.name} />
          {receipt ? (
            <div className="card">
              <span className="lbl">Отчёт</span>
              <p>{receipt.reportId}</p>
              <p className="m">
                отправлен {dateRu(receipt.submittedAt)} · закрыт {dateRu(receipt.closedAt)}
              </p>
            </div>
          ) : null}
          {tiles}
        </div>
      </>
    );
  }

  return (
    <div className="scr">
      <p className="kicker">Сдача смены</p>
      {tiles}
      {unsent > 0 ? (
        <>
          <p className="note warn">Сначала отправьте записи с телефона: {unsent} не отправлено</p>
          <button className="b gh" type="button" data-next-target="true" onClick={onFlush}>Отправить сейчас</button>
        </>
      ) : null}
      {onAddWork ? (
        <button className="b gh" type="button" disabled={busy} onClick={onAddWork}>
          {state.shift && state.shift.productionDate < state.productionDate
            ? `Дописать отчёт за ${dateRu(state.shift.productionDate)}`
            : 'Дописать сваи, бурение или простой'}
        </button>
      ) : null}
      <button className="b" type="button" data-next-target={unsent === 0} disabled={busy || unsent > 0} onClick={onClose}>
        {busy ? 'Закрываем…' : 'Закрыть смену'}
      </button>
      <p className="note">
        После закрытия смена уходит в отчёт и правится только администратором.
      </p>
    </div>
  );
}
