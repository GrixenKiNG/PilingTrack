'use client';

import {useEffect, useState} from 'react';
import {TOPIC_LABELS, type KnowledgeQuestion} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import {ApiError, fetchKnowledgeAttempt, operatorErrorText} from '../api';
import {BigButton, ErrorNote, Panel, PanelTitle, Screen} from '../ui';

/** Часть серверного текста просроченной попытки (`admission.ts:314`). */
const ATTEMPT_EXPIRED_MARK = 'попытка истекла';

/**
 * Отказ «попытка просрочена» — им одним просроченная проверка и отличается.
 *
 * Кода ошибки сервер не присылает (`api/operator/mobile/command/route.ts`
 * отдаёт только `error` и `details`), поэтому примета — статус 400 вместе с
 * текстом отказа `admission.ts:314`. По одному 400 не развести: тем же кодом
 * отвечает и схема маршрута («Некорректная команда»), и другие правила.
 */
export function isKnowledgeAttemptExpired(error: {status: number; message: string}): boolean {
  return error.status === 400 && error.message.includes(ATTEMPT_EXPIRED_MARK);
}

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
  /** Попытка просрочена: повтор отправки даст тот же отказ, нужна новая. */
  expired?: boolean;
  /**
   * Новая попытка взята: рабочее место снимает прежний отказ, иначе его текст
   * остался бы на экране поверх новых вопросов.
   */
  onRestart?: () => void;
  onDone: (picks: {questionId: string; picked: number}[], attemptToken: string) => void;
  onBack: () => void;
}
export function KnowledgeScreen(props: KnowledgeScreenProps) {
  const [attempt, setAttempt] = useState<{questions: KnowledgeQuestion[]; attemptToken: string} | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    // Тем же путём, что и остальные запросы экрана: сначала статус, потом
    // разбор (`api.ts`). Раньше здесь `response.json()` шёл до проверки `ok`, и
    // страница-перехватчик Wi‑Fi отдавала машинисту английское «Unexpected
    // token '<'…» (аудит R76, находка 16).
    void fetchKnowledgeAttempt(abort.signal)
      .then((loaded) => { if (!abort.signal.aborted) setAttempt(loaded); })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        // Сессия истекла — как на загрузке состояния (`operator-mobile-app.tsx`):
        // «Повторить» здесь повторяло бы запрос, который отклонит тот же 401.
        if (error instanceof ApiError && error.status === 401) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- намеренно: сессия истекла, полная перезагрузка сбрасывает кэш маршрутов и память вкладки прежнего входа
          window.location.href = '/login';
          return;
        }
        setLoadError(operatorErrorText(error));
      });
    return () => abort.abort();
  }, [retry]);
  /**
   * Новая попытка вместо просроченной.
   *
   * Токен попытки живёт 30 минут (`modules/operator-mobile/application/
   * knowledge-attempt.ts:17`), и просроченную отправку нельзя ни повторить, ни
   * поправить: сервер откажет на тот же токен сколько угодно раз. Выход один —
   * взять новый набор тем же запросом, каким он берётся при входе на экран.
   */
  const restart = () => {
    setLoadError(null);
    setAttempt(null);
    setRetry((count) => count + 1);
    props.onRestart?.();
  };
  if (!attempt) return <Screen title="Проверка знаний">
    <ErrorNote message={loadError} />
    {loadError ? <BigButton onClick={() => { setLoadError(null); setRetry(n => n + 1); }}>Повторить</BigButton> : <p>Получаем вопросы…</p>}
    <BigButton tone="ghost" onClick={props.onBack}>Назад</BigButton>
  </Screen>;
  return <KnowledgeAttempt {...props} attempt={attempt.questions} attemptToken={attempt.attemptToken} onRestart={restart} />;
}

function KnowledgeAttempt({busy, error, expired = false, onDone, onBack, attempt, attemptToken, onRestart}: KnowledgeScreenProps & {
  attempt: KnowledgeQuestion[]; attemptToken: string;
  /** Новая попытка: перечитать вопросы (см. `restart` в KnowledgeScreen). */
  onRestart: () => void;
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
        footer={expired ? (
          /*
            Токен попытки просрочен, и повтор отправки дал бы тот же отказ —
            кнопка «Записать результат» здесь была бы тупиком без единого
            выхода, кроме перезагрузки страницы (находка R76 №1).
          */
          <BigButton onClick={onRestart}>Начать заново</BigButton>
        ) : (
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
        {expired ? (
          <Panel tone="danger">
            <PanelTitle tone="danger">Время на проверку вышло (30 минут)</PanelTitle>
            <p className="mt-1 text-sm">
              Начните проверку заново — вопросы будут другие.
            </p>
          </Panel>
        ) : (
          <ErrorNote message={error} />
        )}
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
