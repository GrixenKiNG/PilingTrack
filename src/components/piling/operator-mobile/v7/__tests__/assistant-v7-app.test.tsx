import {render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AssistantState} from '@/modules/operator-mobile/contracts';

vi.mock('../../operator-concept.css', () => ({}));
vi.mock('next/navigation', () => ({useRouter: () => ({push: vi.fn()})}));

import {AssistantV7App} from '../assistant-v7-app';

/*
  «ДОПУСК В ПОРЯДКЕ» У ПОМОЩНИКА V7 (аудит 16.10.2026, P2 D-20261016-001).

  Сводка объявляла допуск по двум пунктам — инструктаж и проверка знаний — и не
  смотрела на документы, хотя те же документы ниже помечены «Не заведён». Помощник
  с 11 отсутствующими обязательными документами видел зелёное «Допуск в порядке».
  Базовый экран помощника (/assistant) считает по трём условиям; v7 обязан так же.
*/
type Doc = AssistantState['documents'][number];
const doc = (over: Partial<Doc>): Doc => ({
  typeId: 'type-1', name: 'Медосмотр', required: true, verdict: 'VALID', number: '', expiresAt: null, daysLeft: null, ...over,
});

const state = (documents: Doc[], over: Partial<AssistantState> = {}): AssistantState => ({
  assistant: {id: 'a-1', name: 'Сидоров Сидор Сидорович'},
  documents,
  briefing: {code: 'И-СМ-06', title: 'Стропальные работы', version: '1.0', readingMinutes: 5, acknowledgedVersion: '1.0', ok: true},
  knowledge: {validUntil: '2026-11-15T08:00:00.000Z', lastResult: '8 из 8', ok: true},
  defects: [],
  crews: [],
  ...over,
});

const mount = async (value: AssistantState) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({data: value})})));
  render(<AssistantV7App />);
  await screen.findByText('Ознакомление с инструкцией');
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('помощник v7: сводка допуска', () => {
  it('инструктаж, знания и документы в порядке — допуск в порядке', async () => {
    await mount(state([doc({typeId: 't1'}), doc({typeId: 't2', verdict: 'EXPIRING'})]));

    expect(screen.getByText('Допуск в порядке')).toBeInTheDocument();
    expect(screen.queryByText('Допуск неполный')).not.toBeInTheDocument();
  });

  it('11 обязательных документов не заведено — допуск неполный и называет число', async () => {
    const missing = Array.from({length: 11}, (_, index) => doc({typeId: `m${index}`, name: `Документ ${index}`, verdict: 'MISSING'}));
    await mount(state(missing));

    expect(screen.queryByText('Допуск в порядке')).not.toBeInTheDocument();
    expect(screen.getByText('Допуск неполный')).toBeInTheDocument();
    expect(screen.getByText(/не заведены или просрочены.*11/i)).toBeInTheDocument();
  });

  it('просроченный обязательный документ тоже делает допуск неполным', async () => {
    await mount(state([doc({verdict: 'EXPIRED', daysLeft: -3})]));

    expect(screen.getByText('Допуск неполный')).toBeInTheDocument();
    expect(screen.getByText(/не заведены или просрочены.*1/i)).toBeInTheDocument();
  });

  it('необязательный документ допуск не портит', async () => {
    await mount(state([doc({required: false, verdict: 'MISSING'})]));

    expect(screen.getByText('Допуск в порядке')).toBeInTheDocument();
  });

  it('пока не пройден инструктаж или знания, документы сводку не меняют: прежний призыв пройти шаги', async () => {
    await mount(state([doc({verdict: 'MISSING'})], {briefing: {code: 'И-СМ-06', title: 'Стропальные работы', version: '1.0', readingMinutes: 5, acknowledgedVersion: null, ok: false}}));

    expect(screen.queryByText('Допуск в порядке')).not.toBeInTheDocument();
    expect(screen.getByText('Прохождение занимает 5–10 минут')).toBeInTheDocument();
  });
});
