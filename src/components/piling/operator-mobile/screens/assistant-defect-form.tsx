'use client';

import {useState} from 'react';
import type {AssistantState} from '@/modules/operator-mobile/contracts';
import {authFetch} from '@/lib/api';
import {cn} from '@/lib/utils';
import {BigButton, Panel, PanelTitle} from '../ui';

/**
 * Сообщить о неисправности с места помощника.
 *
 * ЗАЧЕМ. Помощник стоит у машины и видит то, чего не видит машинист из кабины:
 * подтёк под рамой, обрыв прядей троса, сорванный кожух. Право фиксировать
 * дефект у него было с самого начала, а места, откуда им воспользоваться, —
 * нет: он звонил диспетчеру, и замечание жило в чужой памяти до вечера.
 *
 * ПОЧЕМУ ЗАПИСЬ ИДЁТ В ТОТ ЖЕ ЖУРНАЛ. Дефект, заведённый помощником, ничем не
 * отличается от дефекта из осмотра машиниста: его разбирает диспетчер,
 * устраняет механик, и он же влияет на готовность машины. Отдельная «заявка
 * помощника» означала бы второй список, который никто не читает.
 *
 * ПОЧЕМУ УРОВЕНЬ ВЫБИРАЕТ ЧЕЛОВЕК, А ПОТОМ ЕГО МОЖЕТ ПОПРАВИТЬ ДИСПЕТЧЕР.
 * Помощник в поле не всегда различает «подтекает» и «течёт», а от уровня
 * зависит допуск к работе. Поэтому серьёзность здесь — заявленная, а разбор
 * оставлен за тем, кто отвечает за парк.
 */

const SEVERITIES = [
  {value: 'LOW', label: 'Мелочь', hint: 'Работать можно, записать надо'},
  {value: 'NORMAL', label: 'Плановое устранение', hint: 'Чинить в обычном порядке'},
  {value: 'HIGH', label: 'Срочно', hint: 'Чинить как можно скорее'},
  {value: 'CRITICAL', label: 'Эксплуатация запрещена', hint: 'Работать на машине нельзя'},
] as const;

export function AssistantDefectForm({crews, onReported}: {
  crews: AssistantState['crews'];
  onReported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [equipmentId, setEquipmentId] = useState(crews[0]?.equipmentId ?? '');
  const [severity, setSeverity] = useState<string>('NORMAL');
  const [title, setTitle] = useState('');
  const [node, setNode] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (crews.length === 0) return null;

  const ready = equipmentId !== '' && title.trim().length >= 3;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch('/api/readiness/defects', {
        method: 'POST',
        headers: {'content-type': 'application/json', 'idempotency-key': crypto.randomUUID()},
        body: JSON.stringify({
          equipmentId,
          severity,
          title: title.trim(),
          ...(node.trim() ? {node: node.trim()} : {}),
          ...(description.trim() ? {description: description.trim()} : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? body?.error ?? 'Не удалось записать неисправность');
      }
      // Форма закрывается только после ответа сервера: описание пишут один раз
      // и своими словами, и терять его из-за оборвавшегося запроса нельзя.
      setOpen(false);
      setTitle('');
      setNode('');
      setDescription('');
      setSeverity('NORMAL');
      setDone(true);
      onReported();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось записать неисправность');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Panel>
        <PanelTitle>Неисправность</PanelTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Вы стоите у машины и видите то, чего не видно из кабины. Замеченное записывайте здесь —
          запись попадёт в тот же журнал, что и осмотр машиниста.
        </p>
        {done && (
          <p className="mt-2 text-2xs font-semibold text-success">
            Записано. Диспетчер разберёт и назначит ремонт.
          </p>
        )}
        <div className="mt-3">
          <BigButton tone="ghost" onClick={() => {setOpen(true); setDone(false);}}>
            Сообщить о неисправности
          </BigButton>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>Что не так с машиной</PanelTitle>

      {error && <p className="mt-2 text-2xs font-semibold text-destructive">{error}</p>}

      <div className="mt-3 space-y-3">
        {crews.length > 1 && (
          <label className="block">
            <span className="text-2xs font-medium text-muted-foreground">Установка</span>
            <select
              value={equipmentId}
              onChange={(event) => setEquipmentId(event.target.value)}
              className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-base shadow-xs"
            >
              {crews.map((crew) => (
                <option key={crew.crewId} value={crew.equipmentId}>
                  {crew.equipmentName} · {crew.siteName}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="text-2xs font-medium text-muted-foreground">Что случилось</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Обрыв прядей троса на барабане"
            className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-base shadow-xs"
          />
        </label>

        <label className="block">
          <span className="text-2xs font-medium text-muted-foreground">Узел, если знаете</span>
          <input
            value={node}
            onChange={(event) => setNode(event.target.value)}
            placeholder="Грузовая лебёдка"
            className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-base shadow-xs"
          />
        </label>

        <div className="space-y-2">
          <span className="block text-2xs font-medium text-muted-foreground">Насколько срочно</span>
          {SEVERITIES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSeverity(option.value)}
              className={cn(
                'min-h-12 w-full rounded-lg border bg-card px-4 py-2 text-left shadow-xs transition-colors',
                severity === option.value ? 'border-signal bg-signal/10' : 'hover:bg-secondary',
              )}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="block text-2xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
          <p className="text-2xs text-muted-foreground">
            Уровень можно указать примерно: диспетчер уточнит при разборе.
          </p>
        </div>

        <label className="block">
          <span className="text-2xs font-medium text-muted-foreground">Подробности</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="Заметил при строповке, три пряди на середине каната"
            className="mt-1 w-full rounded-md border bg-card px-3 py-2 text-base shadow-xs"
          />
        </label>

        <BigButton onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? 'Записываем…' : 'Записать неисправность'}
        </BigButton>
        <BigButton tone="ghost" onClick={() => {setOpen(false); setError(null);}}>Отмена</BigButton>
      </div>
    </Panel>
  );
}
