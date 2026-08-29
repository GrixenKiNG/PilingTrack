'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction, OperatorWorkplace} from '../api/contracts';

type Inspection = OperatorWorkplace['inspections'][number];
type DraftAnswer = {result: string; value: string; note: string; photoCount: number};

const resultOptions: Record<Inspection['items'][number]['answerType'], Array<{value: string; label: string}>> = {
  YES_NO: [{value: 'YES', label: 'В норме'}, {value: 'NO', label: 'Неисправность'}, {value: 'NA', label: 'Не применяется'}],
  STATUS4: [{value: 'OK', label: 'В норме'}, {value: 'WARN', label: 'Есть замечание'}, {value: 'FAIL', label: 'Неисправность'}, {value: 'NA', label: 'Не применяется'}],
  DONE: [{value: 'DONE', label: 'Выполнено'}, {value: 'NO', label: 'Не выполнено'}, {value: 'NA', label: 'Не применяется'}],
  MEASURE: [{value: 'YES', label: 'Измерено'}],
};

export function InspectionForm({inspection, action, onAction}: {inspection: Inspection; action: OperatorAction; onAction: (action: OperatorAction, payload: Record<string, unknown>) => void}) {
  const initial = Object.fromEntries(inspection.answers.map((answer) => [answer.itemId, {
    result: answer.result, value: answer.value ?? '', note: answer.note ?? '', photoCount: answer.photoCount,
  }]));
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>(initial);
  const [page, setPage] = useState(0);
  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(inspection.items.length / pageSize));
  const visibleItems = inspection.items.slice(page * pageSize, (page + 1) * pageSize);
  const update = (itemId: string, patch: Partial<DraftAnswer>) => setAnswers((current) => ({
    ...current,
    [itemId]: {...(current[itemId] ?? {result: '', value: '', note: '', photoCount: 0}), ...patch},
  }));
  const missing = inspection.items.filter((item) => item.required && !answers[item.id]?.result).length;

  if (action.id === 'complete-inspection') {
    return <div className="rounded-lg border bg-background p-4"><p className="font-medium">Все обязательные пункты заполнены</p><p className="mt-1 text-sm text-muted-foreground">Проверьте ответы и завершите проверку.</p><Button className="mt-4 min-h-11" onClick={() => onAction(action, {inspectionId: inspection.id})}>Завершить проверку</Button></div>;
  }

  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault();
    onAction(action, {
      inspectionId: inspection.id,
      answers: inspection.items.flatMap((item) => answers[item.id] ? [{itemId: item.id, ...answers[item.id]}] : []),
    });
  }}>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Пункты проверки</p><p className="text-sm text-muted-foreground">Показаны {page * pageSize + 1}-{Math.min((page + 1) * pageSize, inspection.items.length)} из {inspection.items.length}. Заполнено {Object.values(answers).filter((answer) => answer.result).length}.</p></div><span className="text-sm font-medium">Осталось обязательных: {missing}</span></div>
    {visibleItems.map((item, visibleIndex) => {
      const index = page * pageSize + visibleIndex;
      const answer = answers[item.id] ?? {result: '', value: '', note: '', photoCount: 0};
      return <fieldset key={item.id} className="rounded-lg border bg-background p-4"><legend className="px-1 text-sm font-semibold">{index + 1}. {item.text}{item.required ? ' *' : ''}</legend>{item.norm && <p className="mb-3 text-xs text-muted-foreground">Норма: {item.norm}</p>}
        {item.answerType === 'MEASURE' && <div className="mb-3"><label className="text-sm" htmlFor={`measure-${item.id}`}>Измеренное значение{item.unit ? `, ${item.unit}` : ''}</label><Input id={`measure-${item.id}`} inputMode="decimal" className="mt-1 max-w-56" value={answer.value} onChange={(event) => update(item.id, {value: event.target.value, result: event.target.value.trim() ? 'YES' : ''})} /></div>}
        {item.answerType !== 'MEASURE' && <div className="grid gap-2 sm:grid-cols-2">{resultOptions[item.answerType].map((option) => <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm has-[:checked]:border-signal has-[:checked]:bg-signal/5"><input type="radio" name={`result-${item.id}`} value={option.value} checked={answer.result === option.value} onChange={() => update(item.id, {result: option.value})} />{option.label}</label>)}</div>}
        {answer.result && !['YES', 'OK', 'DONE'].includes(answer.result) && <Textarea aria-label={`Пояснение: ${item.text}`} className="mt-3" placeholder="Опишите наблюдение или причину" value={answer.note} onChange={(event) => update(item.id, {note: event.target.value})} />}
        {item.photoRequired && <label className="mt-3 block text-sm">Фотография обязательна<Input type="file" accept="image/*" className="mt-1" onChange={(event) => update(item.id, {photoCount: event.target.files?.length ?? 0})} /></label>}
      </fieldset>;
    })}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><Button type="button" variant="outline" className="min-h-11" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Назад</Button>{page < pageCount - 1 ? <Button type="button" className="min-h-11" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Далее</Button> : <Button type="submit" className="min-h-12">Сохранить проверку</Button>}</div>
  </form>;
}
