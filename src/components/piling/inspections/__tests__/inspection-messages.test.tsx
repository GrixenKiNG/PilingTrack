/**
 * F-R100 (важно №1–№4, №6, №7, №8): сообщения раздела «осмотры техники» на
 * исходах 403/404/5xx/обрыв/401. Раньше отказ выдавался за «данных нет»
 * («Осмотров не найдено.», «Осмотр не найден.», «Шаблонов пока нет.», пустая
 * галерея фото), редактор на сбое чтения открывал пустую форму под заголовком
 * «Редактировать шаблон», а сохранение показывало серверные английские строки.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  push: vi.fn(),
  // Один и тот же объект на каждый вызов: новый объект давал новый `load`
  // в зависимости эффекта и бесконечную перезагрузку.
  user: { id: 'u1', name: 'Иванов И.И.' },
}));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (state: { currentUser: { id: string; name: string } }) => unknown) =>
    selector({ currentUser: mocks.user }),
}));

import { InspectionsList } from '../inspections-list';
import { RunInspection } from '../run-inspection';
import { TemplateList } from '../template-list';
import { TemplateEditor } from '../template-editor';
import { InspectionItemPhotos } from '../inspection-item-photos';
import { extractApiError, isRetryableLoadError, loadErrorText, InspectionLoadError } from '../inspection-api-error';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const item = (id: string, sectionTitle: string) => ({
  id,
  sectionTitle,
  text: `Пункт ${id}`,
  answerType: 'YES_NO',
  unit: null,
  norm: null,
  provenance: null,
  required: true,
  photoRequired: false,
});

function detail(templateSnapshot: unknown[]) {
  return {
    id: 'insp-1',
    status: 'DRAFT',
    level: 'EO',
    inspectionDate: '2026-09-30',
    shift: null,
    engineHours: null,
    healthScore: null,
    equipment: { id: 'eq-1', name: 'СП-49', model: 'PVE 50PR' },
    phase: 'PRE_SHIFT',
    templateSnapshot,
    answers: [],
  };
}

const templatePayload = {
  template: {
    name: 'ЕО — установка',
    level: 'EO',
    blockType: 'BASE',
    appliesToModel: null,
    appliesToHammerKind: 'NONE',
    sections: [{
      title: 'Двигатель',
      items: [{
        text: 'Уровень масла',
        answerType: 'YES_NO',
        unit: null,
        norm: null,
        provenance: null,
        photoRequired: false,
        required: true,
        createsDefect: false,
        defectSeverity: 'NORMAL',
      }],
    }],
  },
};

const retryCalls = (url: string) =>
  mocks.authFetch.mock.calls.filter(([u]) => u === url).length;

beforeEach(() => {
  mocks.authFetch.mockReset();
  mocks.push.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.stubGlobal('confirm', vi.fn(() => true));
});

describe('список осмотров: отказ чтения — не «осмотров нет» (F-R100-1)', () => {
  it('403 → про права, без «Осмотров не найдено.» и без повтора', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Доступ запрещён' }, 403));
    render(<InspectionsList />);

    expect(await screen.findByText('Нет прав на просмотр осмотров. Смените роль или обратитесь к администратору.'))
      .toBeInTheDocument();
    expect(screen.queryByText('Осмотров не найдено.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('5xx → «сервер вернул ошибку» с кнопкой «Повторить», и повтор читает снова', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'x' }, 500));
    render(<InspectionsList />);

    expect(await screen.findByText('Не удалось загрузить осмотры. Сервер вернул ошибку.')).toBeInTheDocument();
    expect(screen.queryByText('Осмотров не найдено.')).toBeNull();

    const before = retryCalls('/api/inspections');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(retryCalls('/api/inspections')).toBeGreaterThan(before));
  });

  it('обрыв сети → русский текст вместо «Failed to fetch»', async () => {
    mocks.authFetch.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    render(<InspectionsList />);

    expect(await screen.findByText('Нет соединения с сервером. Проверьте связь и повторите.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByText('Осмотров не найдено.')).toBeNull();
  });

  it('успешный пустой ответ → «Осмотров не найдено.» остаётся честным', async () => {
    mocks.authFetch.mockResolvedValue(json({ inspections: [] }));
    render(<InspectionsList />);

    expect(await screen.findByText('Осмотров не найдено.')).toBeInTheDocument();
  });
});

describe('карточка осмотра: отказ чтения различается по статусу (F-R100-2)', () => {
  it('404 → чужой или удалённый осмотр', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Inspection not found' }, 404));
    render(<RunInspection inspectionId="insp-1" />);

    expect(await screen.findByText('Осмотр не найден или принадлежит другому оператору.')).toBeInTheDocument();
    expect(screen.queryByText('Осмотр не найден.')).toBeNull();
  });

  it('5xx → временный сбой с кнопкой «Повторить», а не тупик', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'x' }, 500));
    render(<RunInspection inspectionId="insp-1" />);

    expect(await screen.findByText('Не удалось загрузить осмотр. Сервер вернул ошибку.')).toBeInTheDocument();
    const before = retryCalls('/api/inspections/insp-1');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(retryCalls('/api/inspections/insp-1')).toBeGreaterThan(before));
  });
});

describe('список шаблонов: отказ чтения — не «шаблонов нет» (F-R100-3)', () => {
  it('403 → про права, без «Шаблонов пока нет.»', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Доступ запрещён' }, 403));
    render(<TemplateList />);

    expect(await screen.findByText('Нет прав на чек-листы. Обратитесь к администратору.')).toBeInTheDocument();
    expect(screen.queryByText('Шаблонов пока нет.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('5xx → «Повторить» вместо пустого списка', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'x' }, 503));
    render(<TemplateList />);

    expect(await screen.findByText('Не удалось загрузить шаблоны. Сервер вернул ошибку.')).toBeInTheDocument();
    expect(screen.queryByText('Шаблонов пока нет.')).toBeNull();

    const before = retryCalls('/api/checklist-templates');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(retryCalls('/api/checklist-templates')).toBeGreaterThan(before));
  });
});

describe('редактор шаблона (F-R100-4, F-R100-5)', () => {
  it('сбой чтения не открывает пустую форму под заголовком «Редактировать шаблон»', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'x' }, 500));
    render(<TemplateEditor templateId="tpl-1" />);

    expect(await screen.findByText('Не удалось загрузить шаблон. Сервер вернул ошибку.')).toBeInTheDocument();
    expect(screen.queryByText('Редактировать шаблон')).toBeNull();
    expect(screen.queryByLabelText('Название *')).toBeNull();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('403 на чтении → про права, форма правки не показывается', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Доступ запрещён' }, 403));
    render(<TemplateEditor templateId="tpl-1" />);

    expect(await screen.findByText('Нет прав на шаблоны чек-листов. Обратитесь к администратору.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Название *')).toBeNull();
  });

  it('сохранение правки спрашивает подтверждение и без согласия не пишет', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => (
      url === '/api/checklist-templates/tpl-1' ? json(templatePayload) : json({})
    ));
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<TemplateEditor templateId="tpl-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    expect(confirm).toHaveBeenCalled();
    expect(mocks.authFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);
  });

  it('после подтверждения правка уходит на сервер', async () => {
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => (
      init?.method === 'PUT' ? json(templatePayload) : json(templatePayload)
    ));
    render(<TemplateEditor templateId="tpl-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(mocks.authFetch.mock.calls.some(([, init]) =>
      (init as RequestInit | undefined)?.method === 'PUT',
    )).toBe(true));
  });

  it('обрыв сети при сохранении — русский текст, а не «Failed to fetch» (F-R112-2)', async () => {
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new TypeError('Failed to fetch');
      return json(templatePayload);
    });
    render(<TemplateEditor templateId="tpl-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Нет соединения с сервером. Проверьте связь и повторите.'),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Failed to fetch');
  });
});

describe('редактор шаблона: сбой сохранения правки (F-R123-1)', () => {
  it('ошибка при сохранении правки объясняет, что действующая версия могла исчезнуть', async () => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'PUT' ? json({ error: 'Ошибка БД' }, 500) : json(templatePayload)
    ));
    render(<TemplateEditor templateId="tpl-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    // На сервере правка — деактивация прежней версии + создание новой без
    // транзакции: сбой оставляет чек-лист без действующей версии, и человек
    // должен узнать об этом не из одного слова «Ошибка».
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('прежняя версия шаблона могла быть снята');
    expect(alert).toHaveTextContent('Проверьте список шаблонов');
    // Форма и кнопка на месте: повтор возможен, введённое не потеряно.
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
  });

  it('создание нового шаблона сбоем не пугает архивом (строки нет)', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Ошибка БД' }, 500));
    render(<TemplateEditor templateId="new" />);

    fireEvent.change(screen.getByLabelText('Название *'), { target: { value: 'ЕО — экскаватор' } });
    fireEvent.change(screen.getByPlaceholderText('Напр. Двигатель'), { target: { value: 'Двигатель' } });
    fireEvent.change(screen.getByPlaceholderText('Проверить уровень масла…'), { target: { value: 'Проверить масло' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('редактор шаблона: защита от одновременной правки (F-R123-2)', () => {
  // Сервер выпускает версию деактивацией прежней строки и созданием новой без
  // проверки версии: двое админов с одним шаблоном дают две действующие версии.
  const templateWith = (isActive: boolean) =>
    json({ template: { ...templatePayload.template, isActive } });

  it('шаблон уже заменён другим администратором → PUT не уходит, есть объяснение', async () => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'PUT' ? json(templatePayload) : templateWith(false)
    ));
    render(<TemplateEditor templateId="tpl-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Шаблон уже изменён другим администратором');
    expect(mocks.authFetch.mock.calls.some(([, init]) =>
      (init as RequestInit | undefined)?.method === 'PUT',
    )).toBe(false);
  });

  it('шаблон ещё действует → правка уходит на сервер (проверка не мешает)', async () => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'PUT' ? json(templatePayload) : templateWith(true)
    ));
    render(<TemplateEditor templateId="tpl-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(mocks.authFetch.mock.calls.some(([, init]) =>
      (init as RequestInit | undefined)?.method === 'PUT',
    )).toBe(true));
  });
});

describe('редактор шаблона: пределы длины полей как в схеме маршрута (F-R121-3)', () => {
  it('у названия, раздела и полей пункта стоит maxLength по схеме', () => {
    render(<TemplateEditor templateId="new" />);

    expect(screen.getByLabelText('Название *')).toHaveAttribute('maxlength', '200');
    expect(screen.getByPlaceholderText('Banut 655 (пусто = общий блок для всех)')).toHaveAttribute('maxlength', '120');
    expect(screen.getByPlaceholderText('Напр. Двигатель')).toHaveAttribute('maxlength', '200');
    expect(screen.getByPlaceholderText('Проверить уровень масла…')).toHaveAttribute('maxlength', '500');
    expect(screen.getByPlaceholderText('мм, л, кПа…')).toHaveAttribute('maxlength', '40');
    expect(screen.getByPlaceholderText('≥ 0.5')).toHaveAttribute('maxlength', '300');
    expect(screen.getByPlaceholderText('ГОСТ…')).toHaveAttribute('maxlength', '120');
  });

  it('пункт длиннее 500 символов не уходит на сервер: сообщение называет пункт', async () => {
    render(<TemplateEditor templateId="new" />);

    fireEvent.change(screen.getByLabelText('Название *'), { target: { value: 'ЕО — экскаватор' } });
    fireEvent.change(screen.getByPlaceholderText('Напр. Двигатель'), { target: { value: 'Двигатель' } });
    fireEvent.change(screen.getByPlaceholderText('Проверить уровень масла…'), { target: { value: 'x'.repeat(501) } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Раздел 1, пункт 1: текст длиннее 500 символов'));
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });

  it('название длиннее 200 символов отклоняется до отправки', async () => {
    render(<TemplateEditor templateId="new" />);

    fireEvent.change(screen.getByLabelText('Название *'), { target: { value: 'x'.repeat(201) } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Название шаблона длиннее 200 символов'));
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });
});

describe('фото пункта осмотра: сбой чтения галереи (F-R100-8)', () => {
  it('500 → строка с причиной и «Повторить», счётчик не обнуляется', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'x' }, 500));
    const onCountChange = vi.fn();
    render(<InspectionItemPhotos inspectionId="insp-1" itemId="i1" onCountChange={onCountChange} />);

    expect(await screen.findByText('Не удалось загрузить фото. Сервер вернул ошибку.')).toBeInTheDocument();

    const before = retryCalls('/api/media?entityType=inspection&entityId=insp-1__i1');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(retryCalls('/api/media?entityType=inspection&entityId=insp-1__i1')).toBeGreaterThan(before));

    expect(onCountChange).not.toHaveBeenCalledWith(0);
  });

  it('403 → про права, без «Повторить» (повтором не лечится)', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Доступ запрещён' }, 403));
    const onCountChange = vi.fn();
    render(<InspectionItemPhotos inspectionId="insp-1" itemId="i1" onCountChange={onCountChange} />);

    expect(await screen.findByText('Нет прав на просмотр фото. Смените роль или обратитесь к администратору.'))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
    expect(onCountChange).not.toHaveBeenCalled();
  });

  it('успешный пустой ответ → счётчик честно равен нулю', async () => {
    mocks.authFetch.mockResolvedValue(json({ data: [] }));
    const onCountChange = vi.fn();
    render(<InspectionItemPhotos inspectionId="insp-1" itemId="i1" onCountChange={onCountChange} />);

    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(0));
  });

  it('обрыв сети при загрузке фото — русский текст, а не «Failed to fetch» (F-R112-2)', async () => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new TypeError('Failed to fetch');
      return json({ data: [] });
    });
    const { container } = render(<InspectionItemPhotos inspectionId="insp-1" itemId="i1" />);
    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalled());

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Нет соединения с сервером. Проверьте связь и повторите.'),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Failed to fetch');
  });

  // F-R115-9: клик по фото при отказе скачивания молча ничего не делал.
  it('403 при открытии фото объясняется тостом, а не тишиной (F-R115-9)', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/media?entityType=inspection&entityId=insp-1__i1') {
        return json({ data: [{ id: 'm1', fileName: 'a.png', contentType: 'image/png', thumbnailKey: 'k' }] });
      }
      if (url.startsWith('/api/media/download-batch')) return json({ urls: { m1: 'https://cdn.example/x.jpg' } });
      return json({ error: 'Доступ запрещён' }, 403);
    });
    render(<InspectionItemPhotos inspectionId="insp-1" itemId="i1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть фото' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет прав на просмотр фото. Смените роль или обратитесь к администратору.',
    ));
  });
});

describe('сохранение и завершение осмотра (F-R100-6, F-R100-7)', () => {
  const snapshot = [item('i1', 'Двигатель')];

  /** GET карточки отдаёт осмотр; мутация отвечает заданным исходом. */
  function mockDetailWithMutation(mutation: () => Response) {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'PUT' ? mutation() : json({ inspection: detail(snapshot) })
    ));
  }

  async function renderInspection() {
    render(<RunInspection inspectionId="insp-1" />);
    return screen.findByRole('button', { name: /Сохранить черновик/ });
  }

  it('401 на сохранении черновика → «Сессия истекла», а не серверное «Unauthorized»', async () => {
    mockDetailWithMutation(() => json({ error: 'Unauthorized' }, 401));
    await renderInspection();

    fireEvent.click(screen.getByRole('button', { name: /Сохранить черновик/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Сессия истекла — войдите снова.'));
  });

  it('403 CSRF → русский текст вместо «CSRF validation failed»', async () => {
    mockDetailWithMutation(() => json({ error: 'CSRF validation failed: origin mismatch' }, 403));
    await renderInspection();

    fireEvent.click(screen.getByRole('button', { name: /Сохранить черновик/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Запрос отклонён проверкой безопасности. Обновите страницу и повторите.',
    ));
  });

  it('не-JSON тело отказа → общий русский текст, без «Unexpected end of JSON input»', async () => {
    mockDetailWithMutation(() => new Response('<html>502</html>', {
      status: 500,
      headers: { 'content-type': 'text/html' },
    }));
    await renderInspection();

    fireEvent.click(screen.getByRole('button', { name: /Сохранить черновик/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Не удалось сохранить черновик'));
  });

  it('отказ завершения оставляет панель подписи открытой с введённым именем', async () => {
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/inspections/insp-1/complete') return json({ error: 'Unauthorized' }, 401);
      if (init?.method === 'PUT') return json({ inspection: detail(snapshot) });
      return json({ inspection: detail(snapshot) });
    });
    render(<RunInspection inspectionId="insp-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Завершить осмотр' }));
    fireEvent.change(screen.getByLabelText('Подписал'), { target: { value: 'Иванов И.И.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Сессия истекла — войдите снова.'));
    // Панель не закрылась: раньше `finally { setShowSign(false) }` стирал подпись.
    expect(screen.getByRole('button', { name: 'Подтвердить' })).toBeInTheDocument();
    expect((screen.getByLabelText('Подписал') as HTMLInputElement).value).toBe('Иванов И.И.');
  });
});

describe('список шаблонов: деактивация с объяснением последствий (F-R123-7)', () => {
  const row = {
    id: 'tpl-1', name: 'ЕО — экскаватор', level: 'EO',
    blockType: 'BASE', appliesToModel: 'Banut 655', isActive: true,
  };
  const listWith = (templates: unknown[]) =>
    json({ templates });

  it('голый confirm заменён диалогом: последствия видны до нажатия, DELETE не уходит', async () => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'DELETE' ? json({ ok: true }) : listWith([row])
    ));
    render(<TemplateList />);

    fireEvent.click(await screen.findByRole('button', { name: 'Деактивировать' }));

    // Снятие последнего блока «База» для модели ломает заводку новых осмотров
    // этих машин — админ узнаёт об этом до подтверждения (R123 №7).
    expect(screen.getByText('Деактивировать шаблон?')).toBeInTheDocument();
    expect(screen.getByText(/последний действующий блок «База» для модели «Banut 655»/)).toBeInTheDocument();
    expect(mocks.authFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать шаблон' }));

    await waitFor(() => expect(mocks.authFetch.mock.calls.some(([u, init]) =>
      (init as RequestInit | undefined)?.method === 'DELETE' && u === '/api/checklist-templates/tpl-1',
    )).toBe(true));
  });

  it('есть другая «База» для той же модели → о поломке не предупреждаем', async () => {
    mocks.authFetch.mockResolvedValue(listWith([row, { ...row, id: 'tpl-2', name: 'ТО1 — экскаватор' }]));
    render(<TemplateList />);

    fireEvent.click(await screen.findAllByRole('button', { name: 'Деактивировать' })
      .then((buttons) => buttons[0]));

    expect(screen.getByText('Деактивировать шаблон?')).toBeInTheDocument();
    expect(screen.queryByText(/последний действующий блок/)).toBeNull();
  });
});

describe('список шаблонов: отказ деактивации различается по статусу (F-R123-9)', () => {
  const row = { id: 'tpl-1', name: 'ЕО — экскаватор', level: 'EO', blockType: 'HAMMER', appliesToModel: null, isActive: true };

  const deactivate = async (status: number) => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => (
      init?.method === 'DELETE' ? json({ error: 'Template not found' }, status) : json({ templates: [row] })
    ));
    render(<TemplateList />);
    fireEvent.click(await screen.findByRole('button', { name: 'Деактивировать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать шаблон' }));
  };

  it('404 → «уже деактивирован», а не общее «Не удалось»', async () => {
    await deactivate(404);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Шаблон уже деактивирован или не найден — обновите список.'));
    expect(toast.error).not.toHaveBeenCalledWith('Не удалось деактивировать шаблон');
  });

  it('403 → про права, а не «Не удалось»', async () => {
    await deactivate(403);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Нет прав на деактивацию шаблона. Обратитесь к администратору.'));
    expect(toast.error).not.toHaveBeenCalledWith('Не удалось деактивировать шаблон');
  });
});

describe('редактор шаблона: снятая версия помечена (F-R123-4)', () => {
  it('открытая по прямой ссылке снятая версия названа архивом, а не выдаётся за действующую', async () => {
    mocks.authFetch.mockResolvedValue(json({ template: { ...templatePayload.template, isActive: false } }));
    render(<TemplateEditor templateId="tpl-1" />);

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('снятая версия шаблона (архив)');
    expect(notice).toHaveTextContent('откройте действующую версию');
  });

  it('действующая версия пометки «архив» не получает', async () => {
    mocks.authFetch.mockResolvedValue(json({ template: { ...templatePayload.template, isActive: true } }));
    render(<TemplateEditor templateId="tpl-1" />);

    await screen.findByLabelText('Название *');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

/**
 * F-R131-NEXT3 №26: кнопка-иконка «корзина» (деактивировать шаблон) в списке
 * шаблонов имела aria-label, но не имела title.
 */
describe('TemplateList — title на кнопке деактивации (F-R131-NEXT3 №26)', () => {
  const row = {
    id: 'tpl-1', name: 'ЕО — экскаватор', level: 'EO',
    blockType: 'BASE', appliesToModel: 'Banut 655', isActive: true,
  };
  const listWith = (templates: unknown[]) => json({ templates });

  it('кнопка деактивации имеет title', async () => {
    mocks.authFetch.mockResolvedValue(listWith([row]));
    render(<TemplateList />);

    const btn = await screen.findByRole('button', { name: 'Деактивировать' });
    expect(btn).toHaveAttribute('title', 'Деактивировать шаблон');
  });
});

describe('inspection-api-error: выбор текста по причине', () => {
  const texts = { forbidden: 'нет прав', notFound: 'не найден', server: 'сбой сервера' };

  it('403/404 → свои тексты, 5xx → общий, обрыв → сеть', () => {
    expect(loadErrorText(new InspectionLoadError(403), texts)).toBe('нет прав');
    expect(loadErrorText(new InspectionLoadError(404), texts)).toBe('не найден');
    expect(loadErrorText(new InspectionLoadError(500), texts)).toBe('сбой сервера');
    expect(loadErrorText(new TypeError('Failed to fetch'), texts)).toBe('Нет соединения с сервером. Проверьте связь и повторите.');
  });

  it('повтор предлагается только для обрыва и 5xx', () => {
    expect(isRetryableLoadError(new InspectionLoadError(500))).toBe(true);
    expect(isRetryableLoadError(new InspectionLoadError(null))).toBe(true);
    expect(isRetryableLoadError(new InspectionLoadError(403))).toBe(false);
    expect(isRetryableLoadError(new InspectionLoadError(404))).toBe(false);
  });

  it('extractApiError: 401, CSRF-403 и нечитаемое тело', async () => {
    expect(await extractApiError(json({ error: 'Unauthorized' }, 401), 'Ошибка')).toBe('Сессия истекла — войдите снова.');
    expect(await extractApiError(json({ error: 'CSRF validation failed: origin mismatch' }, 403), 'Ошибка'))
      .toBe('Запрос отклонён проверкой безопасности. Обновите страницу и повторите.');
    expect(await extractApiError(new Response('<html/>', { status: 500 }), 'Ошибка сохранения')).toBe('Ошибка сохранения');
    expect(await extractApiError(json({ error: 'Осмотр уже завершён' }, 409), 'Ошибка')).toBe('Осмотр уже завершён');
  });
});

/**
 * F-R131 №9 и №17. В списке осмотров вид «ЕО» печатался двухбуквенным кодом без
 * расшифровки, а оценка — «голым» числом «87» без единицы, хотя в контуре
 * готовности та же величина читается «87/100». До правки оба текста на экране
 * отсутствовали — тесты падали.
 */
describe('список осмотров: расшифровка ЕО и оценка с единицей (F-R131 №9, №17)', () => {
  const row = {
    id: 'insp-1',
    level: 'EO',
    inspectionDate: '2026-09-30',
    healthScore: 87,
    status: 'COMPLETED',
    equipment: { id: 'eq-1', name: 'СП-49', model: 'PVE 50PR' },
  };

  it('вид «ЕО» расшифрован, оценка показана как «87/100»', async () => {
    mocks.authFetch.mockResolvedValue(json({ inspections: [row] }));
    render(<InspectionsList />);

    expect(await screen.findByText('СП-49')).toBeInTheDocument();
    expect(screen.getAllByText('ЕО — ежедневный осмотр').length).toBeGreaterThan(0);
    expect(screen.getByText('87/100')).toBeInTheDocument();
    expect(screen.queryByText('87')).toBeNull();
  });
});
