'use client';

import type {PilePassportInput} from '@/components/piling/operator-mobile/api';
import {BigButton, Panel, PanelTitle} from '@/components/piling/operator-mobile/ui';
import {
  DEFAULT_SET_BLOWS, journalRefusalMm, REFUSAL_SET_WINDOW, refusalExceedsDesign,
  setRefusalMm, validatePassport,
} from '@/modules/operator-mobile/domain/pile-passport';
import type {PassportDraftData} from './drafts';

/**
 * Паспорт забитой сваи — управляемая форма для экрана «следующего поколения».
 *
 * ПОЧЕМУ СВОЯ, А НЕ ОБЩАЯ. Общий `PilePassportForm` (модуль `operator-mobile`,
 * вне зоны правок) владеет значениями сам: ни начальных не принимает, ни
 * изменений наружу не отдаёт. Ревью №4 (пункт A1) требует обратного — паспорт
 * живёт в памяти оболочки вместе с остальными черновиками и переживает и
 * обходной экран, и перезагрузку, и недоступное хранилище. Поэтому здесь та же
 * форма (те же поля, те же правила и та же команда `PILE_PASSPORT`), но
 * управляемая: значения приходят пропом, изменения уходят колбэком.
 *
 * ЧТО НЕ ПЕРЕНОСИТСЯ. Снимки и служебные состояния загрузки — не черновик;
 * здесь только введённые человеком значения.
 */

/** Числовое поле паспорта. Пустое — законно: замера пока нет. */
function Num({label, unit, value, onChange, hint, allowNegative, step = '0.01', disabled}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** Отметка головы отсчитывается от нуля здания и обычно отрицательна. */
  allowNegative?: boolean;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-base font-medium text-muted-foreground">
        {label}{unit ? `, ${unit}` : ''}
      </span>
      <input
        type="number"
        inputMode={allowNegative ? 'text' : 'decimal'}
        step={step}
        disabled={disabled}
        {...(allowNegative ? {} : {min: '0'})}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
      />
      {hint ? <span className="mt-1 block text-base text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Check({label, checked, onChange, disabled}: {
  label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="flex min-h-12 items-center gap-3 rounded-md border bg-card px-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-6 w-6 shrink-0"
      />
      <span className="text-base font-medium">{label}</span>
    </label>
  );
}

/** Пусто — замера нет; иначе число. Мусор в поле трактуем как «нет». */
function num(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Черновик залога: поля пустые, пока машинист не снял рейку. */
interface SetDraft {
  blows: string;
  penetration: string;
  dropHeight: string;
}

function emptySet(): SetDraft {
  return {blows: String(DEFAULT_SET_BLOWS), penetration: '', dropHeight: ''};
}

/**
 * Заполненные залоги по порядку.
 *
 * Незаполненная строка — не ноль, а «ещё не мерили»: она молча выпадает,
 * иначе пустая последняя строка обнулила бы отказ сваи.
 */
function toMeasuredSets(drafts: SetDraft[]) {
  const measured: {ordinal: number; blows: number; penetrationMm: number; dropHeightM: number | null}[] = [];
  for (const draft of drafts) {
    const blows = num(draft.blows);
    const penetrationMm = num(draft.penetration);
    if (blows === null || penetrationMm === null || blows <= 0 || penetrationMm < 0) continue;
    measured.push({
      ordinal: measured.length + 1,
      blows,
      penetrationMm,
      dropHeightM: num(draft.dropHeight),
    });
  }
  return measured;
}

export function PassportForm({grades, busy, value, onChange, onSubmit}: {
  grades: {id: string; name: string; lengthMm: number | null}[];
  busy: boolean;
  value: PassportDraftData;
  onChange: (next: PassportDraftData) => void;
  onSubmit: (pileGradeId: string, passport: PilePassportInput) => Promise<boolean>;
}) {
  const patch = (part: Partial<PassportDraftData>) => onChange({...value, ...part});
  const setSets = (next: SetDraft[]) => patch({sets: next});

  // Отказ считаем тем же правилом, что и журнал: экран машиниста и экран
  // мастера обязаны показывать одно число.
  const measuredSets = toMeasuredSets(value.sets);
  const journal = journalRefusalMm(measuredSets);
  const refusal = journal?.refusalMm ?? null;
  const exceeds = refusalExceedsDesign({actual: refusal, design: num(value.designRefusal)});

  // Глубину сверяем с длиной сваи из марки — тем же правилом, что и сервер:
  // экран должен предупредить до отправки, а не показать отказ после.
  const pileLengthM = grades.find((grade) => grade.id === value.grade)?.lengthMm;
  const depthProblem = validatePassport({
    pileNumber: value.number || 'x',
    refusalSetPenetrationMm: null,
    refusalSetBlows: null,
    drivenDepthM: num(value.depth),
    pileLengthM: pileLengthM != null ? pileLengthM / 1000 : null,
    followerUsed: value.followerUsed,
  }).find((problem) => problem.field === 'drivenDepthM');

  const ready = Boolean(value.grade) && value.number.trim().length > 0 && !depthProblem;

  const submit = async () => {
    if (!ready) return;
    await onSubmit(value.grade, {
      pileNumber: value.number.trim(),
      designHeadLevelM: num(value.designHead),
      actualHeadLevelM: num(value.actualHead),
      drivenDepthM: num(value.depth),
      // Последний залог кладём и в поля паспорта: по ним читают сваю там, где
      // залоги не разворачивают, — и два источника обязаны сойтись.
      sets: measuredSets.map((set) => ({
        blows: set.blows,
        penetrationMm: set.penetrationMm,
        dropHeightM: set.dropHeightM,
      })),
      refusalSetPenetrationMm: measuredSets.at(-1)?.penetrationMm ?? null,
      refusalSetBlows: measuredSets.at(-1)?.blows ?? null,
      designRefusalMm: num(value.designRefusal),
      totalBlows: num(value.totalBlows),
      blowsLastMeter: num(value.blowsLastMeter),
      planDeviationMm: num(value.planDeviation),
      tiltPercent: num(value.tilt),
      dropHeightM: num(value.dropHeight),
      redriven: value.redriven,
      followerUsed: value.followerUsed,
      headCutOff: value.headCutOff,
      note: value.note.trim() || undefined,
    });
    // Очистку отправленного черновика ведёт оболочка по подтверждению: «константы
    // проекта» (марку, проектные величины) она оставляет, остальное убирает.
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-base font-medium text-muted-foreground">Марка сваи</span>
        <select
          value={value.grade}
          disabled={busy}
          onChange={(event) => patch({grade: event.target.value})}
          className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-base shadow-xs"
        >
          <option value="">Выберите…</option>
          {grades.map((grade) => (
            <option key={grade.id} value={grade.id}>{grade.name}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-base font-medium text-muted-foreground">Номер сваи по проекту</span>
        <input
          value={value.number}
          disabled={busy}
          onChange={(event) => patch({number: event.target.value})}
          placeholder="С-130"
          className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold shadow-xs"
        />
      </label>

      <Panel>
        <PanelTitle>Отметки, м</PanelTitle>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Num label="Проектная головы" value={value.designHead} disabled={busy} onChange={(v) => patch({designHead: v})} allowNegative step="0.001" />
          <Num label="Фактическая головы" value={value.actualHead} disabled={busy} onChange={(v) => patch({actualHead: v})} allowNegative step="0.001" />
        </div>
        <div className="mt-3">
          <Num label="Глубина погружения" unit="м" value={value.depth} disabled={busy} onChange={(v) => patch({depth: v})} step="0.01" />
        </div>
        {depthProblem ? (
          <p className="mt-2 rounded-md bg-warning/15 px-3 py-2 text-sm font-semibold text-warning-strong">
            {depthProblem.message}
          </p>
        ) : null}
      </Panel>

      <Panel tone={exceeds === true ? 'warning' : 'plain'}>
        <PanelTitle tone={exceeds === true ? 'warning' : 'plain'}>Залоги и отказ</PanelTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Залог — серия ударов, после которой снимают по рейке, на сколько свая ушла.
          Отказ считается по трём последним залогам.
        </p>

        <div className="mt-2 space-y-3">
          {value.sets.map((set, index) => {
            const setRefusal = setRefusalMm({
              blows: num(set.blows) ?? 0,
              penetrationMm: num(set.penetration) ?? -1,
            });
            return (
              <div key={index} className="rounded-md border bg-muted/40 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground">
                    Залог № {index + 1}
                    {setRefusal !== null ? ` · отказ ${setRefusal} мм/удар` : ''}
                  </span>
                  {value.sets.length > 1 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setSets(value.sets.filter((_, i) => i !== index))}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-sm font-medium text-muted-foreground underline"
                    >
                      убрать
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Num
                    label="Ударов" value={set.blows} step="1" disabled={busy}
                    onChange={(v) => setSets(value.sets.map((item, i) => (i === index ? {...item, blows: v} : item)))}
                  />
                  <Num
                    label="Погружение" unit="мм" value={set.penetration} step="0.1" disabled={busy}
                    onChange={(v) => setSets(value.sets.map((item, i) => (i === index ? {...item, penetration: v} : item)))}
                  />
                  <Num
                    label="Высота" unit="м" value={set.dropHeight} step="0.01" disabled={busy}
                    onChange={(v) => setSets(value.sets.map((item, i) => (i === index ? {...item, dropHeight: v} : item)))}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => setSets([...value.sets, emptySet()])}
          className="mt-2 h-11 w-full rounded-md border border-dashed text-sm font-semibold text-muted-foreground"
        >
          + Добавить залог
        </button>

        <div className="mt-3">
          <Num
            label="Проектный отказ" unit="мм/удар" value={value.designRefusal} disabled={busy}
            onChange={(v) => patch({designRefusal: v})} step="0.01"
            hint="Из проекта. С ним сравнивают полученный."
          />
        </div>
        {refusal !== null && journal ? (
          <p className={exceeds === true
            ? 'mt-3 rounded-md bg-warning/15 px-3 py-2 text-base font-semibold text-warning-strong'
            : 'mt-3 rounded-md bg-info/10 px-3 py-2 text-base font-semibold text-info-strong'}
          >
            Отказ: {refusal} мм/удар
            {journal.setsUsed < REFUSAL_SET_WINDOW
              ? ` (по ${journal.setsUsed} залогу — по норме нужно ${REFUSAL_SET_WINDOW})`
              : ''}
            {exceeds === true
              ? ' — больше проектного. Свая не добита, скажите диспетчеру.'
              : exceeds === false ? ' — в пределах проектного.' : ''}
          </p>
        ) : null}
      </Panel>

      <Panel>
        <PanelTitle>Удары</PanelTitle>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Num label="Всего" value={value.totalBlows} disabled={busy} onChange={(v) => patch({totalBlows: v})} step="1" />
          <Num label="На последний метр" value={value.blowsLastMeter} disabled={busy} onChange={(v) => patch({blowsLastMeter: v})} step="1" />
        </div>
        <div className="mt-3">
          <Num
            label="Высота падения молота" unit="м" value={value.dropHeight} disabled={busy}
            onChange={(v) => patch({dropHeight: v})} step="0.01"
            hint="Марка молота и энергия удара берутся из карточки установки."
          />
        </div>
      </Panel>

      <Panel>
        <PanelTitle>Отклонения от проекта</PanelTitle>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Num label="В плане" unit="мм" value={value.planDeviation} disabled={busy} onChange={(v) => patch({planDeviation: v})} step="1" />
          <Num label="От вертикали" unit="%" value={value.tilt} disabled={busy} onChange={(v) => patch({tilt: v})} step="0.1" />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-2">
        <Check label="Добивка после отдыха грунта" checked={value.redriven} disabled={busy} onChange={(v) => patch({redriven: v})} />
        <Check
          label="Погружение добойником (голова ниже грунта)"
          checked={value.followerUsed}
          disabled={busy}
          onChange={(v) => patch({followerUsed: v})}
        />
        <Check label="Голова срублена под проектную отметку" checked={value.headCutOff} disabled={busy} onChange={(v) => patch({headCutOff: v})} />
      </div>

      <label className="block">
        <span className="text-base font-medium text-muted-foreground">Примечание</span>
        <textarea
          value={value.note}
          disabled={busy}
          onChange={(event) => patch({note: event.target.value})}
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
