'use client';

import {useCallback, useRef, useState} from 'react';
import {elementLabel, PHASES, resolveTarget} from './flow';
import {SCREENS, type ScreenId} from './screens';

/**
 * Ответы, которые оператор выбирает прямо на экране: «Норма/Дефект», «Да/Нет»,
 * варианты теста, переключатели. Выбор меняется в самом узле, а не через
 * состояние React, и это осознанно: разметка экранов пришла из макета дословно
 * и не размечена идентификаторами, за которые можно было бы держать состояние.
 * Переключение живёт ровно до смены экрана — React смонтирует экран заново, и
 * выбор вернётся к макетному.
 */
function toggleChoice(node: HTMLElement, selected: string) {
  const group = node.parentElement;
  if (!group) return;
  for (const sibling of Array.from(group.children)) {
    sibling.classList.remove(selected);
  }
  node.classList.add(selected);
}

/**
 * Цифровая клавиатура. Одна на все экраны ввода: код входа, моточасы, объём
 * долива, глубина проходки, правка строки отчёта. Значение лежит в `.bignum`
 * над клавишами — там же, где его показывает макет.
 */
function pressKey(screen: HTMLElement, key: string): 'submit' | 'handled' | 'ignored' {
  const display = screen.querySelector<HTMLElement>('.bignum');
  if (!display) return 'ignored';
  if (key === '✓') return 'submit';

  // Экран входа отличается от остальных вводов: там не число, а четыре точки.
  const isCode = display.dataset.kind === 'code'
    || (display.dataset.kind === undefined && (display.textContent ?? '').includes('•'));
  display.dataset.kind = isCode ? 'code' : 'number';

  const entered = display.dataset.entry ?? '';
  if (key === '⌫') {
    display.dataset.entry = entered.slice(0, -1);
  } else if (isCode && entered.length >= 4) {
    return 'handled';
  } else {
    display.dataset.entry = entered + key;
  }

  const value = display.dataset.entry ?? '';
  display.textContent = isCode
    ? Array.from({length: 4}, (_, position) => (position < value.length ? '•' : '·')).join(' ')
    : value || '0';
  return 'handled';
}

/**
 * Подпись элемента для поиска перехода.
 *
 * В строках макета подпись отделена от пояснения тегом `<br>`, поэтому текст
 * читается до первого переноса. `innerText` сделал бы это сам, но он требует
 * раскладки и возвращает пустую строку, пока элемент не отрисован — на такой
 * подписи переходы молча ломались бы.
 */
function labelOf(node: HTMLElement): string {
  let text = '';
  const walk = (current: Node): boolean => {
    for (const child of Array.from(current.childNodes)) {
      if (child.nodeName === 'BR') return false;
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
      else if (!walk(child)) return false;
    }
    return true;
  };
  walk(node);
  return elementLabel(text);
}

export function OperatorV5App() {
  const [screen, setScreen] = useState<ScreenId>('A1');
  // Стек посещённого нужен только кнопке «‹ Назад», поэтому читается он внутри
  // обновления состояния, а не здесь.
  const [, setVisited] = useState<ScreenId[]>([]);
  const [indexOpen, setIndexOpen] = useState(false);
  const surface = useRef<HTMLDivElement>(null);

  const go = useCallback((next: ScreenId) => {
    setVisited((stack) => [...stack, screen]);
    setScreen(next);
    setIndexOpen(false);
    surface.current?.scrollTo({top: 0});
  }, [screen]);

  const goBack = useCallback(() => {
    setVisited((stack) => {
      const previous = stack[stack.length - 1];
      if (previous) setScreen(previous);
      return stack.slice(0, -1);
    });
  }, []);

  /**
   * Один обработчик на всё приложение вместо onClick в каждом экране. Экраны
   * собраны из макета машинально, и вписывать в них обработчики значило бы
   * править сгенерированный файл — при следующей сборке из макета правки
   * пропали бы.
   */
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;

    if (target.closest('.back')) {
      goBack();
      return;
    }

    const answer = target.closest<HTMLElement>('.ans span');
    if (answer) {
      toggleChoice(answer, answer.textContent === 'Дефект' || answer.textContent === 'Есть' ? 'bad' : 'on');
      return;
    }
    const segment = target.closest<HTMLElement>('.seg span');
    if (segment) {
      toggleChoice(segment, 'on');
      return;
    }
    const option = target.closest<HTMLElement>('.qz .opt');
    if (option) {
      toggleChoice(option, 'sel');
      return;
    }

    const key = target.closest<HTMLElement>('.keys span');
    if (key && surface.current) {
      const result = pressKey(surface.current, key.textContent ?? '');
      if (result !== 'submit') return;
      const next = resolveTarget(screen, '✓', false);
      if (next) go(next);
      return;
    }

    const dockItem = target.closest<HTMLElement>('.dock span');
    if (dockItem) {
      const next = resolveTarget(screen, labelOf(dockItem), true);
      if (next) go(next);
      return;
    }

    // Кнопка вида `.b.dis` в макете выключена — она ждёт, пока документ
    // пролистают до конца, и нажатие по ней ничего не делает.
    const button = target.closest<HTMLElement>('button.b');
    if (button) {
      if (button.classList.contains('dis')) return;
      const next = resolveTarget(screen, labelOf(button), false);
      if (next) go(next);
      return;
    }

    const row = target.closest<HTMLElement>('.rowline');
    if (row) {
      const next = resolveTarget(screen, labelOf(row), false);
      if (next) go(next);
    }
  }, [go, goBack, screen]);

  const current = SCREENS[screen];

  return (
    <div className="v5-shell">
      <div className="app" ref={surface} onClick={handleClick}>
        {current.content}
      </div>

      {/*
        Указателя экранов в макете нет — он добавлен, потому что прототип нужно
        уметь показывать с любого места: состояния «Работать нельзя», «Провал
        теста», «Отклонено после синхронизации» в обычном проходе смены не
        встречаются, а обсуждать их надо.
      */}
      <button className="v5-index-toggle" type="button" onClick={() => setIndexOpen((open) => !open)}>
        {indexOpen ? 'Закрыть' : `${screen} · экраны`}
      </button>

      {indexOpen && (
        <div className="v5-index">
          <p className="v5-index-title">34 экрана · 8 фаз</p>
          {PHASES.map((phase) => (
            <section key={phase.letter}>
              <p className="v5-index-phase"><span>{phase.letter}</span>{phase.name}</p>
              {phase.screens.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={id === screen ? 'v5-index-item on' : 'v5-index-item'}
                  onClick={() => go(id)}
                >
                  <span className="l">{id}</span>
                  <span className="n">{SCREENS[id].title}</span>
                  <span className="c">{SCREENS[id].kind}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
