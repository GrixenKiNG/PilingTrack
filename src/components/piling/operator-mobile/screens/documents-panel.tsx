'use client';

import {useState} from 'react';
import {ChevronDown, ChevronRight} from 'lucide-react';
import type {DocumentCheck} from '@/modules/operator-mobile/contracts';
import {documentsSummary} from '../safety/documents-summary';
import {Panel, PanelTitle, Sign} from '../ui';

/**
 * Документы работника — свёрнуты по умолчанию, раскрываются нажатием.
 *
 * ПОЧЕМУ СВЁРНУТЫ. Обязательных видов у машиниста одиннадцать, и все они, как
 * правило, в порядке. Раскрытый список занимал четыре экрана прокрутки и
 * отодвигал вниз то, ради чего экран открывают: шаги допуска. Свёрнутая строка
 * отвечает на тот же вопрос одной фразой, а список остаётся в одном нажатии —
 * на случай «когда у тебя кончается медкомиссия».
 *
 * ПОЧЕМУ НЕ `<details>`. Нужен собственный значок состояния в шапке: свёрнутая
 * строка обязана показывать, всё ли в порядке, иначе сворачивание прячет не
 * длину, а проблему.
 *
 * ПОЧЕМУ ЗДЕСЬ НИЧЕГО НЕЛЬЗЯ ИСПРАВИТЬ. Документы заводит администратор. Дать
 * машинисту править срок своей медкомиссии — значит сделать проверку допуска
 * бессмысленной.
 */

const VERDICT_TEXT: Record<DocumentCheck['verdict'], string> = {
  VALID: 'действует',
  EXPIRING: 'истекает',
  EXPIRED: 'просрочен',
  MISSING: 'не заведён',
};

function tone(verdict: DocumentCheck['verdict']): 'ok' | 'warning' | 'danger' {
  if (verdict === 'VALID') return 'ok';
  if (verdict === 'EXPIRING') return 'warning';
  return 'danger';
}

export function DocumentsPanel({documents}: {documents: DocumentCheck[]}) {
  const [open, setOpen] = useState(false);
  const summary = documentsSummary(documents);
  const headTone = summary.worst === null ? 'ok' : tone(summary.worst);

  // Обязательные наверху: их отсутствие задерживает смену, остальные — нет.
  const ordered = [...documents].sort((left, right) => (
    Number(right.required) - Number(left.required)
  ));

  return (
    <Panel tone={headTone === 'ok' ? 'plain' : headTone}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <Sign tone={headTone} />
        <span className="min-w-0 flex-1">
          <PanelTitle tone={headTone === 'ok' ? 'plain' : headTone}>
            Документы ({summary.total})
          </PanelTitle>
          <span className="mt-0.5 block text-2xs text-muted-foreground">{summary.note}</span>
        </span>
        {open
          ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      </button>

      {open ? (
        <ul className="mt-3 space-y-2">
          {ordered.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              Виды документов в справочнике не заведены. Проверять нечего — уточните у диспетчера.
            </li>
          ) : null}
          {ordered.map((document) => (
            <li key={document.typeId} className="flex gap-2 border-t pt-2 first:border-t-0 first:pt-0">
              <Sign tone={tone(document.verdict)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium leading-snug">{document.name}</span>
                  <span className="shrink-0 text-2xs font-semibold">
                    {document.verdict === 'EXPIRING' && document.daysLeft !== null
                      ? `${document.daysLeft} дн.`
                      : VERDICT_TEXT[document.verdict]}
                  </span>
                </span>
                <span className="mt-0.5 block text-2xs text-muted-foreground">
                  {document.required ? 'обязательный' : 'необязательный'}
                  {document.number ? ` · № ${document.number}` : ' · номер не указан'}
                  {document.expiresAt
                    ? ` · до ${new Date(document.expiresAt).toLocaleDateString('ru-RU')}`
                    : document.verdict === 'VALID' ? ' · бессрочный' : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
