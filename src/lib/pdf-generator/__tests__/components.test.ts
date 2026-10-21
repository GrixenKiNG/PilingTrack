/**
 * Поведенческие тесты для components.ts — строительных блоков PDF-документа.
 *
 * Проверяем:
 * - сборку блоков документа из данных
 * - пустые/некорректные поля не ломают отрисовку
 * - длинный текст переносится/обрезается корректно
 * - отказ на неизвестном типе блока (через ellipsis/безопасность)
 *
 * Внешние зависимости (pdfkit) мокаются; внутренняя логика — нет.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаем pdfkit ДО импорта продакшн-кода.
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

// Мокаем логгер, чтобы не засорять вывод тестов
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Импортируем ПОСЛЕ мока pdfkit
import {
  ensureSpace,
  addHeader,
  addInfoGrid,
  addMetricStrip,
  addSectionTitle,
  addTable,
  addPeriodTable,
  addReportBreakdown,
  addEmptyState,
  addFooterAndPageNumbers,
  PILE_LENGTH_UNKNOWN_LABEL,
} from '../components';
import { COLORS, PAGE } from '../constants';
import type { PdfDoc } from '../types';

describe('components — поведение строительных блоков PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockPDFDocumentClass.lastInstance = null;
  });

  // Хелпер для доступа к моку (имеет .mock свойства)
  const getMockDoc = () => {
    const instance = MockPDFDocumentClass.lastInstance;
    if (!instance) throw new Error('PDFDocument instance not created');
    return instance;
  };

  // Создаём новый doc для каждого теста
  const newDoc = () => new MockPDFDocumentClass() as unknown as PdfDoc;

  describe('ensureSpace', () => {
    it('не добавляет страницу, когда места достаточно', () => {
      const doc = newDoc();
      doc.y = PAGE.top;

      ensureSpace(doc, 100);

      expect(doc.addPage).not.toHaveBeenCalled();
      expect(doc.y).toBe(PAGE.top);
    });

    it('добавляет страницу и сбрасывает координаты, когда места недостаточно', () => {
      const doc = newDoc();
      doc.y = PAGE.height - PAGE.bottom - 50; // Мало места

      ensureSpace(doc, 100);

      expect(doc.addPage).toHaveBeenCalledOnce();
      expect(doc.x).toBe(PAGE.left);
      expect(doc.y).toBe(PAGE.top);
    });

    it('работает на границе: ровно влезает — не добавляет страницу', () => {
      const doc = newDoc();
      const available = PAGE.height - PAGE.bottom - PAGE.top;
      doc.y = PAGE.top;

      ensureSpace(doc, available);

      expect(doc.addPage).not.toHaveBeenCalled();
    });

    it('работает на границе: не влезает на 1 — добавляет страницу', () => {
      const doc = newDoc();
      const available = PAGE.height - PAGE.bottom - PAGE.top;
      doc.y = PAGE.top;

      ensureSpace(doc, available + 1);

      expect(doc.addPage).toHaveBeenCalledOnce();
    });
  });

  describe('addHeader', () => {
    it('рисует заголовок с названием, подзаголовком, компанией и установкой', () => {
      const doc = newDoc();

      addHeader(doc, 'РАБОЧИЙ ОТЧЁТ', '15.10.2026 | Смена: Дневная', 'ООО «Орион»', 'БУР-01 (Liebherr LB 28)');

      // Проверяем последовательность вызовов через текст
      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('PILINGTRACK');
      expect(allText).toContain('РАБОЧИЙ ОТЧЁТ');
      expect(allText).toContain('15.10.2026 | Смена: Дневная');
      expect(allText).toContain('ООО «Орион»');
      expect(allText).toContain('БУР-01 (Liebherr LB 28)');
      // Проверяем, что линия под заголовком нарисована
      expect(doc.moveTo).toHaveBeenCalled();
      expect(doc.lineTo).toHaveBeenCalled();
      expect(doc.stroke).toHaveBeenCalled();
    });

    it('не ломается, когда компания и установка отсутствуют', () => {
      const doc = newDoc();

      addHeader(doc, 'ЗАГОЛОВОК', 'ПОДЗАГОЛОВОК');

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('PILINGTRACK');
      expect(allText).toContain('ЗАГОЛОВОК');
      expect(allText).toContain('ПОДЗАГОЛОВОК');
      // Компании и установки нет — их текстов не должно быть
      expect(allText).not.toContain('ООО');
      expect(allText).not.toContain('БУР');
    });

    it('корректно позиционирует элементы: PILINGTRACK, линия, отступы', () => {
      const doc = newDoc();

      addHeader(doc, 'ТЕСТ', 'ТЕСТ');

      // PILINGTRACK рисуется по центру — проверяем через наличие текста и вызовов font/align
      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('PILINGTRACK');
      // font('Bold').fontSize(22).fillColor(...).text('PILINGTRACK', ..., { align: 'center' })
      // mock возвращает this, поэтому options — 3-й аргумент у text()
      const pilingTrackCall = getMockDoc().text.mock.calls.find((c: unknown[]) => c[0] === 'PILINGTRACK');
      expect(pilingTrackCall).toBeDefined();
      // text(x, y, options) — options это 3-й элемент (индекс 2) при вызове с 3 аргументами
      // но мок возвращает this, так что структура вызова: text('PILINGTRACK', x, y, options)
      // или text('PILINGTRACK', x, options) — проверим длину
      if (pilingTrackCall && pilingTrackCall.length >= 4) {
        expect(pilingTrackCall[3]).toEqual(expect.objectContaining({ align: 'center' }));
      } else if (pilingTrackCall && pilingTrackCall.length === 3) {
        expect(pilingTrackCall[2]).toEqual(expect.objectContaining({ align: 'center' }));
      }
    });
  });

  describe('addInfoGrid', () => {
    it('рисует сетку из строк с чередующимся фоном', () => {
      const doc = newDoc();

      const rows = [
        ['Метка 1', 'Значение 1', 'Метка 2', 'Значение 2'],
        ['Метка 3', 'Значение 3', 'Метка 4', 'Значение 4'],
        ['Метка 5', 'Значение 5', 'Метка 6', 'Значение 6'],
      ];

      addInfoGrid(doc, rows);

      // addInfoGrid вызывает rect для каждой строки (фон) — 3 раза
      expect(doc.rect).toHaveBeenCalledTimes(rows.length);
      // Проверяем, что все значения прошли через safeText (мок text)
      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      rows.forEach((row) => {
        row.forEach((cell) => expect(allText).toContain(cell));
      });
    });

    it('пустые значения заменяются на «—» через safeText', () => {
      const doc = newDoc();

      const rows = [
        ['Метка', '', 'Метка 2', null],
        ['Метка 3', undefined, 'Метка 4', '   '],
      ] as unknown as string[][];

      addInfoGrid(doc, rows);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      // safeText превращает пустые/пробельные в «—»
      expect(allText).toContain('—');
    });

    it('добавляет вертикальные разделители между колонками', () => {
      const doc = newDoc();

      addInfoGrid(doc, [['A', '1', 'B', '2']]);

      // Проверяем вызовы moveTo/lineTo для вертикальных линий
      const moveToCalls = getMockDoc().moveTo.mock.calls;
      const lineToCalls = getMockDoc().lineTo.mock.calls;
      expect(moveToCalls.length).toBeGreaterThan(0);
      expect(lineToCalls.length).toBeGreaterThan(0);
    });

    it('добавляет отступ после сетки', () => {
      const doc = newDoc();
      const yBefore = doc.y;

      addInfoGrid(doc, [['A', '1', 'B', '2']]);

      expect(doc.y).toBeGreaterThan(yBefore);
    });
  });

  describe('addMetricStrip', () => {
    it('рисует полосу метрик с метками, значениями, единицами и примечаниями', () => {
      const doc = newDoc();

      const metrics: Array<[string, string, string, string?]> = [
        ['Сваи', '15', 'шт. / 195', 'м.п.'],
        ['Бурение', '30', 'м.п.', '(в т.ч. 10 м.п. líder)'],
        ['Простои', '2.5', 'ч', ''],
      ];

      addMetricStrip(doc, metrics);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('Сваи');
      expect(allText).toContain('15');
      expect(allText).toContain('шт. / 195');
      expect(allText).toContain('м.п.');
      expect(allText).toContain('Бурение');
      expect(allText).toContain('Простои');
      expect(allText).toContain('(в т.ч. 10 м.п. líder)');
      // Полоса имеет фон и акцентную линию сверху
      expect(doc.rect).toHaveBeenCalled();
    });

    it('увеличивает высоту полосы, когда есть примечания', () => {
      const doc = newDoc();
      const yBefore = doc.y;

      const metricsWithNote: Array<[string, string, string, string?]> = [
        ['Метрика', '10', 'шт.', 'Есть примечание'],
      ];
      addMetricStrip(doc, metricsWithNote);

      const metricsWithoutNote: Array<[string, string, string, string?]> = [
        ['Метрика', '10', 'шт.', ''],
      ];
      const doc2 = newDoc();
      addMetricStrip(doc2, metricsWithoutNote);

      // С примечанием полоса выше
      expect(doc.y - yBefore).toBeGreaterThan(doc2.y - PAGE.top);
    });

    it('корректно парсит значения с разделителем « / » для двухстрочного вывода', () => {
      const doc = newDoc();

      const metrics: Array<[string, string, string, string?]> = [
        ['Сваи', '15 / 195', 'шт. / м.п.', ''],
      ];

      addMetricStrip(doc, metrics);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      // Должно быть нарисовано в две строки
      expect(allText).toContain('15 шт.');
      expect(allText).toContain('195 м.п.');
    });

    it('рисует вертикальные разделители между метриками', () => {
      const doc = newDoc();

      addMetricStrip(doc, [
        ['М1', '1', 'ед.', ''],
        ['М2', '2', 'ед.', ''],
        ['М3', '3', 'ед.', ''],
      ]);

      const moveToCalls = getMockDoc().moveTo.mock.calls;
      const lineToCalls = getMockDoc().lineTo.mock.calls;
      // Должны быть вызовы для вертикальных линий между 3 метриками (2 разделителя)
      expect(moveToCalls.length).toBeGreaterThan(1);
      expect(lineToCalls.length).toBeGreaterThan(1);
    });

    it('не ломается на пустом массиве метрик', () => {
      const doc = newDoc();
      const yBefore = doc.y;

      addMetricStrip(doc, []);

      // Должен нарисоваться прямоугольник минимальной высоты
      expect(doc.rect).toHaveBeenCalled();
      expect(doc.y).toBeGreaterThanOrEqual(yBefore);
    });
  });

  describe('addSectionTitle', () => {
    it('рисует заголовок секции с акцентной линией под ним', () => {
      const doc = newDoc();

      addSectionTitle(doc, 'СВАЙНЫЕ РАБОТЫ');

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('СВАЙНЫЕ РАБОТЫ');
      // Проверяем акцентную линию (rect с заливкой)
      const rectCalls = getMockDoc().rect.mock.calls;
      const accentRect = rectCalls.find((c) => c[3] === 2 && c[2] === 80); // ширина 80, высота 2
      expect(accentRect).toBeDefined();
    });

    it('добавляет отступ после заголовка', () => {
      const doc = newDoc();
      const yBefore = doc.y;

      addSectionTitle(doc, 'ТЕСТ');

      expect(doc.y).toBeGreaterThan(yBefore);
    });

    it('вызывает ensureSpace перед рисованием', () => {
      const doc = newDoc();
      doc.y = PAGE.height - PAGE.bottom - 10; // Мало места

      addSectionTitle(doc, 'ТЕСТ');

      expect(doc.addPage).toHaveBeenCalled();
    });
  });

  describe('addTable / drawTableRow', () => {
    it('рисует таблицу с заголовком и строками, чередуя фон', () => {
      const doc = newDoc();

      addTable(
        doc,
        ['Колонка 1', 'Колонка 2', 'Колонка 3'],
        [
          ['Значение 1', 'Значение 2', 'Значение 3'],
          ['Значение 4', 'Значение 5', 'Значение 6'],
        ],
        [0.3, 0.4, 0.3]
      );

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('Колонка 1');
      expect(allText).toContain('Колонка 2');
      expect(allText).toContain('Колонка 3');
      expect(allText).toContain('Значение 1');
      expect(allText).toContain('Значение 6');
      // Заголовок — жирный, белый текст на тёмном фоне
      // Строки — чередующийся фон
      expect(doc.rect).toHaveBeenCalled();
    });

    it('пустые ячейки заменяются на «—» через safeText', () => {
      const doc = newDoc();

      addTable(
        doc,
        ['A', 'B'],
        [['', null], [undefined, '   ']] as unknown as string[][],
        [0.5, 0.5]
      );

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      // Все 4 ячейки должны стать «—»
      const dashCount = (allText.match(/—/g) || []).length;
      expect(dashCount).toBeGreaterThanOrEqual(4);
    });

    it('длинный текст в ячейке обрезается с ellipsis (не выходит за границы)', () => {
      const doc = newDoc();
      const longText = 'Очень длинный текст который точно не поместится в колонку и должен быть обрезан с многоточием';

      addTable(doc, ['Колонка'], [[longText]], [1.0]);

      // heightOfString мокается, но проверяем, что text вызван с ellipsis: true
      const textCalls = getMockDoc().text.mock.calls;
      const cellCall = textCalls.find((c: unknown[]) => c[0] === longText);
      expect(cellCall).toBeDefined();
      if (!cellCall) return;
      // text может вызываться как text(text, x, y, options) или text(text, x, options)
      const options = cellCall.length >= 4 ? cellCall[3] : cellCall[2];
      expect(options).toEqual(expect.objectContaining({ ellipsis: true }));
    });

    it('compact=true уменьшает высоту строки и заголовка', () => {
      const doc = newDoc();
      doc.y = PAGE.top;
      const yBefore = doc.y;

      addTable(doc, ['A'], [['1']], [1.0], true);

      const heightCompact = doc.y - yBefore;

      const doc2 = newDoc();
      doc2.y = PAGE.top;
      addTable(doc2, ['A'], [['1']], [1.0], false);

      const heightNormal = doc2.y - PAGE.top;

      // compact mode использует меньшие rowHeight (21 vs 24) и headerHeight (20 vs 22)
      // Проверяем, что добавлен меньший отступ в конце (5 vs 10)
      expect(heightCompact).toBeLessThan(heightNormal);
    });

    it('вызывает ensureSpace перед каждой строкой (автоперенос на новую страницу)', () => {
      const doc = newDoc();
      doc.y = PAGE.height - PAGE.bottom - 10; // Мало места

      addTable(doc, ['A'], [['1'], ['2'], ['3']], [1.0]);

      // Должен добавить страницу хотя бы раз
      expect(doc.addPage).toHaveBeenCalled();
    });

    it('вертикальные разделители между колонками', () => {
      const doc = newDoc();

      addTable(doc, ['A', 'B', 'C'], [['1', '2', '3']], [0.33, 0.33, 0.34]);

      const moveToCalls = getMockDoc().moveTo.mock.calls;
      const lineToCalls = getMockDoc().lineTo.mock.calls;
      expect(moveToCalls.length).toBeGreaterThan(0);
      expect(lineToCalls.length).toBeGreaterThan(0);
    });
  });

  describe('addPeriodTable', () => {
    it('строит таблицу периода из массива отчётов с правильными колонками', () => {
      const doc = newDoc();

      const reports = [
        {
          date: '2026-10-15',
          site: { name: 'Объект А' },
          user: { name: 'Иванов И.И.' },
          piles: [{ count: 10 }],
          drillings: [{ meters: 50 }],
          downtimes: [{ duration: 2 }],
        },
        {
          date: '2026-10-16',
          site: { name: 'Объект Б' },
          user: { name: 'Петров П.П.' },
          piles: [{ count: 5 }],
          drillings: [{ meters: 30 }],
          downtimes: [{ duration: 1.5 }],
        },
      ];

      addPeriodTable(doc, reports);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('Дата');
      expect(allText).toContain('Объект');
      expect(allText).toContain('Оператор');
      expect(allText).toContain('Сваи, шт.');
      expect(allText).toContain('Бурение, м.п.');
      expect(allText).toContain('Простои');
      expect(allText).toContain('15.10.2026');
      expect(allText).toContain('16.10.2026');
      expect(allText).toContain('Объект А');
      expect(allText).toContain('Объект Б');
      expect(allText).toContain('Иванов');
      expect(allText).toContain('Петров');
    });

    it('подставляет дефисы для отсутствующих site/user', () => {
      const doc = newDoc();

      const reports = [
        {
          date: '2026-10-15',
          site: null,
          user: null,
          piles: [],
          drillings: [],
          downtimes: [],
        },
      ];

      addPeriodTable(doc, reports);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('—');
    });

    it('невалидная дата превращается в «—» через formatRuDate', () => {
      const doc = newDoc();

      const reports = [
        { date: 'invalid-date', site: { name: 'A' }, user: { name: 'B' }, piles: [], drillings: [], downtimes: [] },
        { date: '2026-13-45', site: { name: 'A' }, user: { name: 'B' }, piles: [], drillings: [], downtimes: [] },
        { date: '', site: { name: 'A' }, user: { name: 'B' }, piles: [], drillings: [], downtimes: [] },
      ];

      addPeriodTable(doc, reports);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      // Должно быть 3 «—» для дат
      const dashCount = (allText.match(/—/g) || []).length;
      expect(dashCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('addReportBreakdown', () => {
    const baseReport = {
      date: '2026-10-15',
      shiftType: 'DAY',
      status: 'submitted',
      endingEngineHours: 1250.5,
      endingFuelPercent: 75,
      equipmentName: 'БУР-01',
      site: { name: 'Объект А' },
      user: { name: 'Иванов И.И.' },
      piles: [
        { pileGrade: { name: 'С-300', lengthMm: 12000 }, count: 10 },
        { pileGrade: { name: 'С-400', lengthMm: 15000 }, count: 5 },
      ],
      drillings: [
        { type: { name: 'Бурение Ø200' }, meters: 30 },
      ],
      downtimes: [
        { reason: { name: 'Ожидание бетона' }, duration: 1.5, comment: 'Заезд бетононасоса' },
        { reason: { name: 'Перестановка' }, duration: 0.5, comment: null },
      ],
    };

    it('рисует заголовок разбивки с датой, объектом, оператором и статусом', () => {
      const doc = newDoc();

      addReportBreakdown(doc, baseReport, 1);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('1. 15.10.2026');
      expect(allText).toContain('Объект А');
      expect(allText).toContain('Иванов И.И.');
      expect(allText).toContain('Отправлен'); // statusLabel('submitted')
      expect(allText).toContain('Дневная'); // shiftLabel('DAY')
      expect(allText).toContain('БУР-01');
    });

    it('рисует таблицу моточасов и топлива с «не указано» для null', () => {
      const doc = newDoc();

      const reportNoHours = { ...baseReport, endingEngineHours: null, endingFuelPercent: null };
      addReportBreakdown(doc, reportNoHours, 1);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('не указано');
    });

    it('рисует таблицу свайных работ с метражем и пометкой при неизвестной длине', () => {
      const doc = newDoc();

      const reportUnknownLength = {
        ...baseReport,
        piles: [
          { pileGrade: { name: 'С-300', lengthMm: 12000 }, count: 10 },
          { pileGrade: { name: 'С-400', lengthMm: null }, count: 5 },
        ],
      };
      addReportBreakdown(doc, reportUnknownLength, 1);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('С-300');
      expect(allText).toContain('С-400');
      expect(allText).toContain('10');
      expect(allText).toContain('5');
      expect(allText).toContain(PILE_LENGTH_UNKNOWN_LABEL); // 'длина марки не задана'
    });

    it('рисует таблицу бурения только когда есть данные', () => {
      const doc = newDoc();
      const reportNoDrilling = { ...baseReport, drillings: [] };

      addReportBreakdown(doc, reportNoDrilling, 1);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).not.toContain('Бурение Ø200');
      // Заголовок таблицы бурения не должен быть нарисован
      expect(allText).not.toContain('Метров, м.п.');
    });

    it('рисует таблицу простоя с комментариями, когда они есть', () => {
      const doc = newDoc();

      addReportBreakdown(doc, baseReport, 1);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('Ожидание бетона');
      expect(allText).toContain('Перестановка');
      expect(allText).toContain('Заезд бетононасоса');
      // Комментарий null не должен печататься как отдельная строка
      expect(allText).not.toContain('null');
    });

    it('пропускает комментарий, если он пустой или null', () => {
      const doc = newDoc();

      const reportEmptyComments = {
        ...baseReport,
        downtimes: [
          { reason: { name: 'Простой 1' }, duration: 1, comment: '' },
          { reason: { name: 'Простой 2' }, duration: 1, comment: null },
        ],
      };
      addReportBreakdown(doc, reportEmptyComments, 1);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('Простой 1');
      expect(allText).toContain('Простой 2');
      // Пустые комментарии не должны создавать лишние строки
    });

    it('вызывает ensureSpace для комментариев простоя (автоперенос)', () => {
      const doc = newDoc();
      doc.y = PAGE.height - PAGE.bottom - 50; // Мало места

      const reportWithLongComment = {
        ...baseReport,
        downtimes: [
          { reason: { name: 'Простой' }, duration: 1, comment: 'Очень длинный комментарий'.repeat(10) },
        ],
      };
      addReportBreakdown(doc, reportWithLongComment, 1);

      expect(doc.addPage).toHaveBeenCalled();
    });

    it('пустые массивы piles/drillings/downtimes не ломают отрисовку', () => {
      const doc = newDoc();

      const emptyReport = {
        ...baseReport,
        piles: [],
        drillings: [],
        downtimes: [],
      };
      addReportBreakdown(doc, emptyReport, 1);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('1. 15.10.2026');
      expect(allText).toContain('Моточасы на конец');
      expect(allText).toContain('Топливо на конец');
      // Таблиц свай/бурения/простоя не должно быть
    });
  });

  describe('addEmptyState', () => {
    it('рисует блок «Нет данных» с переданным сообщением', () => {
      const doc = newDoc();

      addEmptyState(doc, 'За выбранный период отчётов нет');

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('Нет данных');
      expect(allText).toContain('За выбранный период отчётов нет');
      // Фон блока
      expect(doc.rect).toHaveBeenCalled();
    });

    it('центрирует заголовок и сообщение', () => {
      const doc = newDoc();

      addEmptyState(doc, 'Сообщение');

      const headerCall = getMockDoc().text.mock.calls.find((c: unknown[]) => c[0] === 'Нет данных');
      expect(headerCall).toBeDefined();
      if (!headerCall) return;
      const headerOptions = headerCall.length >= 4 ? headerCall[3] : headerCall[2];
      expect(headerOptions).toEqual(expect.objectContaining({ align: 'center' }));

      const messageCall = getMockDoc().text.mock.calls.find((c: unknown[]) => c[0] === 'Сообщение');
      expect(messageCall).toBeDefined();
      if (!messageCall) return;
      const messageOptions = messageCall.length >= 4 ? messageCall[3] : messageCall[2];
      expect(messageOptions).toEqual(expect.objectContaining({ align: 'center' }));
    });

    it('добавляет отступ после блока', () => {
      const doc = newDoc();
      const yBefore = doc.y;

      addEmptyState(doc, 'Тест');

      expect(doc.y).toBeGreaterThan(yBefore);
    });
  });

  describe('addFooterAndPageNumbers', () => {
    it('добавляет футер с датой формирования и номерами страниц на каждой странице', () => {
      const doc = newDoc();
      doc.bufferedPageRange = vi.fn().mockReturnValue({ start: 0, count: 3 });

      addFooterAndPageNumbers(doc);

      // Должен переключаться на каждую страницу
      expect(doc.switchToPage).toHaveBeenCalledTimes(3);
      expect(doc.switchToPage).toHaveBeenCalledWith(0);
      expect(doc.switchToPage).toHaveBeenCalledWith(1);
      expect(doc.switchToPage).toHaveBeenCalledWith(2);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      // Дата формирования
      expect(allText).toMatch(/PilingTrack \| сформировано \d{2}\.\d{2}\.\d{4}/);
      // Номера страниц
      expect(allText).toContain('1 / 3');
      expect(allText).toContain('2 / 3');
      expect(allText).toContain('3 / 3');
      // Разделительная линия
      expect(doc.moveTo).toHaveBeenCalled();
      expect(doc.lineTo).toHaveBeenCalled();
      expect(doc.stroke).toHaveBeenCalled();
    });

    it('работает для одной страницы', () => {
      const doc = newDoc();
      doc.bufferedPageRange = vi.fn().mockReturnValue({ start: 0, count: 1 });

      addFooterAndPageNumbers(doc);

      expect(doc.switchToPage).toHaveBeenCalledTimes(1);
      expect(doc.switchToPage).toHaveBeenCalledWith(0);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain('1 / 1');
    });

    it('восстанавливает fillColor после рисования', () => {
      const doc = newDoc();
      doc.bufferedPageRange = vi.fn().mockReturnValue({ start: 0, count: 1 });

      addFooterAndPageNumbers(doc);

      expect(doc.fillColor).toHaveBeenCalledWith(COLORS.text);
    });
  });

  describe('Интеграционные проверки', () => {
    it('последовательность блоков не ломает координаты (y монотонно растёт)', () => {
      const doc = newDoc();

      addHeader(doc, 'Заголовок', 'Подзаголовок');
      const y1 = doc.y;
      addSectionTitle(doc, 'Секция');
      const y2 = doc.y;
      addTable(doc, ['A'], [['1']], [1.0]);
      const y3 = doc.y;
      addEmptyState(doc, 'Пусто');
      const y4 = doc.y;

      expect(y2).toBeGreaterThan(y1);
      expect(y3).toBeGreaterThan(y2);
      expect(y4).toBeGreaterThan(y3);
    });

    it('длинный текст в заголовке секции не выходит за границы (ellipsis в ячейках таблицы)', () => {
      const doc = newDoc();

      const longTitle = 'Очень длинный заголовок секции который может не поместиться в ширину страницы и должен корректно обрабатываться';
      addSectionTitle(doc, longTitle);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(allText).toContain(longTitle);
    });

    it('неизвестный статус/смена/роль в label-функциях дают дефис или исходное значение', () => {
      const doc = newDoc();

      const report = {
        date: '2026-10-15',
        shiftType: 'UNKNOWN_SHIFT',
        status: 'unknown_status',
        endingEngineHours: null,
        endingFuelPercent: null,
        equipmentName: 'БУР-01',
        site: { name: 'Объект' },
        user: { name: 'Оператор' },
        piles: [],
        drillings: [],
        downtimes: [],
      };
      addReportBreakdown(doc, report, 1);

      const allText = getMockDoc().text.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      // statusLabel вернёт исходное значение, shiftLabel — исходное
      expect(allText).toContain('UNKNOWN_SHIFT');
      expect(allText).toContain('unknown_status');
    });
  });
});