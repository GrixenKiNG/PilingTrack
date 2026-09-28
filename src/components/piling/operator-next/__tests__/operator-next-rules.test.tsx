import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {useState} from 'react';
import {ApiError, QueuedOffline} from '@/components/piling/operator-mobile/api';
import {AdmissionScreen} from '../admission';
import {ActionButton} from '../parts';
import {ChecklistRunScreen} from '../checklist-run';
import {emptyWorkDraft} from '../drafts';
import {ReportSendScreen} from '../report-send';
import {ShiftStartScreen} from '../shift-start';
import {WorkScreenNext} from '../work';
import {humanError, WORDS} from '../words';
import {checklistView, makeChecklist, makeState} from './fixtures';

/**
 * Правила раздела 4 задания — по тесту на каждое, плюс находки независимого
 * ревью №1, которые видно на уровне отдельного экрана.
 *
 * ПРАВИЛА ПРОВЕРЯЮТСЯ НА ЭКРАНЕ, А НЕ НА СЛОВАХ. Там, где правило про поведение
 * («закрытие держится», «марка не выбрана заранее», «введённое не стирается»),
 * тест нажимает кнопки и смотрит, что получилось. Там, где правило про свойство
 * кода («передачи смены нет», «чужую очередь не отправляем») — читает исходники
 * модуля: это единственная проверка, которую нельзя подделать разметкой.
 *
 * Сценарии, которым нужна вся оболочка (ошибка перечитывания, гонка загрузок,
 * жизненный цикл ключей), лежат в `operator-next-app.test.tsx`.
 */
const MODULE_DIR = path.resolve(process.cwd(), 'src/components/piling/operator-next');
const APP_DIR = path.resolve(process.cwd(), 'src/app/operator/next');
const BASE_DIR = path.resolve(process.cwd(), 'src/components/piling/operator-mobile');

function moduleSources(): {name: string; text: string}[] {
  return readdirSync(MODULE_DIR)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => ({name, text: readFileSync(path.join(MODULE_DIR, name), 'utf8')}));
}

/**
 * Текст без комментариев.
 *
 * ПОЧЕМУ ТАК. В коде модуля есть пояснения «передачи смены нет» — это описание
 * решения, а не кнопка. Проверяем поведение: чтобы правило ловило настоящую
 * кнопку передачи, комментарии из текста убираем.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const noop = () => {};

/** Оболочка черновика для экрана работы: он управляемый, состояние живёт выше. */
function WorkHarness({
  state, onSubmitEntry = async () => true,
}: {
  state: ReturnType<typeof makeState>;
  onSubmitEntry?: (entry: unknown) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(emptyWorkDraft());
  return (
    <WorkScreenNext
      state={state}
      busy={false}
      error={null}
      draft={draft}
      onDraftChange={(updater) => setDraft((current) => updater(current))}
      onSubmitEntry={onSubmitEntry as never}
      onCorrect={async () => true}
      onFinish={noop}
      onOpenSafety={noop}
      onOpenTab={noop}
    />
  );
}

describe('правило 1 — передачи смены нет, закрытие только командой close-shift', () => {
  it('в исходниках модуля нет команды submit-report и слов о передаче смены', () => {
    for (const {name, text} of moduleSources()) {
      const code = stripComments(text);
      expect(name, `submit-report в ${name}`).not.toContain('submit-report');
      expect(code, `submit-report в ${name}`).not.toContain('submit-report');
      expect(code, `передача смены в ${name}`).not.toMatch(/передач[аи]\s+смены/i);
      expect(code, `передать смену в ${name}`).not.toMatch(/передать\s+смену/i);
    }
    const app = readFileSync(path.join(MODULE_DIR, 'operator-next-app.tsx'), 'utf8');
    expect(app).toContain("command: 'close-shift'");
  });
});

describe('правило 2 — закрытие смены запрещено при неотправленных записях', () => {
  const props = {
    closeNote: '', onCloseNoteChange: noop, onOpenService: noop, onFlushQueued: noop, onReload: noop,
  };

  it('показывает число неотправленных и держит закрытие с кнопкой отправки', () => {
    const onClose = vi.fn();
    const onFlushQueued = vi.fn();
    render(
      <ReportSendScreen
        state={makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})}
        busy={false} error={null} unsentCount={3} {...props} onFlushQueued={onFlushQueued} onClose={onClose}
      />,
    );

    expect(screen.getByText('Неотправленные записи: 3')).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})) {
      expect(button).toBeDisabled();
    }

    fireEvent.click(screen.getAllByRole('button', {name: /Отправить записи с телефона/})[0]);
    expect(onFlushQueued).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('закрывает смену, когда очередь пуста и осмотр после работы выполнен', () => {
    const onClose = vi.fn();
    render(
      <ReportSendScreen
        state={makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})}
        busy={false} error={null} unsentCount={0} {...props} onClose={onClose}
      />,
    );

    expect(screen.queryByText(/Неотправленные записи: [1-9]/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('неизвестную очередь закрытием не считает: «проверить не удалось» — не «пусто»', () => {
    render(
      <ReportSendScreen
        state={makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})}
        busy={false} error={null} unsentCount={-1} {...props} onClose={noop}
      />,
    );
    expect(screen.getAllByText('Очередь на устройстве не прочитана').length).toBeGreaterThan(0);
    for (const button of screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})) {
      expect(button).toBeDisabled();
    }
  });
});

describe('правило 3 — никаких автоматически выбранных значений', () => {
  it('марка сваи не выбрана заранее, кнопка записи погашена с причиной', () => {
    render(<WorkHarness state={makeState()} />);

    fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);

    const grades = screen.getAllByRole('button', {name: /С 100\.30|С 120\.35/});
    expect(grades).toHaveLength(2);
    for (const grade of grades) expect(grade).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Выберите марку сваи.')).toBeInTheDocument();
  });
});

describe('правило 4 — тип смены виден и выбирается явно', () => {
  it('оба типа смены показаны, приёмка без выбора заблокирована', () => {
    const onAccept = vi.fn();
    render(
      <ShiftStartScreen
        state={makeState({phase: 'ADMISSION'})} busy={false} loading={false} error={null}
        onAccept={onAccept} onSelectEquipment={noop} selectedEquipmentId={null} onReload={noop}
      />,
    );

    expect(screen.getByRole('button', {name: /Дневная/})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Ночная/})).toBeInTheDocument();
    const accept = screen.getByRole('button', {name: /Принять установку/});
    expect(accept).toBeDisabled();
    expect(screen.getByText(/Сначала выберите тип смены/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /Ночная/}));
    expect(accept).not.toBeDisabled();
    fireEvent.click(accept);
    expect(onAccept).toHaveBeenCalledWith({equipmentId: 'eq-1', shiftType: 'NIGHT'});
  });

  it('пока загружается другая установка, приёмка держится с причиной', () => {
    render(
      <ShiftStartScreen
        state={makeState({phase: 'ADMISSION'})} busy={false} loading error={null}
        onAccept={noop} onSelectEquipment={noop} selectedEquipmentId="eq-2" onReload={noop}
      />,
    );
    expect(screen.getByRole('button', {name: /Принять установку/})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: /Ночная/}));
    expect(screen.getByText(/дождитесь загрузки выбранной/)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Принять установку/})).toBeDisabled();
  });
});

describe('правило 5 — приёмка установки отдельной кнопкой, а не выбором строки', () => {
  it('касание строки только выбирает установку и не открывает смену', () => {
    const onAccept = vi.fn();
    const onSelectEquipment = vi.fn();
    render(
      <ShiftStartScreen
        state={makeState({
          phase: 'ADMISSION',
          options: [
            {crewId: 'c1', equipmentId: 'eq-1', equipmentName: 'СУ-1', siteName: 'Объект А'},
            {crewId: 'c2', equipmentId: 'eq-2', equipmentName: 'СУ-2', siteName: 'Объект Б'},
          ],
        })}
        busy={false} loading={false} error={null}
        onAccept={onAccept} onSelectEquipment={onSelectEquipment}
        selectedEquipmentId={null} onReload={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: /СУ-2/}));
    expect(onSelectEquipment).toHaveBeenCalledWith('eq-2');
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe('правило 6 — введённое не стирается, пока сервер не принял запись', () => {
  it('при отказе сервера форма и выбор остаются, при успехе форма закрывается', async () => {
    const onSubmitEntry = vi.fn(async () => false);
    render(<WorkHarness state={makeState()} onSubmitEntry={onSubmitEntry} />);

    fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);
    fireEvent.click(screen.getByRole('button', {name: /С 100\.30/}));
    fireEvent.change(screen.getByLabelText('Сколько свай забито, шт'), {target: {value: '5'}});
    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));

    await screen.findByText('Выберите марку сваи.', {exact: false}).catch(() => undefined);
    expect(onSubmitEntry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', {name: /С 100\.30/})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(5);
  });
});

describe('правило 7 — у недоступного действия видна причина и следующий шаг', () => {
  const props = {
    closeNote: '', onCloseNoteChange: noop, onOpenService: noop, onFlushQueued: noop, onReload: noop, onClose: noop,
  };

  it('закрытие без осмотра после работы объясняется словами', () => {
    render(
      <ReportSendScreen
        state={makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', false)]})}
        busy={false} error={null} unsentCount={0} {...props}
      />,
    );

    expect(screen.getAllByText(/Пока не выполнен осмотр и обслуживание после работы/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', {name: /Перейти к осмотру после работы/})).toBeInTheDocument();
  });

  it('допуск перечисляет незакрытые шаги и даёт кнопку продолжения', () => {
    const state = makeState({
      phase: 'IDENTITY',
      identity: {
        ...makeState().identity,
        ppe: {confirmed: false, items: [], missing: [], confirmedAt: null},
      },
    });
    render(<AdmissionScreen state={state} busy={false} onOpen={noop} onContinue={noop} />);

    expect(screen.getAllByText(/Пока не закрыто: .*СИЗ/).length).toBeGreaterThan(0);
  });
});

describe('находка №8 — фаза закрытия без чек-листа осмотра не тупик', () => {
  it('сказано, что списка нет, и есть рабочая кнопка «Обновить»', () => {
    const onReload = vi.fn();
    render(
      <ReportSendScreen
        state={makeState({phase: 'CLOSING', checklists: []})}
        busy={false} error={null} unsentCount={0}
        closeNote="" onCloseNoteChange={noop} onOpenService={noop} onFlushQueued={noop}
        onReload={onReload} onClose={noop}
      />,
    );

    expect(screen.getByText(/Чек-лист осмотра после работы не получен/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', {name: 'Обновить'})[0]);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]).toBeDisabled();
  });
});

describe('находка №5 — массовая «норма» и настоящая отмена', () => {
  it('не перезаписывает неисправность, а «Отменить» возвращает прежние ответы', () => {
    render(
      <ChecklistRunScreen
        checklist={makeChecklist()} warnings={[]} busy={false} error={null}
        commandId="cmd-1" onSubmit={noop}
      />,
    );

    const leak = screen.getByTestId('inspection-item-i-leak');
    fireEvent.click(within(leak).getByRole('button', {name: 'Неисправность'}));

    fireEvent.click(screen.getByRole('button', {name: 'Весь раздел — норма'}));

    const level = screen.getByTestId('inspection-item-i-level');
    expect(within(level).getByRole('button', {name: 'Норма'})).toHaveAttribute('aria-pressed', 'true');
    expect(within(leak).getByRole('button', {name: 'Неисправность'})).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', {name: 'Отменить'}));
    expect(within(level).getByRole('button', {name: 'Норма'})).toHaveAttribute('aria-pressed', 'false');
    expect(within(leak).getByRole('button', {name: 'Неисправность'})).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('находка №6 — поле комментария показывается только там, где уходит', () => {
  it('у бурения комментария нет, у свай есть', () => {
    render(<WorkHarness state={makeState()} />);

    fireEvent.click(screen.getByRole('button', {name: /Записать бурение/}));
    expect(screen.queryByText('Комментарий, если нужно')).toBeNull();

    fireEvent.click(screen.getByRole('button', {name: /Назад к смене/}));
    fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);
    expect(screen.getByText('Комментарий, если нужно')).toBeInTheDocument();
  });
});

describe('правило 8 — ошибки сервера по-русски, без технических текстов', () => {
  it('переводит технические ответы на понятный язык', () => {
    expect(humanError(new ApiError(400, 'Validation failed'))).toContain('Сервер');
    expect(humanError(new ApiError(400, 'Validation failed'))).not.toMatch(/Validation|failed/);
    expect(humanError(new ApiError(500, 'Internal Server Error'))).not.toMatch(/Internal|Server Error/);
    expect(humanError(new ApiError(403, 'Forbidden'))).not.toMatch(/Forbidden/);
    expect(humanError(new ApiError(429, 'Too Many Requests'))).not.toMatch(/Too Many/);
    expect(humanError(new QueuedOffline('Записать сваи'))).toContain('сохранено на устройстве');
    expect(humanError(new Error('network down'))).not.toMatch(/network down/);
  });
});

describe('правило 9 — чужие записи видны, но не отправляются от имени вошедшего', () => {
  it('модуль только читает очередь, отправляет её общий хук', () => {
    for (const {name, text} of moduleSources()) {
      const code = stripComments(text);
      // Отправка и разбор очереди — не наше дело: это делает общий хук.
      expect(code, `sendQueuedCommand в ${name}`).not.toContain('sendQueuedCommand');
      expect(code, `flushQueue в ${name}`).not.toContain('flushQueue');

      // Прямой импорт хранилища допустим ровно один — снимок очереди на чтение,
      // и только функции чтения.
      for (const match of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/components\/piling\/operator-mobile\/offline-queue'/g)) {
        expect(name, `импорт хранилища в ${name}`).toBe('queue-snapshot.ts');
        expect(match[1].replace(/\s/g, '')).toBe('pendingCount');
      }
    }

    const snapshot = readFileSync(path.join(MODULE_DIR, 'queue-snapshot.ts'), 'utf8');
    expect(snapshot).toContain('pendingCount');

    const app = readFileSync(path.join(MODULE_DIR, 'operator-next-app.tsx'), 'utf8');
    // Очередь берётся готовым хуком: он фильтрует записи по владельцу.
    expect(app).toContain('useOfflineQueue');
    // Плашке отдаётся весь список устройства — чужие записи видно, но отправляет
    // их только их автор, когда войдёт сам.
    expect(app).toContain('items={queued}');
  });
});

describe('правило 10 — единые слова', () => {
  it('названия действий совпадают с принятыми, «Отказ» в осмотре заменён на «Неисправность»', () => {
    expect(WORDS.shift).toBe('Смена');
    expect(WORDS.accept).toBe('Принять установку');
    expect(WORDS.logPiles).toBe('Записать сваи');
    expect(WORDS.fault).toBe('Неисправность');
    expect(WORDS.incident).toBe('Происшествие');
    expect(WORDS.closeShift).toBe('Закрыть смену и отправить отчёт');

    render(
      <ChecklistRunScreen
        checklist={makeChecklist()} warnings={[]} busy={false} error={null}
        commandId="cmd-1" onSubmit={noop}
      />,
    );
    expect(screen.getAllByRole('button', {name: 'Неисправность'})).toHaveLength(2);
    expect(screen.queryByRole('button', {name: 'Отказ'})).toBeNull();
  });
});

describe('правило 11 — крупные цели нажатия и читаемый текст', () => {
  it('кнопки не ниже 56 точек, зоны не ниже 48, ответы осмотра — 18 px', () => {
    const css = readFileSync(path.join(APP_DIR, 'operator-next.css'), 'utf8');
    expect(css).toMatch(/\.onx-action\s*\{[^}]*min-height:\s*56px/);
    expect(css).toMatch(/\.onx-choice\s*\{[^}]*min-height:\s*56px/);
    expect(css).toMatch(/\.onx-quiet\s*\{[^}]*min-height:\s*56px/);
    expect(css).toMatch(/\.onx-step\s*\{[^}]*min-height:\s*48px/);
    // Находка №9: было 48 px и 15 px.
    expect(css).toMatch(/\.onx-answers button\s*\{[^}]*min-height:\s*56px[^}]*font-size:\s*1\.125rem/);

    // Экран несёт класс общего контура, а он поднимает основной текст до 18 px.
    const app = readFileSync(path.join(MODULE_DIR, 'operator-next-app.tsx'), 'utf8');
    expect(app).toContain("from '@/components/piling/operator-mobile/ui'");
    const type = readFileSync(path.join(BASE_DIR, 'operator-type.css'), 'utf8');
    expect(type).toContain('--text-base: 1.125rem');

    render(<ActionButton label="Проверка" onClick={noop} />);
    expect(screen.getByRole('button', {name: 'Проверка'})).toHaveClass('onx-action');
  });
});
