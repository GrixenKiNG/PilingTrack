'use client';

/**
 * Осмотр как на макете: «Прогресс: N из M» и плоский список строк с галочкой.
 *
 * ЧТО НЕ ТАК СЕЙЧАС. Предсменная половина ЕО — от 23 до 108 пунктов на машину
 * (Woltman-PVE 50PR — 108, Liebherr LRH 100 — 91). В базе медиана «от создания
 * осмотра до подписи» — ноль минут: список не читают, его закрывают.
 *
 * ЧТО ЗДЕСЬ. Оператор отвечает по УЗЛАМ: «Всё в норме» одним касанием
 * проставляет норму всем пунктам узла. В базу при этом ложатся те же ответы по
 * каждому пункту — механик и проверяющий видят прежнюю детализацию.
 *
 * ПОЧЕМУ ПУНКТЫ ВИДНЫ, А НЕ СПРЯТАНЫ ЗА НАЗВАНИЕМ УЗЛА. Сначала показывались
 * только заголовки разделов, и это оказалось бессмысленно: в шаблонах они
 * несогласованы между машинами — «Перед пуском», «Осмотр перед пуском»,
 * «Перед началом работы», «Перед работой», «Осмотр машины», «Внешний осмотр».
 * По такому слову оператор не понимает, что подтверждает касанием. Поэтому
 * подтверждаемое написано под заголовком, а отметка осталась одна на узел.
 *
 * Касание по конкретному пункту означает «здесь не в порядке» — замечание
 * уходит механику, и снимок к нему предлагается тут же.
 *
 * Состав пунктов здесь НЕ режется — это инженерное решение механика. Меняется
 * только способ ответа.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { InspectionItemPhotos } from '@/components/piling/inspections/inspection-item-photos';
import { Check, ChevronDown, ChevronRight } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';
import { StepButton } from './ui';

type AnswerType = 'YES_NO' | 'STATUS4' | 'DONE' | 'MEASURE';

interface SnapItem {
  id: string;
  sectionTitle: string | null;
  text: string;
  answerType: AnswerType;
  unit: string | null;
  norm: string | null;
  photoRequired: boolean;
}

interface SavedAnswer { itemId: string; result: string; value: string | null }

const OK_RESULT: Record<Exclude<AnswerType, 'MEASURE'>, string> = {
  YES_NO: 'YES', STATUS4: 'OK', DONE: 'DONE',
};
const REMARK_RESULT: Record<Exclude<AnswerType, 'MEASURE'>, string> = {
  YES_NO: 'NO', STATUS4: 'REMARK', DONE: 'NOT_DONE',
};

interface NodeGroup {
  title: string;
  /** Пункты, закрываемые одним касанием по узлу. */
  items: SnapItem[];
  /** Замеры: число вводится, узлом не закрывается. */
  measures: SnapItem[];
}

interface Props {
  inspectionId: string;
  signedByName: string;
  onDone: () => void;
}

export function CompactInspection({ inspectionId, signedByName, onDone }: Props) {
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [okNodes, setOkNodes] = useState<Record<string, boolean>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  /** Раскрыт ровно один узел — обход машины идёт по одному узлу за раз. */
  const [openTitle, setOpenTitle] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(`/api/inspections/${inspectionId}`);
      if (!response.ok) throw new Error('Не удалось загрузить осмотр');
      const { inspection } = await response.json() as {
        inspection: { templateSnapshot: SnapItem[]; answers: SavedAnswer[] };
      };

      const byTitle = new Map<string, NodeGroup>();
      for (const item of inspection.templateSnapshot) {
        const title = item.sectionTitle?.trim() || 'Прочее';
        const group = byTitle.get(title) ?? { title, items: [], measures: [] };
        if (item.answerType === 'MEASURE') group.measures.push(item);
        else group.items.push(item);
        byTitle.set(title, group);
      }
      const list = [...byTitle.values()];
      setGroups(list);

      // Восстанавливаем ранее сохранённое, чтобы возврат на шаг не терял работу.
      const saved = new Map(inspection.answers.map((answer) => [answer.itemId, answer]));
      const restoredOk: Record<string, boolean> = {};
      const restoredFlags: Record<string, boolean> = {};
      for (const group of list) {
        let answered = 0;
        for (const item of group.items) {
          const answer = saved.get(item.id);
          if (!answer?.result) continue;
          answered += 1;
          if (item.answerType !== 'MEASURE' && answer.result === REMARK_RESULT[item.answerType]) {
            restoredFlags[item.id] = true;
          }
        }
        restoredOk[group.title] = group.items.length > 0 && answered === group.items.length;
      }
      setOkNodes(restoredOk);
      setFlagged(restoredFlags);
      // Возврат на шаг открывает тот раздел, где человек остановился, а не
      // начало списка.
      setOpenTitle(list.find((group) => group.items.length > 0 && !restoredOk[group.title])?.title ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить осмотр');
    } finally {
      setLoading(false);
    }
  }, [inspectionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка осмотра при монтировании
    void load();
  }, [load]);

  const tappable = useMemo(() => groups.filter((group) => group.items.length > 0), [groups]);
  const flaggedItems = useMemo(
    () => groups.flatMap((group) => group.items).filter((item) => flagged[item.id]),
    [groups, flagged],
  );

  const doneNodes = tappable.filter((group) => okNodes[group.title]).length;
  // Замеры оператор не вводит (решение владельца 26.08.2026): «уровень масла по
  // щупу», «давление по манометру», «ход наголовника» — это 12–15 секунд на
  // каждый, и именно они делали ежесменный осмотр десятиминутным. В счётчик они
  // не идут и на экране не показываются.
  const total = tappable.length;
  const done = doneNodes;
  const ready = total > 0 && done === total;

  const toggleNode = (group: NodeGroup) => {
    const next = !okNodes[group.title];
    setOkNodes((prev) => ({ ...prev, [group.title]: next }));
    // Отметили узел нормой — снимаем с него все прежние замечания: иначе
    // строка говорила бы «в норме», а в базу ушло бы «неисправно».
    if (next) {
      setFlagged((prev) => {
        const copy = { ...prev };
        for (const item of group.items) delete copy[item.id];
        return copy;
      });
      // Узел закрыт — сам открываем следующий незакрытый. Человек не ищет,
      // куда нажать дальше, и не листает список вверх.
      const rest = tappable.slice(tappable.indexOf(group) + 1);
      setOpenTitle(rest.find((item) => !okNodes[item.title])?.title ?? null);
    }
  };

  const finish = async () => {
    if (!ready) return toast.error('Отметьте все узлы');
    setBusy(true);
    try {
      const answers = groups.flatMap((group) => {
        const rows = group.items
          .filter((item) => item.answerType !== 'MEASURE')
          .map((item) => ({
            itemId: item.id,
            result: flagged[item.id]
              ? REMARK_RESULT[item.answerType as Exclude<AnswerType, 'MEASURE'>]
              : OK_RESULT[item.answerType as Exclude<AnswerType, 'MEASURE'>],
            value: null,
            note: null,
            photoCount: 0,
          }));
        // Замеры уходят как «не проверено», а НЕ как «в норме».
        //
        // Это принципиально. Проставить им OK значило бы записать в журнал
        // измерение, которого никто не делал: механик потом читает «давление в
        // норме», а манометр никто не смотрел. `NA` честно говорит «не
        // измеряли» — оценку состояния такие пункты не завышают, домен
        // исключает их из подсчёта (`NA_RESULTS` в inspection-logic).
        const measureRows = group.measures.map((item) => ({
          itemId: item.id, result: 'NA', value: null, note: null, photoCount: 0,
        }));
        return [...rows, ...measureRows];
      });

      const put = await authFetch(`/api/inspections/${inspectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!put.ok) throw new Error((await put.json().catch(() => ({}))).error || 'Ошибка сохранения');

      const complete = await authFetch(`/api/inspections/${inspectionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedByName }),
      });
      if (!complete.ok) {
        throw new Error((await complete.json().catch(() => ({}))).error || 'Ошибка завершения');
      }
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось закрыть осмотр');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Загружаем осмотр…</p>;
  }

  // --- основной список: заголовок узла + сами пункты, одна отметка на узел ---
  //
  // ПОЧЕМУ ПУНКТЫ ВИДНЫ, А НЕ СПРЯТАНЫ ЗА НАЗВАНИЕМ УЗЛА. Заголовки разделов в
  // шаблонах несогласованы между машинами: «Перед пуском», «Осмотр перед
  // пуском», «Перед началом работы», «Перед работой», «Осмотр машины»,
  // «Внешний осмотр». Одним таким словом оператору не сказано ничего — он не
  // знает, что именно подтверждает касанием. Поэтому подтверждаемое написано
  // прямо под заголовком, а отметка по-прежнему одна на весь узел.
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {done} из {total} разделов · {tappable.reduce((sum, group) => sum + group.items.length, 0)} проверок
      </p>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {tappable.map((group) => {
        const ok = Boolean(okNodes[group.title]);
        const open = openTitle === group.title;
        const groupFlags = group.items.filter((item) => flagged[item.id]);
        return (
          <li key={group.title}>
            {/* Свёрнутая строка узла: состояние, название, счётчик пунктов. */}
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenTitle(open ? null : group.title)}
              className="flex min-h-12 w-full items-center gap-3 px-3 text-left active:bg-muted/60"
            >
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                groupFlags.length > 0 ? 'border-warning bg-warning text-white'
                  : ok ? 'border-[#12a150] bg-[#12a150] text-white' : 'border-border')}>
                {ok && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-sm',
                ok ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                {group.title}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {ok ? group.items.length : 0}/{group.items.length}
              </span>
              {open
                ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>

            {open && (
            <div className="border-t border-border bg-background/40">
            <div className="px-3 py-2">
              <button
                type="button"
                aria-pressed={ok}
                onClick={() => toggleNode(group)}
                className={cn('flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition',
                  ok ? 'border-[#12a150] bg-[#12a150] text-white' : 'border-border text-muted-foreground')}
              >
                <Check className="h-4 w-4" />
                Всё в норме
              </button>
            </div>
            <ul className="divide-y divide-border">
              {group.items.map((item) => {
                const bad = Boolean(flagged[item.id]);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        // Касание по пункту — это «здесь не в порядке». Узел при
                        // этом считается осмотренным: человек его прошёл и
                        // нашёл дефект, а не пропустил.
                        const next = !bad;
                        setFlagged((prev) => ({ ...prev, [item.id]: next }));
                        setOkNodes((prev) => ({ ...prev, [group.title]: true }));
                      }}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left"
                    >
                      <span className={cn('mt-0.5 h-4 w-4 shrink-0 rounded-full border',
                        bad ? 'border-warning bg-warning' : ok ? 'border-[#12a150] bg-[#12a150]' : 'border-border')} />
                      <span className={cn('text-sm',
                        bad ? 'font-medium text-warning-strong' : 'text-muted-foreground')}>
                        {item.text}
                      </span>
                    </button>
                    {bad && (
                      <div className="px-3 pb-3 pl-9">
                        <p className="mb-1.5 text-xs text-muted-foreground">
                          Снимок по желанию — он поможет механику
                        </p>
                        <InspectionItemPhotos inspectionId={inspectionId} itemId={item.id} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {groupFlags.length > 0 && (
              <p className="border-t border-border bg-warning/10 px-3 py-1.5 text-xs text-warning-strong">
                Замечаний в узле: {groupFlags.length}
              </p>
            )}
            </div>
            )}
          </li>
        );
      })}
      </ul>

      {flaggedItems.length > 0 && (
        <p className="text-sm font-medium text-warning-strong">
          Замечаний всего: {flaggedItems.length} — уйдут механику
        </p>
      )}

      <StepButton label="Далее" onClick={() => void finish()} disabled={!ready} busy={busy} />
    </>
  );
}
