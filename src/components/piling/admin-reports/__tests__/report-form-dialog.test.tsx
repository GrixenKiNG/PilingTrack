/**
 * Regression: the live "Итого" pile-meters total in the report form must come
 * from PileGrade.lengthMm (src/lib/pile-length.ts), not a 3-digit regex on the
 * grade name. "С90.30" has no 3-consecutive-digit run (old behaviour: 0 м.п.)
 * but a real lengthMm of 9000 — the same report's PDF and the reports-list
 * totals already compute via lengthMm and would show 45.0 м.п. for 5 piles.
 *
 * Prefilling via editReport (instead of driving the grade Select) avoids
 * needing to mount Radix Select interaction, which has no test precedent in
 * this codebase yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import type { ReportDTO } from '@/lib/types';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));

vi.mock('lucide-react', async (importActual) => ({
  ...(await importActual<typeof import('lucide-react')>()),
  Plus: () => null,
  Pencil: () => null,
  Trash2: () => null,
  HardHat: () => null,
  Drill: () => null,
  Clock: () => null,
  Wrench: () => null,
  Loader2: () => null,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));
vi.mock('@/components/piling/report-form/photo-section', () => ({
  PhotoSection: () => null,
}));

import { ReportFormDialog } from '../report-form-dialog';

const editReport = {
  id: 'r1',
  reportId: 'r1',
  userId: 'u1',
  siteId: 's1',
  date: '2026-06-21',
  piles: [{ id: 'p1', pileGradeId: 'g1', count: 5 }],
  drillings: [],
  downtimes: [],
} as unknown as ReportDTO;

describe('ReportFormDialog — pile meters total', () => {
  it('computes the total from PileGrade.lengthMm, not a 3-digit regex on the name', () => {
    render(
      <ReportFormDialog
        open
        onClose={vi.fn()}
        editReport={editReport}
        loadingReferenceData={false}
        dictionaryError={null}
        operators={[]}
        sites={[]}
        pileGrades={[{ id: 'g1', name: 'С90.30', isActive: true, lengthMm: 9000 }]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    // 9000mm / 1000 = 9.0 m/pile × 5 = 45.0 м.п. The old name-regex on "С90.30"
    // finds no 3-consecutive-digit run and would render "5 шт. / 0.0 м.п." instead.
    // Разделитель дробной части — запятая (Аудит 17, находка 9).
    expect(screen.getByText('5 шт. / 45,0 м.п.')).toBeTruthy();
  });
});

describe('ReportFormDialog — дата по умолчанию', () => {
  it('подставляет производственный день тенанта, а не UTC-день', () => {
    // 01:30 МСК 26.09 — UTC-день в этот момент ещё 25.09: прежняя подстановка
    // `new Date().toISOString().split('T')[0]` давала админу вчерашнюю дату.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T22:30:00.000Z'));
    try {
      const { container } = render(
        <ReportFormDialog
          open
          onClose={vi.fn()}
          editReport={null}
          loadingReferenceData={false}
          dictionaryError={null}
          operators={[]}
          sites={[]}
          pileGrades={[]}
          drillingTypes={[]}
          downtimeReasons={[]}
          equipment={[]}
          onSuccess={vi.fn()}
        />,
      );

      const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
      expect(dateInput.value).toBe('2026-09-26');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ReportFormDialog — сетевой обрыв (F-R93-3)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('показывает русский текст вместо браузерного «Failed to fetch»', async () => {
    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(
      <ReportFormDialog
        open
        onClose={vi.fn()}
        editReport={editReport}
        loadingReferenceData={false}
        dictionaryError={null}
        operators={[]}
        sites={[]}
        pileGrades={[{ id: 'g1', name: 'С90.30', isActive: true, lengthMm: 9000 }]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет связи с сервером. Проверьте интернет и нажмите «Сохранить» ещё раз.',
    ));
  });
});

describe('ReportFormDialog — CSRF-403 (F-R93-4)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('английский текст CSRF заменяется русским про проверку безопасности', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'CSRF validation failed: origin mismatch' }),
    });

    render(
      <ReportFormDialog
        open
        onClose={vi.fn()}
        editReport={editReport}
        loadingReferenceData={false}
        dictionaryError={null}
        operators={[]}
        sites={[]}
        pileGrades={[{ id: 'g1', name: 'С90.30', isActive: true, lengthMm: 9000 }]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Запрос отклонён проверкой безопасности. Обновите страницу и повторите сохранение.',
    ));
  });
});

describe('ReportFormDialog — конфликт 409 (F-R93-2)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  it('перечитывает свежую версию, не закрывает форму и не советует терять правки', async () => {
    authFetchMock.mockImplementation((url: string, init?: RequestInit) => {
      void init;
      if (url.startsWith('/api/reports/admin-upsert')) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ error: 'Отчёт был изменён другим пользователем. Обновите страницу и сохраните заново.' }),
        });
      }
      if (url.startsWith('/api/reports/all')) {
        // Свежая версия того же отчёта: id из editReport = 'r1'.
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ reports: [{ reportId: 'r1', version: 7 }] }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    const onClose = vi.fn();

    render(
      <ReportFormDialog
        open
        onClose={onClose}
        editReport={editReport}
        loadingReferenceData={false}
        dictionaryError={null}
        operators={[]}
        sites={[]}
        pileGrades={[{ id: 'g1', name: 'С90.30', isActive: true, lengthMm: 9000 }]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Отчёт изменён другим пользователем. Ваши правки сохранены — нажмите «Сохранить» ещё раз.',
    ));
    // Форма не закрыта — введённые сваи не потеряны.
    expect(onClose).not.toHaveBeenCalled();

    // Повтор отправляет уже свежую версию, а не прежнюю.
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    await waitFor(() => {
      const posts = authFetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/reports/admin-upsert'));
      expect(posts).toHaveLength(2);
      const body = JSON.parse(String((posts[1][1] as RequestInit).body));
      expect(body.version).toBe(7);
    });
  });
});

describe('ReportFormDialog — построчные ошибки сервера', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it('показывает поля из details.fieldErrors, а не одно «Некорректные данные»', async () => {
    // 400 админского маршрута: `details` — zod-`fieldErrors`.
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Некорректные данные',
        details: { formErrors: [], fieldErrors: { count: ['Ожидалось число'] } },
      }),
    });

    render(
      <ReportFormDialog
        open
        onClose={vi.fn()}
        editReport={editReport}
        loadingReferenceData={false}
        dictionaryError={null}
        operators={[]}
        sites={[]}
        pileGrades={[{ id: 'g1', name: 'С90.30', isActive: true, lengthMm: 9000 }]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Некорректные данные\nПоле count: Ожидалось число'));
  });
});

describe('ReportFormDialog — непрочитанные справочники', () => {
  it('показывает причину над полями, а не пустые списки без объяснения', () => {
    render(
      <ReportFormDialog
        open
        onClose={vi.fn()}
        editReport={null}
        loadingReferenceData={false}
        dictionaryError="Справочники не загрузились — списки в форме пустые"
        operators={[]}
        sites={[]}
        pileGrades={[]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Справочники не загрузились — списки в форме пустые');
  });
});

describe('ReportFormDialog — архивная марка (F-R29-2)', () => {
  it('не предлагает архивную марку в выборе, но показывает её в строке и считает метры', () => {
    render(
      <ReportFormDialog
        open
        onClose={vi.fn()}
        editReport={editReport}
        loadingReferenceData={false}
        dictionaryError={null}
        operators={[]}
        sites={[]}
        pileGrades={[{ id: 'g1', name: 'СВ 300-80', isActive: false, lengthMm: 12000 }]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    // Строка сданного отчёта: название и метры (5 × 11,999... = 60.0 м.п.),
    // а не сырой cuid и 0 м.п. Дробная часть — с запятой (Аудит 17, находка 9).
    expect(screen.getByText('5 шт. / 60,0 м.п.')).toBeTruthy();
    // Название встречается ровно один раз — в строке отчёта. Второе вхождение
    // означало бы, что архивная марка попала в список выбора новой строки.
    expect(screen.queryAllByText('СВ 300-80')).toHaveLength(1);
  });
});

describe('ReportFormDialog — доступные имена кнопок «+» (F-R116-1)', () => {
  it('у каждой кнопки добавления своё имя, а не три одинаковых «кнопка»', () => {
    render(
      <ReportFormDialog
        open
        onClose={vi.fn()}
        editReport={editReport}
        loadingReferenceData={false}
        dictionaryError={null}
        operators={[]}
        sites={[]}
        pileGrades={[{ id: 'g1', name: 'С90.30', isActive: true, lengthMm: 9000 }]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    // Секция простоя скрыта, пока её не раскрыли ссылкой «+ Добавить».
    expect(screen.queryByRole('button', { name: 'Добавить простой' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));

    expect(screen.getByRole('button', { name: 'Добавить сваю' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить бурение' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить простой' })).toBeTruthy();
  });
});

describe('ReportFormDialog — доступные имена полей смены (F-R116-3)', () => {
  it('подписи «Дата», «Начало», «Конец» связаны с полями, а не висят рядом', () => {
    render(
      <ReportFormDialog
        open
        onClose={vi.fn()}
        editReport={editReport}
        loadingReferenceData={false}
        dictionaryError={null}
        operators={[]}
        sites={[]}
        pileGrades={[{ id: 'g1', name: 'С90.30', isActive: true, lengthMm: 9000 }]}
        drillingTypes={[]}
        downtimeReasons={[]}
        equipment={[]}
        onSuccess={vi.fn()}
      />,
    );

    // Прежде подписи рисовались без htmlFor/id — скринридер читал поля «без имени».
    expect(screen.getByLabelText('Дата')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Начало')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Конец')).toBeInstanceOf(HTMLInputElement);
  });
});
