'use client';

/**
 * Сменный отчёт внутри модуля оператора.
 *
 * ЗАЧЕМ СВОЙ СЛОЙ, А НЕ ПЕРЕХОД НА `/report`. Модуль обязан закрывать смену
 * целиком: раньше «+ Новая свая», «Простой» и «Сдать смену» уводили на старые
 * экраны, и вариант переставал быть вариантом — это была обёртка вокруг
 * прежнего интерфейса. Здесь те же серверные команды, но человек остаётся на
 * одном экране.
 *
 * Отчёт сохраняется черновиком после каждого добавления. Причина простая: в
 * поле связь рвётся и телефон засыпает, а накопленные за смену сваи, потерянные
 * при перезагрузке вкладки, — это спор бригадира с диспетчером в конце месяца.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { getTodayInTimezone } from '@/lib/timezone';

export interface PileGrade { id: string; name: string; lengthMm: number | null }
export interface DowntimeReason { id: string; name: string }

export interface PileEntry { pileGradeId: string; count: number }
/** Простой измеряется в ЧАСАХ — сервер сверяет сумму с длиной смены. */
export interface DowntimeEntry { reasonId: string; duration: number; comment?: string }
/**
 * Лидерное бурение. Своего ввода в этом модуле нет, но строки ОБЯЗАНЫ здесь
 * быть: сохранение отчёта — полная замена его содержимого, и то, чего нет в
 * черновике, сервер удаляет. Подробности — в примечании к `save`.
 */
export interface DrillingEntry {
  /** Идентификатор существующей строки: по нему сервер узнаёт её, а не заводит новую. */
  id?: string;
  typeId: string;
  count: number;
  metersPerUnit: number;
  /** Метры обязательны в схеме сохранения — без них запись не пройдёт проверку. */
  meters: number;
  picketId?: string;
}

interface Draft {
  reportId: string | null;
  version: number | undefined;
  piles: PileEntry[];
  drillings: DrillingEntry[];
  downtimes: DowntimeEntry[];
  status: 'draft' | 'submitted';
}

const EMPTY: Draft = {
  reportId: null, version: undefined, piles: [], drillings: [], downtimes: [], status: 'draft',
};

export function useShiftReport(siteId: string | null, equipmentId: string | null, shiftType: string) {
  const [grades, setGrades] = useState<PileGrade[]>([]);
  const [reasons, setReasons] = useState<DowntimeReason[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const today = getTodayInTimezone();

  /**
   * Марки свай берём ИЗ ПЛАНА ОБЪЕКТА, а не из общего справочника.
   *
   * Сервер принимает только запланированные на объекте марки («Марка "С 100-35"
   * не запланирована на этом объекте»), и это правильно: свая не той марки —
   * это переделка фундамента, а не опечатка. Общий список из справочника давал
   * оператору выбрать любую из полусотни и получить отказ уже после ввода
   * количества. Показываем ровно то, что можно.
   *
   * Причины простоя объектом не ограничены — их берём из справочника.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [dictionary, site] = await Promise.all([
        authFetch('/api/dictionary/all'),
        siteId ? authFetch(`/api/sites/${siteId}`) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (dictionary.ok) {
        const body = await dictionary.json();
        setReasons((body.downtimeReasons ?? [])
          .filter((row: { isActive?: boolean }) => row.isActive !== false));
      }
      if (site?.ok) {
        const body = await site.json();
        const plans = (body.site?.pilePlans ?? []) as Array<{
          pileGrade?: { id: string; name: string; isActive?: boolean };
        }>;
        setGrades(plans.flatMap((plan) => {
          const grade = plan.pileGrade;
          if (!grade || grade.isActive === false) return [];
          return [{ id: grade.id, name: grade.name, lengthMm: null }];
        }));
      }
    })();
    return () => { cancelled = true; };
  }, [siteId]);

  /** Подтянуть уже начатый отчёт этой смены, чтобы не начинать с нуля. */
  const loadDraft = useCallback(async () => {
    if (!siteId) return;
    const response = await authFetch(`/api/reports/edit?siteId=${siteId}&date=${today}`);
    if (!response.ok) return;
    const body = await response.json().catch(() => null);
    const report = body?.report ?? body?.data ?? null;
    if (!report) return;
    setDraft({
      /*
        Берём `reportId`, а НЕ `id`. Это разные колонки: `id` — первичный ключ
        строки, `reportId` — внешний номер отчёта, и сохранение ищет отчёт
        именно по второму (`report.repository.findUnique({where:{reportId}})`).
        Здесь стоял `report.id`, поиск не находил ничего, сохранение уходило по
        ветке СОЗДАНИЯ и падало на уникальности (tenantId, shiftId), потому что
        отчёт на эту смену уже есть. Оператор получал 409 со стеком Prisma
        вместо записи. Ломалось это ровно тогда, когда смену открыли в живом
        `/operator`: там номер отчёта вида «RM-<смена>-<дата>» никогда не
        совпадает с `id`.
      */
      reportId: report.reportId ?? report.id ?? null,
      version: typeof report.version === 'number' ? report.version : undefined,
      piles: (report.piles ?? []).map((row: { pileGradeId: string; count: number }) =>
        ({ pileGradeId: row.pileGradeId, count: row.count })),
      // Бурение читаем, хотя не показываем и не правим: иначе первое же
      // сохранение сотрёт его с сервера. Возвращаем строку как есть, включая
      // идентификатор и метры: метры обязательны в схеме, а без идентификатора
      // сервер счёл бы строку новой.
      drillings: (report.drillings ?? []).map((row: {
        id?: string; typeId: string; count: number; metersPerUnit: number;
        meters: number; picketId?: string | null;
      }) => ({
        id: row.id,
        typeId: row.typeId,
        count: row.count,
        metersPerUnit: row.metersPerUnit,
        meters: row.meters,
        ...(row.picketId ? {picketId: row.picketId} : {}),
      })),
      /*
        Пустой комментарий приводим к `undefined`. Сервер отдаёт его как `null`,
        а схема сохранения ждёт строку либо отсутствие поля и на `null` отвечает
        «Invalid input: expected string, received null» — то есть прочитанная с
        сервера запись не проходила обратную отправку.
      */
      downtimes: (report.downtimes ?? []).map((row: {
        reasonId: string; duration: number; comment?: string | null;
      }) => ({
        reasonId: row.reasonId,
        duration: row.duration,
        ...(row.comment ? {comment: row.comment} : {}),
      })),
      status: report.status === 'submitted' ? 'submitted' : 'draft',
    });
  }, [siteId, today]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- подтягивает начатый отчёт смены
    void loadDraft();
  }, [loadDraft]);

  /**
   * Записать отчёт.
   *
   * СОХРАНЕНИЕ — ПОЛНАЯ ЗАМЕНА СОДЕРЖИМОГО, А НЕ ДОБАВЛЕНИЕ. Сервер
   * пересобирает отчёт из присланного: `report-command.service` восстанавливает
   * его с пустыми дочерними списками, репозиторий сверяет их с базой и
   * УДАЛЯЕТ всё, чего в посылке нет. Здесь стояло `drillings: []` — и первое же
   * «+ Новая свая» стирало лидерное бурение, записанное диспетчером или живым
   * `/operator` в тот же отчёт за те же сутки. Молча, без единого сообщения.
   * Поэтому бурение читается в черновик и возвращается обратно как есть, хотя
   * своего ввода для него в этом модуле нет.
   *
   * Правило общее: любое новое дочернее поле отчёта, появившееся на сервере,
   * обязано появиться и здесь, иначе оно начнёт исчезать тем же способом.
   *
   * @param status черновик или отправка. Отправка — отдельное решение
   *   человека: молча отправлять отчёт при добавлении сваи нельзя, после
   *   отправки его правит уже диспетчер.
   */
  const save = useCallback(async (next: Draft, status: 'draft' | 'submitted') => {
    if (!siteId) {
      toast.error('Объект не определён — отчёт не сохранить');
      return false;
    }
    setSaving(true);
    try {
      const response = await authFetch('/api/reports/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: next.reportId ?? undefined,
          version: next.version,
          siteId,
          equipmentId: equipmentId ?? undefined,
          date: today,
          shiftType: shiftType === 'NIGHT' ? 'NIGHT' : 'DAY',
          status,
          piles: next.piles,
          downtimes: next.downtimes,
          drillings: next.drillings,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error === 'Validation failed'
          ? (body.details?.[0]?.message ?? 'Отчёт не прошёл проверку')
          : (body?.error ?? 'Не удалось сохранить отчёт'));
      }
      /*
        Номер версии берём из ответа, а он лежит на ДВА уровня глубже, чем
        читалось раньше: `{report: {report: {...}}}`. Прежнее `body.report.version`
        всегда давало `undefined`, версия в черновике оставалась прежней, и
        ВТОРАЯ запись подряд падала с «Отчёт был изменён другим пользователем» —
        хотя менял его тот же человек секунду назад.

        Поля отчёта берём из ответа целиком, а не собираем из `next`: сервер
        мог изменить состояние (например, отметить отчёт отправленным), и
        черновик, разошедшийся с сервером, — это следующая такая же ошибка.
      */
      const saved = body?.report?.report ?? body?.report ?? body?.data ?? null;
      setDraft({
        ...next,
        status: saved?.status === 'submitted' ? 'submitted' : status,
        reportId: saved?.reportId ?? next.reportId,
        version: typeof saved?.version === 'number' ? saved.version : next.version,
      });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить отчёт');
      return false;
    } finally {
      setSaving(false);
    }
  }, [siteId, equipmentId, today, shiftType]);

  const addPile = useCallback(async (entry: PileEntry) => {
    // Одна и та же марка складывается в одну строку: пять записей «С 100-35 × 1»
    // диспетчеру читать неудобно, а в базе это те же пять свай.
    const piles = [...draft.piles];
    const found = piles.findIndex((row) => row.pileGradeId === entry.pileGradeId);
    if (found >= 0) piles[found] = { ...piles[found], count: piles[found].count + entry.count };
    else piles.push(entry);
    return save({ ...draft, piles }, 'draft');
  }, [draft, save]);

  const addDowntime = useCallback(async (entry: DowntimeEntry) =>
    save({ ...draft, downtimes: [...draft.downtimes, entry] }, 'draft'), [draft, save]);

  const submit = useCallback(async () => save(draft, 'submitted'), [draft, save]);

  const totalPiles = draft.piles.reduce((sum, row) => sum + row.count, 0);
  const totalDowntime = draft.downtimes.reduce((sum, row) => sum + row.duration, 0);

  return {
    grades, reasons, draft, saving,
    totalPiles, totalDowntime,
    addPile, addDowntime, submit, reload: loadDraft,
  };
}
