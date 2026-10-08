import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
// Экран тянет рабочий обзор оператора, а тот — стили PostCSS; в тесте они не нужны.
vi.mock('@/components/piling/operator-mobile/operator-concept.css', () => ({}));

/**
 * Источник данных подменён: приложение целиком проверяется на двух ответах
 * сервера — «состояние сменилось» и «состояния больше нет».
 */
const api = vi.hoisted(() => ({
  currentPosition: vi.fn(async () => null),
  fetchState: vi.fn(),
  sendCommand: vi.fn(async () => undefined),
  sendQueuedCommand: vi.fn(async () => undefined),
  newCommandId: vi.fn(() => 'cmd-1'),
  uploadPhoto: vi.fn(async () => 'media-1'),
}));
vi.mock('@/components/piling/operator-mobile/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
  QueuedOffline: class QueuedOffline extends Error {},
  ...api,
}));

import {ApiError, QueuedOffline} from '@/components/piling/operator-mobile/api';
import {CloseScreen, OperatorV5App, WorkScreen} from '../operator-v5-app';
import {workStateFixture} from '../../operator-mobile/__tests__/fixtures';

describe('T12: следующий шаг v5 открывает действие и фокусирует его', () => {
  function open(value: Partial<OperatorMobileState>) {
    api.fetchState.mockReset().mockResolvedValue(workStateFixture({
      operator: {id: 'me', name: 'Машинист'}, options: [], receipt: null, ...value,
    }));
    api.sendCommand.mockReset().mockResolvedValue(undefined);
    return render(<OperatorV5App />);
  }

  it('приёмка фокусирует принятие машины, включая повторное нажатие, без отправки команды', async () => {
    open({phase: 'ADMISSION', shift: null, options: [{crewId: 'crew-1', equipmentId: 'eq-1', equipmentName: 'Установка', siteName: 'Объект'}]});
    const next = await screen.findByRole('button', {name: 'Следующий шаг: Принять установку'});
    const accept = screen.getByRole('button', {name: 'Принять машину'});
    fireEvent.click(next);
    expect(accept).toHaveFocus();
    next.focus();
    fireEvent.click(next);
    expect(accept).toHaveFocus();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it.each([
    {phase: 'PRESHIFT_INSPECTION', stage: 'PRESHIFT_INSPECTION', title: 'Предсменный осмотр'},
    {phase: 'SITE_READY', stage: 'SITE_READY', title: 'Осмотр площадки'},
    {phase: 'STARTUP', stage: 'EO_BEFORE', title: 'Пуск и ЕО перед работой'},
    {phase: 'CLOSING', stage: 'EO_AFTER', title: 'ЕО после работы'},
  ])('$phase ведёт к незаполненному пункту, затем к замеру, не сдавая список', async ({phase, stage, title}) => {
    open({phase, checklists: [{stage, title, purpose: '', version: '1', done: false, period: null,
      sections: [{id: 'meter', title: 'Счётчик', items: [{id: 'hours', text: 'Снять показание', severity: 'NOTE',
        measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'}}]}]}]} as Partial<OperatorMobileState>);
    const next = await screen.findByRole('button', {name: `Следующий шаг: ${title}`});
    fireEvent.click(next);
    expect(screen.getByRole('button', {name: 'Норма'})).toHaveFocus();
    fireEvent.click(screen.getByRole('button', {name: 'Норма'}));
    fireEvent.click(next);
    expect(screen.getByRole('textbox')).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox'), {target: {value: '99'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'Счётчик заменён'}));
    fireEvent.click(next);
    expect(screen.getByRole('button', {name: 'Завершить'})).toHaveFocus();
    expect(screen.getByRole('textbox')).toHaveValue('99');
    expect(screen.getByRole('checkbox', {name: 'Счётчик заменён'})).toBeChecked();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('сдача возвращается из вкладки работы и фокусирует закрытие, не закрывая смену', async () => {
    open({phase: 'CLOSING', checklists: [{stage: 'EO_AFTER', done: true, period: null}] as OperatorMobileState['checklists']});
    const next = await screen.findByRole('button', {name: 'Следующий шаг: Закрыть смену'});
    fireEvent.click(screen.getByRole('button', {name: 'Работа'}));
    fireEvent.click(next);
    expect(screen.getByRole('button', {name: 'Закрыть смену'})).toHaveFocus();
    next.focus();
    fireEvent.click(next);
    expect(screen.getByRole('button', {name: 'Закрыть смену'})).toHaveFocus();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('повторное нажатие на открытом шаге СИЗ фокусирует выбор, не подтверждая его', async () => {
    const identity = workStateFixture().identity;
    open({phase: 'IDENTITY', identity: {...identity, ppe: {...identity.ppe, confirmed: false}}});
    const next = await screen.findByRole('button', {name: 'Следующий шаг: СИЗ'});
    fireEvent.click(next);
    await screen.findByText('Средства защиты');
    next.focus();
    fireEvent.click(next);
    expect(screen.getByRole('button', {name: /Каска/})).toHaveFocus();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('выработка получает фокус без потери уже введённого количества', async () => {
    open({phase: 'WORK', entries: [], dictionaries: {
      pileGrades: [{id: 'grade-1', name: 'С 20-35', lengthMm: 6000}], drillingTypes: [], downtimeReasons: [],
    }});
    const next = await screen.findByRole('button', {name: 'Следующий шаг: Записать выработку'});
    fireEvent.click(next);
    expect(screen.getByRole('button', {name: 'Добавить сваю'})).toHaveFocus();
    fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'grade-1'}});
    fireEvent.change(screen.getByRole('textbox'), {target: {value: '12'}});
    next.focus();
    fireEvent.click(next);
    expect(screen.getByRole('combobox')).toHaveFocus();
    expect(screen.getByRole('textbox')).toHaveValue('12');
    expect(api.sendCommand).not.toHaveBeenCalled();
  });
});

describe('v5: вердикты осмотра и подтверждение замечаний (I5)', () => {
  async function openInspection(photoOnIssue = false, meter = false) {
    api.fetchState.mockReset();
    api.sendCommand.mockReset().mockResolvedValue(undefined);
    api.uploadPhoto.mockReset().mockResolvedValue('media-1');
    api.fetchState.mockResolvedValue(workStateFixture({phase: 'PRESHIFT_INSPECTION',
      operator: {id: 'me', name: 'Машинист'},
      checklists: [{stage: 'PRESHIFT_INSPECTION', title: 'Осмотр', purpose: '', version: '1', done: false, period: null,
        sections: [{id: 'machine', title: 'Машина', items: [{id: 'check', text: 'Проверить установку', severity: 'NOTE', photoOnIssue,
          ...(meter ? {measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'}} : {}),
        }]}]}],
    }));
    render(<OperatorV5App />);
    await screen.findByRole('button', {name: /^норма$/i});
  }

  it.each([{label: 'Замечание', answer: 'REMARK'}, {label: 'Отказ', answer: 'FAULT'}])(
    '$label отправляется с описанием, а не вместо него', async ({label, answer}) => {
      await openInspection();
      expect(screen.getByRole('button', {name: 'Норма'})).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', {name: label}));
      expect(screen.getByRole('button', {name: /Осталось отметить/})).toBeDisabled();
      fireEvent.change(screen.getByRole('textbox', {name: /Что именно не так/}), {target: {value: 'Подтёк масла'}});
      fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
      await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
        command: 'submit-checklist', answers: [expect.objectContaining({answer, note: 'Подтёк масла'})],
      })));
    },
  );

  it('требует подтверждённый снимок, сохраняет описание при отказе загрузки и позволяет повторить', async () => {
    await openInspection(true);
    fireEvent.click(screen.getByRole('button', {name: 'Замечание'}));
    fireEvent.change(screen.getByRole('textbox', {name: /Что именно не так/}), {target: {value: 'Подтёк масла'}});
    expect(screen.getByRole('button', {name: /Осталось отметить/})).toBeDisabled();
    api.uploadPhoto.mockRejectedValueOnce(new Error('Снимок не загружен'));
    const file = new File(['photo'], 'inspection.jpg', {type: 'image/jpeg'});
    const input = screen.getByLabelText(/Снимок: Проверить установку/);
    fireEvent.change(input, {target: {files: [file]}});
    expect(await screen.findByText('Снимок не загружен')).toBeInTheDocument();
    expect(screen.getByRole('textbox', {name: /Что именно не так/})).toHaveValue('Подтёк масла');
    expect(api.sendCommand).not.toHaveBeenCalled();
    fireEvent.change(input, {target: {files: [file]}});
    await waitFor(() => expect(screen.getByRole('button', {name: 'Завершить'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
      clientCommandId: 'cmd-1', answers: [expect.objectContaining({answer: 'REMARK', note: 'Подтёк масла', mediaIds: ['media-1']})],
    })));
    expect(api.uploadPhoto).toHaveBeenCalledWith({file, clientCommandId: 'cmd-1', itemId: 'check'});
  });

  it('сохраняет описание и снимок, если сервер отказал в сдаче осмотра', async () => {
    await openInspection(true);
    fireEvent.click(screen.getByRole('button', {name: 'Отказ'}));
    fireEvent.change(screen.getByRole('textbox', {name: /Что именно не так/}), {target: {value: 'Трещина'}});
    fireEvent.change(screen.getByLabelText(/Снимок: Проверить установку/), {target: {files: [new File(['photo'], 'inspection.jpg', {type: 'image/jpeg'})]}});
    await waitFor(() => expect(screen.getByRole('button', {name: 'Завершить'})).toBeEnabled());
    api.sendCommand.mockRejectedValueOnce(new ApiError(400, 'Осмотр не принят'));
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    expect(await screen.findByText('Осмотр не принят')).toBeInTheDocument();
    expect(screen.getByRole('textbox', {name: /Что именно не так/})).toHaveValue('Трещина');
    expect(screen.getByText('Снимков: 1')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Завершить'})).toBeEnabled();
  });

  it('сохраняет пометку замены счётчика вместе с описанием замечания', async () => {
    await openInspection(false, true);
    fireEvent.click(screen.getByRole('button', {name: 'Замечание'}));
    fireEvent.change(screen.getByRole('textbox', {name: /Что именно не так/}), {target: {value: 'Повреждено стекло счётчика'}});
    fireEvent.change(screen.getByRole('textbox', {name: ''}), {target: {value: '99'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'Счётчик заменён'}));
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
      answers: [expect.objectContaining({answer: 'REMARK', note: 'Счётчик заменён; Повреждено стекло счётчика', measures: {engineHours: 99}})],
    })));
  });
});

describe('v5: явная замена счётчика моточасов', () => {
  it('посылает новое меньшее показание с пометкой, не отмечая неисправность', async () => {
    const assignment = working.assignment;
    if (!assignment) throw new Error('Для проверки нужна назначенная установка');
    api.fetchState.mockReset();
    api.sendCommand.mockReset().mockResolvedValue(undefined);
    api.fetchState.mockResolvedValue(workStateFixture({phase: 'CLOSING',
      operator: {id: 'me', name: 'Машинист'},
      assignment: {...assignment, lastMeter: {engineHours: 3000, recordedAt: '2026-09-19T15:00:00.000Z'}},
      checklists: [{stage: 'EO_AFTER', title: 'ЕО после работы', purpose: '', version: '1', done: false, period: null,
        sections: [{id: 'meter', title: 'Счётчик', items: [{id: 'hours', text: 'Снять показание', severity: 'NOTE', measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'}}]}]}],
    }));
    render(<OperatorV5App />);
    fireEvent.click(await screen.findByRole('button', {name: /^норма$/i}));
    fireEvent.change(screen.getByRole('textbox'), {target: {value: '99'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'Счётчик заменён'}));
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: 'submit-checklist', answers: [expect.objectContaining({itemId: 'hours', answer: 'OK', note: 'Счётчик заменён', measures: {engineHours: 99}})],
    })));
  });
});

/** Обещание, которым тест сам решает, когда закончится перечитывание экрана. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return {promise, resolve};
}

/**
 * F-R43-1: смену нельзя закрыть, пока на телефоне лежат неотправленные записи.
 *
 * Закрытая смена отвечает отложенной выработке 409 «Смена уже закрыта», и в
 * отчёт она не попадает: сначала очередь, потом закрытие.
 */
const ready = {
  phase: 'CLOSING',
  receipt: null,
  production: {
    piles: {count: 12, meters: 168},
    drilling: {count: 0, meters: 0},
    downtimeHours: 0,
  },
} as unknown as OperatorMobileState;

describe('закрытие смены v5 при непустой очереди', () => {
  it('держит закрытие и предлагает отправить записи', () => {
    const onClose = vi.fn();
    const onFlush = vi.fn();
    render(<CloseScreen state={ready} busy={false} onClose={onClose} unsent={2} onFlush={onFlush} />);

    expect(screen.getByText('Сначала отправьте записи с телефона: 2 не отправлено')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Закрыть смену'})).toBeDisabled();

    fireEvent.click(screen.getByRole('button', {name: 'Отправить сейчас'}));
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('закрывает смену, когда очередь пуста', () => {
    const onClose = vi.fn();
    render(<CloseScreen state={ready} busy={false} onClose={onClose} unsent={0} onFlush={() => {}} />);

    expect(screen.queryByText(/Сначала отправьте записи/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Закрыть смену'}));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * F-R43-3a: форма выработки чистится только по подтверждению сервера.
 *
 * Отказ 400/409 приходит уже после отправки: если очистить поля сразу, число,
 * которое машинист набрал в перчатке, пропадёт вместе с текстом отказа. Пока
 * состояние показывает, что работа разрешена и допуск пройден, обзор позволяет
 * открыть форму свай.
 */
const working = {
  phase: 'WORK',
  productionDate: '2026-09-27',
  operator: {name: 'Сидоров А. В.'},
  shift: {id: 'shift-1', productionDate: '2026-09-27'},
  assignment: {equipmentId: 'eq-1', equipmentName: 'Liebherr LRH 100', siteName: 'Площадка'},
  permit: {allowed: true, blocks: []},
  identity: {
    ppe: {confirmed: true, missing: []},
    briefing: {ok: true},
    knowledge: {ok: true},
    documents: [],
  },
  checklists: [
    {stage: 'PRESHIFT_INSPECTION', done: true, period: null},
    {stage: 'SITE_READY', done: true, period: null},
    {stage: 'EO_BEFORE', done: true, period: null},
  ],
  dictionaries: {
    pileGrades: [{id: 'grade-1', name: 'С 20-35', lengthMm: 6000}],
    drillingTypes: [],
    downtimeReasons: [],
  },
  production: {
    piles: {count: 0, meters: 0},
    drilling: {count: 0, meters: 0},
    downtimeHours: 0,
  },
  entries: [],
  warnings: [],
} as unknown as OperatorMobileState;

describe('приёмка v5 при чужой незакрытой смене', () => {
  it('показывает дату и обращение к диспетчеру вместо чужого ЕО и не принимает машину', async () => {
    api.fetchState.mockResolvedValue({
      ...workStateFixture, phase: 'ADMISSION', shift: null,
      options: [{crewId: 'crew-1', equipmentId: 'eq-1', equipmentName: 'Установка', siteName: 'Объект'}],
      blockedShift: {equipmentId: 'eq-1', productionDate: '2026-09-27'},
    });
    render(<OperatorV5App />);
    const accept = await screen.findByRole('button', {name: 'Принять машину'});
    expect(accept).toBeDisabled();
    expect(screen.getByText(/Другой машинист не сдал смену за 27.09.2026/)).toBeInTheDocument();
    expect(screen.getByText(/Обратитесь к диспетчеру/)).toBeInTheDocument();
    fireEvent.click(accept);
    expect(api.sendCommand).not.toHaveBeenCalled();
    expect(screen.queryByText(/Осталось отметить/)).not.toBeInTheDocument();
  });
});

/** Экран работы без формы. */
function renderWork(onLog: (entry: unknown) => Promise<boolean>) {
  return render(<WorkScreen
    state={working}
    busy={false}
    onLog={onLog as never}
    onFinish={() => {}}
    onOpenSafety={() => {}}
    onIncident={() => {}}
  />);
}

/** Открывает форму свай и вводит «12 шт». Возвращает поле числа. */
function fillPiles(container: HTMLElement) {
  fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));
  fireEvent.change(container.querySelector('select') as HTMLSelectElement, {target: {value: 'grade-1'}});
  const count = container.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
  fireEvent.change(count, {target: {value: '12'}});
  return count;
}

describe('запись выработки v5 и отказ сервера', () => {
  it('оставляет введённое число, когда сервер отказал', async () => {
    const onLog = vi.fn().mockResolvedValue(false);
    const {container} = renderWork(onLog);
    const count = fillPiles(container);

    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    await waitFor(() => expect(onLog).toHaveBeenCalledTimes(1));
    expect(count.value).toBe('12');
  });

  it('чистит поле, когда запись принята', async () => {
    const onLog = vi.fn().mockResolvedValue(true);
    const {container} = renderWork(onLog);
    const count = fillPiles(container);

    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    await waitFor(() => expect(onLog).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(count.value).toBe(''));
  });
});

/**
 * F-R43-3a2: успех — это «сервер принял запись», а не «обработчик дошёл до
 * конца». Перечитывание экрана после принятой команды идёт отдельным шагом:
 * если его сбой предъявить как отказ, машинист наберёт то же число заново и
 * выработка задвоится.
 */
describe('принятая запись и сбой перечитывания экрана', () => {
  it('считает запись принятой и не просит вводить её снова', async () => {
    vi.mocked(api.fetchState)
      .mockResolvedValueOnce(working)
      .mockRejectedValueOnce(new Error('нет связи'));

    const {container} = render(<OperatorV5App />);
    await screen.findByRole('button', {name: 'Добавить сваю'});
    const count = fillPiles(container);

    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    // Запись ушла, экран перечитать не удалось.
    await waitFor(() => expect(api.fetchState).toHaveBeenCalledTimes(2));
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Записано. Не удалось обновить экран — потяните вниз / обновите.'))
      .toBeInTheDocument();
    // Это не отказ: полноэкранной ошибки связи нет, поле очищено.
    expect(screen.queryByText('Нет связи с сервером')).not.toBeInTheDocument();
    await waitFor(() => expect(count.value).toBe(''));
  });
});

/**
 * F-R43-3d: кнопка выработки занята, пока экран не перечитан.
 *
 * Ключ команды меняется сразу по её принятию, а счётчики смены приходят только
 * с перечитыванием. Отпусти кнопку раньше — машинист увидит прежние числа,
 * нажмёт второй раз, и та же выработка уйдёт с новым ключом, то есть задвоится.
 */
describe('принятая запись и незавершённое перечитывание экрана', () => {
  it('держит кнопку занятой и не отправляет ту же выработку второй раз', async () => {
    const reload = deferred<OperatorMobileState>();
    let calls = 0;
    vi.mocked(api.fetchState).mockImplementation(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve(working) : reload.promise;
    });

    const {container} = render(<OperatorV5App />);
    await screen.findByRole('button', {name: 'Добавить сваю'});
    fillPiles(container);

    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));
    // Запись ушла, перечитывание началось и ещё не закончилось.
    await waitFor(() => expect(api.fetchState).toHaveBeenCalledTimes(2));
    expect(api.sendCommand).toHaveBeenCalledTimes(1);

    const busyButton = screen.getByRole('button', {name: 'Записываем…'});
    expect(busyButton).toBeDisabled();
    fireEvent.click(busyButton);
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    // Форма ещё не очищена: набранное число на экране до подтверждения экрана.
    expect(container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe('12');

    reload.resolve(working);

    await waitFor(() => expect(container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe(''));
    // Форма очищена по подтверждению сервера: отправлять больше нечего.
    expect(screen.getByRole('button', {name: 'Записать'})).toBeDisabled();
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
  });
});

/**
 * F-R43-3d: запись, ушедшая в офлайн-очередь, перечитывания не требует.
 *
 * Сервер этой записи ещё не видел, обновлять на экране нечего — а без связи
 * reload падает и затирает сообщение очереди текстом «Записано. Не удалось
 * обновить экран»: машинист решит, что запись уже на сервере, хотя она в
 * телефоне. Кнопку при этом отпускаем сразу, а не по таймауту сети.
 */
describe('запись ушла в офлайн-очередь', () => {
  it('показывает текст очереди, не перечитывает экран и отпускает кнопку', async () => {
    const queuedMessage = 'Запись выработки: сохранено на устройстве, отправим при связи';
    vi.mocked(api.fetchState).mockResolvedValue(working);
    vi.mocked(api.sendCommand).mockRejectedValueOnce(new QueuedOffline(queuedMessage));

    const {container} = render(<OperatorV5App />);
    await screen.findByRole('button', {name: 'Добавить сваю'});
    const count = fillPiles(container);

    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(1));
    expect(screen.getByText(queuedMessage)).toBeInTheDocument();
    expect(screen.queryByText('Записано. Не удалось обновить экран — потяните вниз / обновите.'))
      .not.toBeInTheDocument();
    // Перечитывания нет: состояние читалось только при открытии экрана.
    expect(api.fetchState).toHaveBeenCalledTimes(1);
    // Запись принята устройством — форма чистится, кнопка свободна.
    await waitFor(() => expect(count.value).toBe(''));
    expect(screen.getByRole('button', {name: 'Записать'})).toBeDisabled();
  });
});

/**
 * F-QA-403-V5: отказ по роли — не «нет связи».
 *
 * 403 при загрузке состояния значит, что экран не для этой роли (вошёл
 * помощник машиниста). «Повторить» тут бесполезно, а «данные сохранены на
 * телефоне и отправятся, когда связь появится» — неправда: при 403 не уйдёт
 * ничего. Показываем текст про роль сам по себе, как в v1/v10.
 */
describe('отказ по роли при загрузке состояния', () => {
  it('при 403 показывает текст про роль, без «Повторить» и без обещания отправки', async () => {
    vi.mocked(api.fetchState).mockRejectedValue(new ApiError(403, 'Экран доступен только машинисту'));
    render(<OperatorV5App />);

    expect(await screen.findByText('Экран доступен только машинисту')).toBeInTheDocument();
    expect(screen.getByText(/Смену ведёт машинист, закреплённый за установкой/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Повторить'})).not.toBeInTheDocument();
    expect(screen.queryByText(/отправятся, когда связь появится/)).not.toBeInTheDocument();
    expect(screen.queryByText('Нет связи с сервером')).not.toBeInTheDocument();
  });

  it('при сетевом сбое остаётся прежний текст «Нет связи с сервером»', async () => {
    vi.mocked(api.fetchState).mockRejectedValue(new Error('нет связи'));
    render(<OperatorV5App />);

    expect(await screen.findByText('Нет связи с сервером')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
    expect(screen.getByText(/Введённые данные сохранены на телефоне/)).toBeInTheDocument();
    expect(screen.queryByText(/Смену ведёт машинист/)).not.toBeInTheDocument();
  });
});

describe('I2: вчерашняя смена v5', () => {
  const yesterday = () => ({
    ...working,
    productionDate: '2026-09-28',
    shift: {...working.shift, state: 'STARTED'},
    receipt: null,
    defects: [],
    incidents: [],
  }) as OperatorMobileState;

  it('не открывает вчерашнюю выработку обычной вкладкой; явное дописывание возвращается к сдаче', async () => {
    vi.mocked(api.fetchState).mockResolvedValue(yesterday());
    const {container} = render(<OperatorV5App />);

    await screen.findByRole('button', {name: 'Работа'});
    expect(screen.getByText('Не сдана смена за 27.09.2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Добавить сваю'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Работа'}));
    expect(screen.queryByRole('button', {name: 'Добавить сваю'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: /Следующий шаг/}));
    expect(screen.queryByRole('button', {name: 'Добавить сваю'})).not.toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', {name: 'Дописать отчёт за 27.09.2026'}));
    fillPiles(container);
    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: 'log-production', shiftId: 'shift-1',
      entry: {kind: 'PILES', pileGradeId: 'grade-1', count: 12},
    })));

    fireEvent.click(screen.getByRole('button', {name: 'К сдаче смены'}));
    expect(screen.queryByRole('button', {name: 'Добавить сваю'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Перейти к сдаче смены'})).toBeInTheDocument();
  });

  it('завершает старую работу существующей командой, затем сдаёт тот же отчёт', async () => {
    const closing = {
      ...yesterday(), phase: 'CLOSING',
      shift: {...yesterday().shift, state: 'HANDOVER_PENDING'},
      checklists: [...working.checklists, {stage: 'EO_AFTER', done: true, period: null}],
    } as OperatorMobileState;
    vi.mocked(api.fetchState).mockResolvedValueOnce(yesterday()).mockResolvedValue(closing);
    render(<OperatorV5App />);

    await screen.findByRole('button', {name: 'Работа'});
    fireEvent.click(screen.getByRole('button', {name: 'Перейти к сдаче смены'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith({command: 'finish-work', shiftId: 'shift-1'}));
    await screen.findByRole('button', {name: 'Закрыть смену'});
    fireEvent.click(screen.getByRole('button', {name: 'Дописать отчёт за 27.09.2026'}));
    expect(await screen.findByRole('button', {name: 'Добавить сваю'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'К сдаче смены'}));
    fireEvent.click(screen.getByRole('button', {name: 'Закрыть смену'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith({command: 'close-shift', shiftId: 'shift-1', comment: ''}));
  });
});
