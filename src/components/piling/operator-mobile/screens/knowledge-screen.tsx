'use client';

import {useEffect, useState} from 'react';
import {TOPIC_LABELS, type KnowledgeQuestion} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import {BigButton, ErrorNote, Panel, PanelTitle, Screen} from '../ui';

/**
 * Проверка знаний.
 *
 * ПОЧЕМУ ОШИБКА НЕ ЗАВАЛИВАЕТ ПОПЫТКУ. Цель — чтобы человек ушёл на площадку,
 * зная верный ответ, а не чтобы он не прошёл. Ошибся — показываем правильный
 * ответ, и вопрос возвращается в конец очереди, пока не будет отвечен верно.
 *
 * ПОЧЕМУ ВЕРНЫЙ ОТВЕТ ЗНАЕТ ЭКРАН. Чтобы показать его сразу, без обращения к
 * серверу на каждый вопрос: на площадке это лишние восемь запросов по одной
 * палке сети. Итог всё равно считает сервер по своему банку — в журнал уходит
 * то, что человек действительно нажал.
 */
interface KnowledgeScreenProps {
  busy: boolean;
  error: string | null;
  onDone: (picks: {questionId: string; picked: number}[], attemptToken: string) => void;
  onBack: () => void;
}
export function KnowledgeScreen(props: KnowledgeScreenProps) {
  const [attempt, setAttempt] = useState<{questions: KnowledgeQuestion[]; attemptToken: string} | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/operator/knowledge-attempt', {cache: 'no-store', signal: abort.signal})
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Не удалось получить вопросы');
        if (!abort.signal.aborted) setAttempt(body.data);
      }).catch(error => { if (!abort.signal.aborted) setLoadError(error.message); });
    return () => abort.abort();
  }, [retry]);
  if (!attempt) return <Screen title="Проверка знаний">
    <ErrorNote message={loadError} />
    {loadError ? <BigButton onClick={() => { setLoadError(null); setRetry(n => n + 1); }}>Повторить</BigButton> : <p>Получаем вопросы…</p>}
    <BigButton tone="ghost" onClick={props.onBack}>Назад</BigButton>
  </Screen>;
  return <KnowledgeAttempt {...props} attempt={attempt.questions} attemptToken={attempt.attemptToken} />;
}

function KnowledgeAttempt({busy, error, onDone, onBack, attempt, attemptToken}: KnowledgeScreenProps & {
  attempt: KnowledgeQuestion[]; attemptToken: string;
}) {
  const [queue, setQueue] = useState<KnowledgeQuestion[]>(attempt);
  const [picked, setPicked] = useState<number | null>(null);
  /**
   * По одному ответу на вопрос — последнему.
   *
   * Список всех нажатий подряд сюда не годится: вопрос с ошибкой повторяется,
   * и в отправку уходили бы обе попытки. Сервер, который требует верного
   * ответа на всё, отклонял бы такую проверку — экран показывал бы «пройдена»,
   * а записать результат было бы нельзя. Тупик, из которого оператор не
   * выберется никаким нажатием.
   */
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [mistakes, setMistakes] = useState(0);

  const question = queue[0];
  const answeredCount = attempt.length - queue.length;

  if (!question) {
    return (
      <Screen
        title="Проверка пройдена"
        subtitle={`${attempt.length} из ${attempt.length}${mistakes > 0 ? ` · ошибок по ходу: ${mistakes}` : ''}`}
        footer={(
          <BigButton onClick={() => onDone(Object.entries(picks).map(([questionId, value]) => ({questionId, picked: value})), attemptToken)} disabled={busy}>
            {busy ? 'Записываем…' : 'Записать результат'}
          </BigButton>
        )}
      >
        <Panel tone="ok">
          <PanelTitle tone="ok">Все ответы верные</PanelTitle>
          <p className="mt-1 text-sm">
            Результат действует 30 дней. Следующая проверка соберётся из других вопросов.
          </p>
        </Panel>
        <ErrorNote message={error} />
      </Screen>
    );
  }

  const submitAnswer = () => {
    if (picked === null) return;
    const correct = picked === question.correct;
    setPicks((current) => ({...current, [question.id]: picked}));
    setPicked(null);
    if (correct) {
      setQueue((current) => current.slice(1));
    } else {
      // Вопрос уходит в конец очереди: пока на него не ответят верно, проверка
      // не закончится. Верный ответ уже показан выше.
      setMistakes((count) => count + 1);
      setQueue((current) => [...current.slice(1), current[0]]);
    }
  };

  return (
    <Screen
      title="Проверка знаний"
      subtitle={`Вопрос ${answeredCount + 1} из ${attempt.length} · ${TOPIC_LABELS[question.topic]}`}
      footer={(
        <>
          <BigButton onClick={submitAnswer} disabled={picked === null}>
            {picked === null
              ? 'Выберите ответ'
              : picked === question.correct ? 'Верно, дальше' : 'Запомнил, дальше'}
          </BigButton>
          <BigButton tone="ghost" onClick={onBack}>Назад</BigButton>
        </>
      )}
    >
      <Panel>
        <p className="text-base font-semibold leading-snug">{question.text}</p>
      </Panel>

      <div className="space-y-2">
        {question.options.map((option, index) => {
          const revealed = picked !== null;
          const isCorrect = index === question.correct;
          const isPicked = index === picked;
          return (
            <button
              key={option}
              type="button"
              onClick={() => picked === null && setPicked(index)}
              className={cn(
                'w-full rounded-lg border bg-card p-3 text-left text-sm leading-snug shadow-xs transition-colors',
                !revealed && 'hover:bg-secondary',
                revealed && isCorrect && 'border-success bg-success/10 font-semibold text-success-strong',
                revealed && isPicked && !isCorrect && 'border-destructive bg-destructive/10 text-destructive-strong',
              )}
            >
              {option}
            </button>
          );
        })}
      </div>

      {picked !== null && picked !== question.correct ? (
        <Panel tone="warning">
          <PanelTitle tone="warning">Неверно</PanelTitle>
          <p className="mt-1 text-sm">Верный ответ отмечен зелёным. Этот вопрос повторится.</p>
        </Panel>
      ) : null}

      <ErrorNote message={error} />
    </Screen>
  );
}
