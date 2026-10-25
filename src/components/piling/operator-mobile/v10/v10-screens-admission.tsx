import { type Go, ppeOutcome } from "./v10-shared";
import { useEffect, useState } from 'react';
import type { OperatorMobileState } from '@/modules/operator-mobile';
import { PPE_ITEMS, SAFETY_BRIEFING, TOPIC_LABELS } from '@/modules/operator-mobile/client';
import type {KnowledgeQuestion} from '@/modules/operator-mobile';
import { Banner, Card, Nodata, Row } from './v10-ui';

/**
 * СИЗ: отмечают ОТСУТСТВИЕ, нехватка записывается как есть и не запирает экран.
 *
 * ПОЧЕМУ ГАЛОЧКИ СТОЯТ ЗАРАНЕЕ. У работника, вышедшего на смену, комплект
 * обычно полон, и шесть обязательных нажатий в шесть утра превращаются в
 * шесть нажатий не глядя. Снимать отметку человек будет осознанно.
 *
 * ПОЧЕМУ ПОДПИСЬ ПЕРЕПИСАНА. Стояло «Отметьте то, что у вас есть» — при уже
 * расставленных галочках это читается как «пройдитесь по списку», и человек,
 * добросовестно нажав на каждую строку, СНИМАЛ весь комплект. Подтверждение
 * уходило с пометкой «не хватает каски». Экран должен просить то, что делает.
 */
export function ScreenPpe({state, busy, onConfirm, go}: {
  state: OperatorMobileState;
  busy: boolean;
  onConfirm: (items: string[]) => void;
  go: Go;
}) {
  const [items, setItems] = useState<string[]>(
    state.identity.ppe.confirmed && state.identity.ppe.items.length > 0
      ? state.identity.ppe.items
      : PPE_ITEMS.map((item) => item.code),
  );
  const missing = PPE_ITEMS.filter((item) => !items.includes(item.code));
  const toggle = (code: string) => setItems((current) => (
    current.includes(code) ? current.filter((value) => value !== code) : [...current, code]
  ));
  /* Итог показываем, только когда комплект уже подтверждён: до подтверждения
     «СИЗ подтверждены» — обещание, которого человек ещё не давал. */
  const outcome = state.identity.ppe.confirmed ? ppeOutcome(state) : null;

  return (
    <>
      <Card title="Комплект отмечен полностью — снимите отметку с того, чего нет">
        {PPE_ITEMS.map((item) => (
          <Row
            key={item.code}
            icon={items.includes(item.code) ? 'check' : 'minus'}
            tone={items.includes(item.code) ? 'ok' : 'bad'}
            title={item.label}
            note={item.hint}
            onClick={() => toggle(item.code)}
          />
        ))}
      </Card>
      {missing.length > 0 ? (
        <Banner tone="warn" title={`Не хватает: ${missing.map((item) => item.label).join(', ')}`}>
          {' '}Запишем как есть. Пока не получите недостающее, выработку записать
          нельзя — простой и происшествия записываются как обычно.
        </Banner>
      ) : null}
      {outcome ? (
        <Card>
          <Row icon="check" tone="ok" title={outcome.title} note={outcome.note} />
        </Card>
      ) : null}
      <button type="button" className="ov10-btn" disabled={busy} onClick={() => onConfirm(items)}>
        {busy ? 'Записываем…'
          : missing.length === 0 ? 'Комплект в порядке'
            : `Подтвердить (нет: ${missing.length})`}
      </button>
      {outcome ? (
        <button type="button" className="ov10-btn green" onClick={() => go(outcome.screen)}>Далее</button>
      ) : null}
    </>
  );
}

/** Ознакомление с инструкцией: текст целиком, затем отметка. */
export function ScreenBriefing({state, busy, onAcknowledge}: {
  state: OperatorMobileState;
  busy: boolean;
  onAcknowledge: () => void;
}) {
  const [read, setRead] = useState(false);
  const {briefing} = state.identity;
  return (
    <>
      <Card>
        <Row icon="doc" tone={briefing.ok ? 'ok' : 'warn'} title={SAFETY_BRIEFING.title}
          note={`${SAFETY_BRIEFING.code} · версия ${briefing.version} · чтение ${SAFETY_BRIEFING.readingMinutes} мин`} />
      </Card>
      {SAFETY_BRIEFING.sections.map((section) => (
        <Card key={section.id} title={section.title}>
          {section.rules.map((rule) => (
            <div className="ov10-item" key={rule}><div className="t">{rule}</div></div>
          ))}
        </Card>
      ))}
      <Card>
        <Row
          icon={read ? 'check' : 'minus'}
          tone={read ? 'ok' : ''}
          title="Я ознакомился с инструкцией"
          note="понимаю требования и обязуюсь их соблюдать"
          onClick={() => setRead((value) => !value)}
        />
      </Card>
      <button type="button" className="ov10-btn" disabled={busy || !read} onClick={onAcknowledge}>
        {busy ? 'Записываем…' : 'Ознакомлен'}
      </button>
    </>
  );
}

interface Attempt {questions: KnowledgeQuestion[]; attemptToken: string}

/**
 * Проверка знаний.
 *
 * Ошибка не заваливает попытку: показываем верный ответ, вопрос возвращается в
 * конец очереди. Цель — чтобы человек ушёл на площадку, зная правило, а не
 * чтобы он не прошёл. Итог всё равно считает сервер по своему банку.
 */
export function ScreenKnowledge({busy, onDone}: {
  busy: boolean;
  onDone: (picks: {questionId: string; picked: number}[], attemptToken: string) => void;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<KnowledgeQuestion[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  const [picks, setPicks] = useState<Record<string, number>>({});

  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/operator/knowledge-attempt', {cache: 'no-store', signal: abort.signal})
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Не удалось получить вопросы');
        if (abort.signal.aborted) return;
        setAttempt(payload.data as Attempt);
        setQueue((payload.data as Attempt).questions);
      })
      .catch((cause: Error) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, []);

  if (error) return <Card><Nodata>{error}</Nodata></Card>;
  if (!attempt) return <Card><Nodata>Получаем вопросы…</Nodata></Card>;

  const total = attempt.questions.length;
  const question = queue[0];

  if (!question) {
    return (
      <>
        <Card><Row icon="check" tone="ok" title="Все ответы верные" note={`${total} из ${total}`} /></Card>
        <button
          type="button"
          className="ov10-btn green"
          disabled={busy}
          onClick={() => onDone(
            Object.entries(picks).map(([questionId, value]) => ({questionId, picked: value})),
            attempt.attemptToken,
          )}
        >
          {busy ? 'Записываем…' : 'Записать результат'}
        </button>
      </>
    );
  }

  const answered = total - queue.length;
  const correct = picked !== null && picked === question.correct;
  const next = () => {
    if (picked === null) return;
    setPicks((current) => ({...current, [question.id]: picked}));
    setQueue((current) => (picked === question.correct
      ? current.slice(1)
      : [...current.slice(1), question]));
    setPicked(null);
    setShown(false);
  };

  return (
    <>
      <Card title={`Вопрос ${answered + 1} из ${total} · ${TOPIC_LABELS[question.topic]}`}>
        <div className="ov10-item">
          <div className="t">{question.text}</div>
        </div>
        {question.options.map((option, index) => (
          <Row
            key={option}
            icon={picked === index ? 'check' : 'minus'}
            tone={picked === index ? 'ok' : ''}
            title={option}
            onClick={shown ? undefined : () => setPicked(index)}
          />
        ))}
      </Card>
      {shown
        ? (
          <Banner tone={correct ? 'info' : 'warn'} title={correct ? 'Верно' : 'Неверно'}>
            {correct ? '' : ` Правильный ответ: ${question.options[question.correct]}. Вопрос вернётся в конец.`}
          </Banner>
        )
        : <Banner tone="info" title="Выберите один правильный вариант" />}
      {shown
        ? <button type="button" className="ov10-btn" onClick={next}>Далее</button>
        : (
          <button type="button" className="ov10-btn" disabled={picked === null} onClick={() => setShown(true)}>
            Ответить
          </button>
        )}
    </>
  );
}
