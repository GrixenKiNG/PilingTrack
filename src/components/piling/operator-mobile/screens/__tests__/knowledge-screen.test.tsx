import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {KnowledgeQuestion} from '@/modules/operator-mobile/contracts';
import {KnowledgeScreen, isKnowledgeAttemptExpired} from '../knowledge-screen';

/** Тот же текст, что отдаёт сервер на просроченный токен попытки (admission.ts:314). */
const ATTEMPT_EXPIRED = 'Набор вопросов неполный или попытка истекла. Начните проверку заново.';

/** Набор из восьми вопросов с верным ответом на первом месте. */
function questions(): KnowledgeQuestion[] {
  return Array.from({length: 8}, (_, index) => ({
    id: `q-${index}`,
    topic: 'GENERAL',
    text: `Вопрос ${index + 1}`,
    options: ['Верный', 'Неверный'],
    correct: 0,
  }));
}

function stubAttempt(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(
    JSON.stringify({data: {questions: questions(), attemptToken: 'token-1'}}),
    {status: 200},
  ));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Отвечает верно на весь набор: проверка доходит до итогового экрана. */
function answerAll() {
  for (let answered = 0; answered < 8; answered += 1) {
    fireEvent.click(screen.getByRole('button', {name: 'Верный'}));
    fireEvent.click(screen.getByRole('button', {name: 'Верно, дальше'}));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('загрузка вопросов', () => {
  it('успешный ответ — вопросы на экране', async () => {
    stubAttempt();
    render(<KnowledgeScreen busy={false} error={null} onDone={vi.fn()} onBack={vi.fn()} />);
    expect(await screen.findByText('Вопрос 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Повторить'})).not.toBeInTheDocument();
  });

  /*
    Страница-перехватчик Wi‑Fi и HTML-ошибка прокси отвечают не нашим JSON.
    Раньше экран разбирал ответ до проверки статуса и показывал машинисту
    английское «Unexpected token '<'…» (аудит R76, находка 16).
  */
  it('HTML вместо JSON при 200 — русский текст, а не английский разбор', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<!doctype html><html><body>Вход в сеть отеля</body></html>',
      {status: 200, headers: {'Content-Type': 'text/html'}},
    )));
    render(<KnowledgeScreen busy={false} error={null} onDone={vi.fn()} onBack={vi.fn()} />);

    expect(await screen.findByText(/не от сервера приложения/)).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected token/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
  });

  it('HTML-ошибка прокси со статусом 502 — русский отказ, без английского разбора', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><head><title>502 Bad Gateway</title></head></html>',
      {status: 502, headers: {'Content-Type': 'text/html'}},
    )));
    render(<KnowledgeScreen busy={false} error={null} onDone={vi.fn()} onBack={vi.fn()} />);

    expect(await screen.findByText('Сервер временно недоступен (код 502). Запись сохранена — отправим автоматически.')).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected token/i)).not.toBeInTheDocument();
  });

  // Истёкшая сессия — не повод предлагать «Повторить»: тот же запрос отклонят
  // тем же 401. Уводим на вход, как на загрузке состояния рабочего места.
  it('401 уводит на вход', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({error: 'Войдите в систему'}),
      {status: 401},
    )));
    render(<KnowledgeScreen busy={false} error={null} onDone={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(screen.queryByRole('button', {name: 'Повторить'})).not.toBeInTheDocument();
  });
});

describe('итог проверки знаний при просроченной попытке', () => {
  it('объясняет, что время вышло, и даёт начать заново вместо повтора отправки', async () => {
    const fetchMock = stubAttempt();
    const onDone = vi.fn();
    const onRestart = vi.fn();
    const {rerender} = render(
      <KnowledgeScreen busy={false} error={null} onDone={onDone} onBack={vi.fn()} />,
    );
    await screen.findByText('Вопрос 1');
    answerAll();

    expect(screen.getByText('Проверка пройдена')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Записать результат'}));
    expect(onDone).toHaveBeenCalledWith(expect.any(Array), 'token-1');

    // Рабочее место получило 400 «попытка истекла» и сообщает об этом экрану.
    rerender(
      <KnowledgeScreen busy={false} error={ATTEMPT_EXPIRED} expired onRestart={onRestart} onDone={onDone} onBack={vi.fn()} />,
    );

    expect(screen.getByText('Время на проверку вышло (30 минут)')).toBeInTheDocument();
    expect(screen.getByText('Начните проверку заново — вопросы будут другие.')).toBeInTheDocument();
    // Повторять отправку бессмысленно: тот же токен даст тот же отказ.
    expect(screen.queryByRole('button', {name: 'Записать результат'})).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Начать заново'}));

    expect(onRestart).toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // Новая попытка — новый запрос вопросов, и экран снова спрашивает с первого.
    expect(await screen.findByText('Вопрос 1')).toBeInTheDocument();
  });
});

describe('итог проверки знаний при прочей ошибке', () => {
  it('показывает прежний отказ и оставляет кнопку отправки', async () => {
    stubAttempt();
    const onDone = vi.fn();
    const onRestart = vi.fn();
    const {rerender} = render(
      <KnowledgeScreen busy={false} error={null} onDone={onDone} onBack={vi.fn()} />,
    );
    await screen.findByText('Вопрос 1');
    answerAll();

    rerender(
      <KnowledgeScreen busy={false} error="Некорректная команда" onRestart={onRestart} onDone={onDone} onBack={vi.fn()} />,
    );

    expect(screen.getByText('Некорректная команда')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Записать результат'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Начать заново'})).not.toBeInTheDocument();
    expect(onRestart).not.toHaveBeenCalled();
  });
});

describe('признак просроченной попытки', () => {
  it('узнаёт отказ по 400 и тексту о просрочке', () => {
    expect(isKnowledgeAttemptExpired({status: 400, message: ATTEMPT_EXPIRED})).toBe(true);
  });

  it('не считает просрочкой ни другой 400, ни 500', () => {
    expect(isKnowledgeAttemptExpired({status: 400, message: 'Некорректная команда'})).toBe(false);
    expect(isKnowledgeAttemptExpired({status: 500, message: ATTEMPT_EXPIRED})).toBe(false);
  });
});
