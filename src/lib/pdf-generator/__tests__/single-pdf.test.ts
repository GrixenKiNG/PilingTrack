/**
 * Поведенческие тесты для generateSinglePdf (single-pdf.ts).
 *
 * Проверяем, что PDF собирается корректно для разных наборов данных,
 * пустые поля не ломают документ, генератор вызывается с правильными
 * данными, а при отсутствии отчёта происходит отказ.
 *
 * Внешние зависимости (pdfkit) мокаются; внутренняя логика — нет.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаем pdfkit ДО импорта продакшн-кода. vi.mock хоистится, поэтому фабрика
// должна быть в vi.hoisted, чтобы переменные были доступны.
// Используем класс для корректной работы с `new PDFDocument()`.
const { MockPDFDocumentClass } = vi.hoisted(() => {
  class MockPDFDocumentClass {
    static lastInstance: MockPDFDocumentClass | null = null;
    x = 0;
    y = 0;
    font = vi.fn().mockReturnThis();
    fontSize = vi.fn().mockReturnThis();
    fillColor = vi.fn().mockReturnThis();
    text = vi.fn().mockReturnThis();
    moveDown = vi.fn().mockReturnThis();
    moveTo = vi.fn().mockReturnThis();
    lineTo = vi.fn().mockReturnThis();
    strokeColor = vi.fn().mockReturnThis();
    lineWidth = vi.fn().mockReturnThis();
    stroke = vi.fn().mockReturnThis();
    rect = vi.fn().mockReturnThis();
    fill = vi.fn().mockReturnThis();
    addPage = vi.fn().mockReturnThis();
    switchToPage = vi.fn().mockReturnThis();
    bufferedPageRange = vi.fn().mockReturnValue({ start: 0, count: 1 });
    heightOfString = vi.fn().mockReturnValue(20);
    end = vi.fn();
    registerFont = vi.fn().mockReturnThis();
    on = vi.fn((event, cb) => {
      if (event === 'data') setTimeout(() => cb(Buffer.from('%PDF-1.4\n%%EOF')), 0);
      if (event === 'end') setTimeout(() => cb(), 0);
      if (event === 'error') return;
    });
    off = vi.fn();
    constructor() {
      MockPDFDocumentClass.lastInstance = this;
    }
  }

  return { MockPDFDocumentClass };
});

vi.mock('pdfkit', () => ({
  __esModule: true,
  default: MockPDFDocumentClass,
}));

// Импортируем ПОСЛЕ мока pdfkit
import { generateSinglePdf } from '../single-pdf';
import { PILE_LENGTH_UNKNOWN_LABEL, PILE_METERS_INCOMPLETE_NOTE } from '../components';

describe('generateSinglePdf — поведение', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockPDFDocumentClass.lastInstance = null;
  });

  const getDoc = () => {
    const instance = MockPDFDocumentClass.lastInstance;
    if (!instance) throw new Error('PDFDocument instance not created');
    return instance;
  };

  const baseReportData = {
    reportId: 'abc12345-def0-1234-5678-9abcdef01234',
    date: '2026-10-15',
    shiftStart: '08:00',
    shiftEnd: '20:00',
    shiftType: 'DAY',
    status: 'submitted',
    endingEngineHours: 1250.5,
    endingFuelPercent: 75,
    lastEditedByName: 'Иванов И.И.',
    lastEditedByRole: 'OPERATOR',
    assistantName: 'Петров П.П.',
    equipmentName: 'БУР-01',
    user: { name: 'Сидоров С.С.' },
    site: { name: 'Объект А' },
    companyName: 'ООО «Орион»',
    piles: [
      { pileGrade: { name: 'С-300', lengthMm: 12000 }, count: 10, metersPerUnit: 12 },
      { pileGrade: { name: 'С-400', lengthMm: 15000 }, count: 5, metersPerUnit: 15 },
    ],
    drillings: [
      { type: { name: 'Бурение Ø200' }, count: 3, metersPerUnit: 10, meters: 30 },
    ],
    downtimes: [
      { reason: { name: 'Ожидание бетона' }, duration: 1.5, comment: 'Заезд бетононасоса' },
      { reason: { name: 'Перестановка' }, duration: 0.5, comment: null },
    ],
    version: 1,
  } satisfies Parameters<typeof generateSinglePdf>[0];

  it('собирает PDF для полного отчёта со всеми секциями', async () => {
    const pdf = await generateSinglePdf(baseReportData);

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(0);
    // PDF начинается с заголовка
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('не ломается, когда все опциональные поля пусты (null/undefined/пустые строки)', async () => {
    const dataWithEmptyFields = {
      ...baseReportData,
      endingEngineHours: null,
      endingFuelPercent: null,
      lastEditedByName: null,
      lastEditedByRole: null,
      assistantName: '',
      equipmentName: '',
      user: null,
      site: null,
      companyName: undefined,
      piles: [],
      drillings: [],
      downtimes: [],
    } satisfies Parameters<typeof generateSinglePdf>[0];

    const pdf = await generateSinglePdf(dataWithEmptyFields);

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(0);
    // Должен быть нарисован пустой стейт — проверяем через текст
    const allText = getDoc().text.mock.calls.map((c) => c[0]).join('\n');
    expect(allText).toContain('В отчёте нет производственных работ или простоев.');
  });

  it('рисует заголовок с правильными данными отчёта (ID, дата, компания)', async () => {
    await generateSinglePdf(baseReportData);

    // Проверяем, что addHeader вызван с правильными аргументами через проверку текста
    const headerCalls = getDoc().text.mock.calls.filter((call) => {
      const text = call[0];
      return typeof text === 'string' && (text.includes('РАБОЧИЙ ОТЧЁТ') || text.includes('ABC12345'));
    });
    expect(headerCalls.length).toBeGreaterThan(0);

    // Проверяем наличие сокращённого ID и отформатированной даты
    const allText = getDoc().text.mock.calls.map((c) => c[0]).join('\n');
    expect(allText).toContain('ABC12345');
    expect(allText).toContain('15.10.2026');
    expect(allText).toContain('ООО «Орион»');
  });

  it('добавляет пометку «Корректировка, ред. №N» когда version > 1', async () => {
    const dataWithVersion = { ...baseReportData, version: 3 };
    await generateSinglePdf(dataWithVersion);

    const allText = getDoc().text.mock.calls.map((c) => c[0]).join('\n');
    expect(allText).toContain('Корректировка, ред. №3');
  });

  it('показывает «длина марки не задана» для свай без lengthMm и ставит пометку к итогу', async () => {
    const dataWithUnknownLength = {
      ...baseReportData,
      piles: [
        { pileGrade: { name: 'С-300', lengthMm: 12000 }, count: 10 },
        { pileGrade: { name: 'С-400', lengthMm: null }, count: 5 },
      ],
    };

    await generateSinglePdf(dataWithUnknownLength);

    const allText = getDoc().text.mock.calls.map((c) => c[0]).join('\n');
    expect(allText).toContain(PILE_LENGTH_UNKNOWN_LABEL);
    expect(allText).toContain(PILE_METERS_INCOMPLETE_NOTE);
  });

  it('корректно считает итоги: сваи, бурение, простои', async () => {
    await generateSinglePdf(baseReportData);

    const allText = getDoc().text.mock.calls.map((c) => c[0]).join('\n');
    // 10 + 5 = 15 свай, метры: 10*12 + 5*15 = 195 (formatNumber не добавляет лишние нули)
    expect(allText).toContain('15 шт. / 195 м.п.');
    // Бурение: 3шт, 30 м.п.
    expect(allText).toContain('3 шт. / 30 м.п.');
    // Простои: 1.5 + 0.5 = 2 часа
    expect(allText).toContain('2 ч');
  });

  it('рисует таблицу бурения только когда есть данные', async () => {
    const dataWithoutDrilling = { ...baseReportData, drillings: [] };
    await generateSinglePdf(dataWithoutDrilling);

    const allText = getDoc().text.mock.calls.map((c) => c[0]).join('\n');
    expect(allText).not.toContain('Лидерное бурение');
  });

  it('рисует таблицу простоя только когда есть данные', async () => {
    const dataWithoutDowntime = { ...baseReportData, downtimes: [] };
    await generateSinglePdf(dataWithoutDowntime);

    const allText = getDoc().text.mock.calls.map((c) => c[0]).join('\n');
    // Метрика "Простои" в полосе метрик всегда есть, но секция "Простои" с таблицей — только при наличии данных
    // Проверяем, что таблицы простоя нет (нет заголовков таблицы «Причина», «Длительность», «Комментарий»)
    expect(allText).not.toContain('Причина\nДлительность\nКомментарий');
    expect(allText).not.toContain('Заезд бетононасоса');
  });

  it('подставляет дефисы для отсутствующих значений в таблицах (reason.name, comment)', async () => {
    const dataWithMissingRefs = {
      ...baseReportData,
      piles: [{ pileGrade: { name: 'С-300', lengthMm: 12000 }, count: 1 }],
      drillings: [{ type: { name: 'Бурение' }, count: 1, metersPerUnit: 10, meters: 10 }],
      downtimes: [{ reason: { name: '' }, duration: 1, comment: '' }],
    };

    await generateSinglePdf(dataWithMissingRefs);

    const allText = getDoc().text.mock.calls.map((c) => c[0]).join('\n');
    // safeText превращает пустые строки в «—»
    expect(allText).toContain('—');
  });
});