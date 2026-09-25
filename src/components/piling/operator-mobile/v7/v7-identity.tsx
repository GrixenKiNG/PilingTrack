'use client';

import {useEffect, useState} from 'react';
import type {KnowledgeQuestion} from '@/modules/operator-mobile/contracts';
import {PPE_ITEMS, SAFETY_BRIEFING, TOPIC_LABELS} from '@/modules/operator-mobile/contracts';

/**
 * Текст инструктажа: у машиниста свой, у помощника свой (стропальные работы).
 *
 * Описан формой, а не как `typeof SAFETY_BRIEFING`: оба текста объявлены через
 * `as const`, и тип по образцу одного требовал бы от другого тех же самых строк
 * — «И-СМ-06» не подходил под «И-СМ-04».
 */
export interface BriefingText {
  code: string;
  title: string;
  readingMinutes: number;
  sections: readonly {id: string; title: string; rules: readonly string[]}[];
}
import {Banner, Button, Card, CardBody, Chip, Pick, Title} from './v7-ui';

/**
 * Шаги допуска: СИЗ, ознакомление с инструкцией, проверка знаний.
 *
 * Порядок здесь не удобство, а безопасность: СИЗ идёт первым, потому что
 * проверять каску после проверки знаний поздно — человек уже мысленно на
 * площадке. Сам порядок держит сервер (`derivePhase`), экран лишь ведёт.
 */

/* ----------------------------------------------------------------- СИЗ --- */

export function PpeFlow({busy, confirmed, onConfirm, onBack}: {
  busy: boolean;
  confirmed: string[];
  onConfirm: (items: string[]) => void;
  onBack: () => void;
}) {
  const [items, setItems] = useState<string[]>(confirmed.length > 0
    ? confirmed
    : PPE_ITEMS.map((item) => item.code));

  const toggle = (code: string) => setItems((current) => (
    current.includes(code) ? current.filter((value) => value !== code) : [...current, code]
  ));
  const missing = PPE_ITEMS.filter((item) => !items.includes(item.code));

  return (
    <>
      <Title note="Комплект отмечен полностью — снимите отметку с того, чего нет или что неисправно.">
        Средства защиты
      </Title>
      <div className="body">
        <Card>
          <CardBody>
            <div className="picks">
              {PPE_ITEMS.map((item) => (
                <Pick key={item.code} box on={items.includes(item.code)} onClick={() => toggle(item.code)}>
                  <span className="rb">
                    <span className="t">{item.label}</span>
                    <span className="s">{item.hint}</span>
                  </span>
                </Pick>
              ))}
            </div>
          </CardBody>
        </Card>

        {missing.length > 0 ? (
          <Banner
            tone="warn"
            title={`Не хватает: ${missing.map((item) => item.label).join(', ')}`}
            note="Запишем как есть. Врать экрану опаснее, чем работать без перчаток. Пока не получите недостающее, выработку записать нельзя — простой и происшествия записываются как обычно."
          />
        ) : null}

        <Button disabled={busy} onClick={() => onConfirm(items)}>
          {busy
            ? 'Записываем…'
            : missing.length === 0 ? 'Комплект в порядке' : `Подтвердить (нет: ${missing.length})`}
        </Button>
        <Button tone="ghost" onClick={onBack}>Назад</Button>
      </div>
    </>
  );
}

/* -------------------------------------------------------- ознакомление --- */

export function BriefingFlow({busy, version, text = SAFETY_BRIEFING, onAcknowledge, onBack}: {
  busy: boolean;
  version: string;
  text?: BriefingText;
  onAcknowledge: () => void;
  onBack: () => void;
}) {
  const [read, setRead] = useState(false);
  return (
    <>
      <Title note={`${text.code} · версия ${version} · чтение ${text.readingMinutes} мин`}>
        {text.title}
      </Title>
      <div className="body">
        {text.sections.map((section) => (
          <Card key={section.id} title={section.title}>
            <CardBody>
              {section.rules.map((rule) => (
                <div key={rule} className="note" style={{color: 'var(--ink)', fontSize: 16}}>{rule}</div>
              ))}
            </CardBody>
          </Card>
        ))}

        <Pick box on={read} onClick={() => setRead((value) => !value)}>
          Я ознакомился с инструкцией, понимаю требования и обязуюсь их соблюдать
        </Pick>

        <Button disabled={busy || !read} onClick={onAcknowledge}>
          {busy ? 'Записываем…' : 'Ознакомлен'}
        </Button>
        <Button tone="ghost" onClick={onBack}>Назад</Button>
      </div>
    </>
  );
}

/* ----------------------------------------------------- проверка знаний --- */

interface Attempt {
  questions: KnowledgeQuestion[];
  attemptToken: string;
}

/**
 * Проверка знаний.
 *
 * ПОЧЕМУ ОШИБКА НЕ ЗАВАЛИВАЕТ ПОПЫТКУ. Цель — чтобы человек ушёл на площадку,
 * зная верный ответ, а не чтобы он не прошёл. Ошибся — показываем правильный
 * ответ, и вопрос возвращается в конец очереди. Итог всё равно считает сервер
 * по своему банку: в журнал уходит то, что человек действительно нажал.
 */
export function KnowledgeFlow({busy, onDone, onBack}: {
  busy: boolean;
  onDone: (picks: {questionId: string; picked: number}[], attemptToken: string) => void;
  onBack: () => void;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [again, setAgain] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/operator/knowledge-attempt', {cache: 'no-store', signal: abort.signal})
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Не удалось получить вопросы');
        if (!abort.signal.aborted) setAttempt(payload.data as Attempt);
      })
      .catch((error: Error) => {
        if (!abort.signal.aborted) setLoadError(error.message);
      });
    return () => abort.abort();
  }, [again]);

  if (!attempt) {
    return (
      <>
        <Title>Проверка знаний по ТБ</Title>
        <div className="body">
          {loadError
            ? <Banner tone="bad" title="Вопросы не получены" note={loadError} />
            : <div className="empty">Получаем вопросы…</div>}
          {loadError ? (
            <Button onClick={() => { setLoadError(null); setAgain((value) => value + 1); }}>Повторить</Button>
          ) : null}
          <Button tone="ghost" onClick={onBack}>Назад</Button>
        </div>
      </>
    );
  }

  return <KnowledgeRun attempt={attempt} busy={busy} onDone={onDone} onBack={onBack} />;
}

function KnowledgeRun({attempt, busy, onDone, onBack}: {
  attempt: Attempt;
  busy: boolean;
  onDone: (picks: {questionId: string; picked: number}[], attemptToken: string) => void;
  onBack: () => void;
}) {
  const total = attempt.questions.length;
  const [queue, setQueue] = useState<KnowledgeQuestion[]>(attempt.questions);
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  /**
   * По одному ответу на вопрос — последнему. Список всех нажатий подряд сюда не
   * годится: вопрос с ошибкой повторяется, и в отправку ушли бы обе попытки, а
   * сервер, требующий верного ответа на всё, такую проверку отклонит.
   */
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [mistakes, setMistakes] = useState(0);

  const question = queue[0];

  if (!question) {
    return (
      <>
        <Title note={`${total} из ${total}${mistakes > 0 ? ` · ошибок по ходу: ${mistakes}` : ''}`}>
          Проверка пройдена
        </Title>
        <div className="body">
          <Card>
            <CardBody>
              <div className="seal" aria-hidden="true">✓</div>
              <div style={{textAlign: 'center', fontWeight: 700}}>Все ответы верные</div>
            </CardBody>
          </Card>
          <Button
            disabled={busy}
            onClick={() => onDone(
              Object.entries(picks).map(([questionId, value]) => ({questionId, picked: value})),
              attempt.attemptToken,
            )}
          >
            {busy ? 'Записываем…' : 'Записать результат'}
          </Button>
        </div>
      </>
    );
  }

  const answered = total - queue.length;
  const correct = picked !== null && picked === question.correct;

  const next = () => {
    if (picked === null) return;
    setPicks((current) => ({...current, [question.id]: picked}));
    if (picked === question.correct) {
      setQueue((current) => current.slice(1));
    } else {
      setMistakes((value) => value + 1);
      setQueue((current) => [...current.slice(1), question]);
    }
    setPicked(null);
    setShown(false);
  };

  return (
    <>
      <Title note={`Вопрос ${answered + 1} из ${total} · ${TOPIC_LABELS[question.topic]}`}>
        Проверка знаний по ТБ
      </Title>
      <div className="body">
        <div className="bar"><i style={{width: `${Math.round((answered / total) * 100)}%`}} /></div>

        <Card>
          <CardBody>
            <div style={{fontSize: 16, fontWeight: 700, lineHeight: 1.3}}>{question.text}</div>
            <div className="picks">
              {question.options.map((option, index) => (
                <Pick
                  key={option}
                  on={picked === index}
                  onClick={() => { if (!shown) setPicked(index); }}
                >
                  {option}
                </Pick>
              ))}
            </div>
          </CardBody>
        </Card>

        {shown ? (
          <Banner
            tone={correct ? 'ok' : 'warn'}
            title={correct ? 'Верно' : 'Неверно'}
            note={correct ? undefined : `Правильный ответ: ${question.options[question.correct]}`}
            action={correct ? undefined : 'Вопрос вернётся в конец — ответите ещё раз'}
          />
        ) : (
          <Banner tone="info" title="Выберите один правильный вариант" />
        )}

        <div className="btn-row">
          <Button tone="ghost" onClick={onBack}>Назад</Button>
          {shown
            ? <Button onClick={next}>Далее</Button>
            : <Button disabled={picked === null} onClick={() => setShown(true)}>Ответить</Button>}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------- итог допуска --- */

export function AdmissionResult({steps, operatorName, productionDate, onWork}: {
  steps: {label: string; done: boolean; note: string}[];
  operatorName: string;
  productionDate: string;
  onWork: () => void;
}) {
  const allDone = steps.every((step) => step.done);
  return (
    <div className="body">
      <Card>
        <CardBody>
          {allDone ? <div className="seal" aria-hidden="true">✓</div> : null}
          <div style={{textAlign: 'center', fontSize: 17, fontWeight: 800}}>
            {allDone ? 'Вы допущены к смене!' : 'Допуск не завершён'}
          </div>
          <div style={{textAlign: 'center', color: allDone ? 'var(--green)' : 'var(--muted)'}}>
            {allDone ? 'Все этапы успешно пройдены' : 'Пройдите оставшиеся шаги'}
          </div>
        </CardBody>
        {steps.map((step) => (
          <div className="row" key={step.label}>
            <span className="num" style={{background: step.done ? 'var(--green)' : '#b9c3cf'}}>
              {step.done ? '✓' : '—'}
            </span>
            <span className="rb"><span className="t">{step.label}</span></span>
            <Chip tone={step.done ? 'ok' : 'muted'}>{step.note}</Chip>
          </div>
        ))}
        <CardBody>
          <div className="pair">
            <span className="pl">{operatorName}</span>
            <span className="pv">допуск на {productionDate}</span>
          </div>
        </CardBody>
      </Card>
      {allDone ? <Button onClick={onWork}>Режим работы</Button> : null}
    </div>
  );
}
