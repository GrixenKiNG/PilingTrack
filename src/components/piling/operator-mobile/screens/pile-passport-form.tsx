'use client';

import {useState} from 'react';
import {
  actualRefusalMm, DEFAULT_SET_BLOWS, refusalExceedsDesign, validatePassport,
} from '@/modules/operator-mobile/domain/pile-passport';
import type {PilePassportInput} from '../api';
import {BigButton, Panel, PanelTitle} from '../ui';

/**
 * Паспорт забитой сваи — журнал забивки на одну сваю.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ ФОРМА, А НЕ ПОЛЯ В ЭКРАНЕ РАБОТЫ. Пачка — это две цифры на
 * ходу, паспорт — полтора десятка замеров. Ужать их в одну форму значит
 * заставить того, кто пишет пачкой, каждый раз проходить мимо полей отказа.
 *
 * ПОЧЕМУ ОБЯЗАТЕЛЕН ТОЛЬКО НОМЕР. Часть замеров появляется уже после забивки:
 * отметку головы берут нивелиром, отклонение меряют позже. Требовать всё сразу
 * значит получить выдуманные числа в полях, которых машинист пока не знает.
 *
 * ПОЧЕМУ ОТКАЗ НЕ ВВОДИТСЯ, А ПОКАЗЫВАЕТСЯ. Меряют залог: серию ударов и
 * погружение по рейке. Отказ — частное. Поле для него означало бы третье
 * число, которое может не сойтись с первыми двумя.
 */

/** Числовое поле паспорта. Пустое — законно: замера пока нет. */
function Num({label, unit, value, onChange, hint, allowNegative, step = '0.01'}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** Отметка головы отсчитывается от нуля здания и обычно отрицательна. */
  allowNegative?: boolean;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="text-2xs font-medium text-muted-foreground">
        {label}{unit ? `, ${unit}` : ''}
      </span>
      <input
        type="number"
        inputMode={allowNegative ? 'text' : 'decimal'}
        step={step}
        {...(allowNegative ? {} : {min: '0'})}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
      />
      {hint ? <span className="mt-1 block text-2xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Check({label, checked, onChange}: {
  label: string; checked: boolean; onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 items-center gap-3 rounded-md border bg-card px-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5"
      />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

/** Пусто — замера нет; иначе число. Мусор в поле трактуем как «нет». */
function num(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function PilePassportForm({grades, busy, onSubmit}: {
  grades: {id: string; name: string; lengthMm: number | null}[];
  busy: boolean;
  onSubmit: (pileGradeId: string, passport: PilePassportInput) => Promise<boolean>;
}) {
  const [pileGradeId, setPileGradeId] = useState('');
  const [pileNumber, setPileNumber] = useState('');
  const [designHead, setDesignHead] = useState('');
  const [actualHead, setActualHead] = useState('');
  const [depth, setDepth] = useState('');
  const [penetration, setPenetration] = useState('');
  const [blows, setBlows] = useState(String(DEFAULT_SET_BLOWS));
  const [designRefusal, setDesignRefusal] = useState('');
  const [totalBlows, setTotalBlows] = useState('');
  const [blowsLastMeter, setBlowsLastMeter] = useState('');
  const [planDeviation, setPlanDeviation] = useState('');
  const [tilt, setTilt] = useState('');
  const [dropHeight, setDropHeight] = useState('');
  const [redriven, setRedriven] = useState(false);
  const [followerUsed, setFollowerUsed] = useState(false);
  const [headCutOff, setHeadCutOff] = useState(false);
  const [note, setNote] = useState('');

  // Отказ считаем тем же правилом, что и сервер: экран и журнал обязаны
  // показывать одно число.
  const refusal = actualRefusalMm({penetrationMm: num(penetration), blows: num(blows)});
  const exceeds = refusalExceedsDesign({actual: refusal, design: num(designRefusal)});

  // Глубину сверяем с длиной сваи из марки — тем же правилом, что и сервер:
  // экран должен предупредить до отправки, а не показать отказ после.
  const pileLengthM = grades.find((grade) => grade.id === pileGradeId)?.lengthMm;
  const depthProblem = validatePassport({
    pileNumber: pileNumber || 'x',
    refusalSetPenetrationMm: null,
    refusalSetBlows: null,
    drivenDepthM: num(depth),
    pileLengthM: pileLengthM != null ? pileLengthM / 1000 : null,
    followerUsed,
  }).find((problem) => problem.field === 'drivenDepthM');

  const ready = Boolean(pileGradeId) && pileNumber.trim().length > 0 && !depthProblem;

  const submit = async () => {
    if (!ready) return;
    const saved = await onSubmit(pileGradeId, {
      pileNumber: pileNumber.trim(),
      designHeadLevelM: num(designHead),
      actualHeadLevelM: num(actualHead),
      drivenDepthM: num(depth),
      refusalSetPenetrationMm: num(penetration),
      refusalSetBlows: num(blows),
      designRefusalMm: num(designRefusal),
      totalBlows: num(totalBlows),
      blowsLastMeter: num(blowsLastMeter),
      planDeviationMm: num(planDeviation),
      tiltPercent: num(tilt),
      dropHeightM: num(dropHeight),
      redriven,
      followerUsed,
      headCutOff,
      note: note.trim() || undefined,
    });
    if (!saved) return;

    // Номер сваи и замеры очищаем — следующая свая другая. Марку, проектные
    // величины и высоту падения оставляем: подряд бьют одинаковые сваи по
    // одному проекту, и перевыбирать их каждый раз — лишние касания в перчатке.
    setPileNumber('');
    setActualHead('');
    setDepth('');
    setPenetration('');
    setTotalBlows('');
    setBlowsLastMeter('');
    setPlanDeviation('');
    setTilt('');
    setRedriven(false);
    setFollowerUsed(false);
    setHeadCutOff(false);
    setNote('');
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Марка сваи</span>
        <select
          value={pileGradeId}
          onChange={(event) => setPileGradeId(event.target.value)}
          className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-base shadow-xs"
        >
          <option value="">Выберите…</option>
          {grades.map((grade) => (
            <option key={grade.id} value={grade.id}>{grade.name}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Номер сваи по проекту</span>
        <input
          value={pileNumber}
          onChange={(event) => setPileNumber(event.target.value)}
          placeholder="С-130"
          className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold shadow-xs"
        />
      </label>

      <Panel>
        <PanelTitle>Отметки, м</PanelTitle>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Num label="Проектная головы" value={designHead} onChange={setDesignHead} allowNegative step="0.001" />
          <Num label="Фактическая головы" value={actualHead} onChange={setActualHead} allowNegative step="0.001" />
        </div>
        <div className="mt-3">
          <Num label="Глубина погружения" unit="м" value={depth} onChange={setDepth} step="0.01" />
        </div>
        {depthProblem ? (
          <p className="mt-2 rounded-md bg-warning/15 px-3 py-2 text-sm font-semibold text-warning-strong">
            {depthProblem.message}
          </p>
        ) : null}
      </Panel>

      <Panel tone={exceeds === true ? 'warning' : 'plain'}>
        <PanelTitle tone={exceeds === true ? 'warning' : 'plain'}>Отказ</PanelTitle>
        <p className="mt-1 text-2xs text-muted-foreground">
          Замеряется залогом: сколько свая ушла за серию ударов.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Num label="Погружение за залог" unit="мм" value={penetration} onChange={setPenetration} step="0.1" />
          <Num label="Ударов в залоге" value={blows} onChange={setBlows} step="1" />
        </div>
        <div className="mt-3">
          <Num
            label="Проектный отказ" unit="мм/удар" value={designRefusal} onChange={setDesignRefusal} step="0.01"
            hint="Из проекта. С ним сравнивают полученный."
          />
        </div>
        {refusal !== null ? (
          <p className={exceeds === true
            ? 'mt-3 rounded-md bg-warning/15 px-3 py-2 text-sm font-semibold text-warning-strong'
            : 'mt-3 rounded-md bg-info/10 px-3 py-2 text-sm font-semibold text-info-strong'}
          >
            Отказ: {refusal} мм/удар
            {exceeds === true
              ? ' — больше проектного. Свая не добита, скажите диспетчеру.'
              : exceeds === false ? ' — в пределах проектного.' : ''}
          </p>
        ) : null}
      </Panel>

      <Panel>
        <PanelTitle>Удары</PanelTitle>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Num label="Всего" value={totalBlows} onChange={setTotalBlows} step="1" />
          <Num label="На последний метр" value={blowsLastMeter} onChange={setBlowsLastMeter} step="1" />
        </div>
        <div className="mt-3">
          <Num
            label="Высота падения молота" unit="м" value={dropHeight} onChange={setDropHeight} step="0.01"
            hint="Марка молота и энергия удара берутся из карточки установки."
          />
        </div>
      </Panel>

      <Panel>
        <PanelTitle>Отклонения от проекта</PanelTitle>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Num label="В плане" unit="мм" value={planDeviation} onChange={setPlanDeviation} step="1" />
          <Num label="От вертикали" unit="%" value={tilt} onChange={setTilt} step="0.1" />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-2">
        <Check label="Добивка после отдыха грунта" checked={redriven} onChange={setRedriven} />
        <Check
          label="Погружение добойником (голова ниже грунта)"
          checked={followerUsed}
          onChange={setFollowerUsed}
        />
        <Check label="Голова срублена под проектную отметку" checked={headCutOff} onChange={setHeadCutOff} />
      </div>

      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Примечание</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="Скол головы, встретили валун"
          className="mt-1 w-full rounded-md border bg-card px-3 py-2 text-base shadow-xs"
        />
      </label>

      <BigButton onClick={() => void submit()} disabled={!ready || busy}>
        {busy ? 'Записываем…' : 'Записать сваю с паспортом'}
      </BigButton>
    </div>
  );
}
