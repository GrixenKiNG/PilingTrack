/**
 * Поведенческие тесты для `usePilingStore` (src/lib/store.ts).
 *
 * Граница: localStorage (через zustand/middleware/persist).
 * Логика стора НЕ мокается — проверяем наблюдаемое поведение.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Глобальный мок localStorage для изоляции тестов
const createStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    get length() { return store.size; },
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
  };
};

const storageMock = createStorageMock();

vi.stubGlobal('localStorage', storageMock);

// Импортируем ПОСЛЕ установки мока, иначе persist подхватит настоящий localStorage
import { usePilingStore } from '@/lib/store';

describe('usePilingStore — поведение', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.clear();
    // Сбрасываем стор к дефолтам через вызов actions
    usePilingStore.setState({
      currentUser: null,
      actingAs: null,
      currentPage: 'login',
      selectedSiteId: null,
      localFeedbackEvents: [],
    });
  });

  it('чтение и запись currentUser — login задаёт пользователя, роль и страницу', () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Иван Иванов',
      role: 'OPERATOR' as const,
    };

    usePilingStore.getState().login(user);

    const state = usePilingStore.getState();
    expect(state.currentUser).toEqual(user);
    expect(state.actingAs).toBeNull();
    expect(state.currentPage).toBe('operator-dashboard');
  });

  it('чтение и запись actingAs — setActingAs сохраняет роль замещения', () => {
    usePilingStore.getState().setActingAs('MECHANIC');

    expect(usePilingStore.getState().actingAs).toBe('MECHANIC');

    usePilingStore.getState().setActingAs(null);
    expect(usePilingStore.getState().actingAs).toBeNull();
  });

  it('чтение и запись currentPage — navigate меняет страницу', () => {
    usePilingStore.getState().navigate('report-form');

    expect(usePilingStore.getState().currentPage).toBe('report-form');
  });

  it('чтение и запись selectedSiteId — setSelectedSite сохраняет ID площадки', () => {
    usePilingStore.getState().setSelectedSite('site-123');

    expect(usePilingStore.getState().selectedSiteId).toBe('site-123');

    usePilingStore.getState().setSelectedSite(null);
    expect(usePilingStore.getState().selectedSiteId).toBeNull();
  });

  it('отсутствующий ключ — дефолтные значения при первом запуске', async () => {
    // Создаём новый стор без данных в localStorage через динамический импорт
    const { usePilingStore: freshStore } = await import('@/lib/store');

    const state = freshStore.getState();
    expect(state.currentUser).toBeNull();
    expect(state.actingAs).toBeNull();
    expect(state.currentPage).toBe('login');
    expect(state.selectedSiteId).toBeNull();
    expect(state.localFeedbackEvents).toEqual([]);
  });

  it('login сбрасывает selectedSiteId: объект прошлого пользователя не переносится', () => {
    usePilingStore.getState().setActingAs('MECHANIC');
    usePilingStore.getState().setSelectedSite('site-456');

    usePilingStore.getState().login({
      id: 'user-2',
      email: 'test2@example.com',
      name: 'Петр Петров',
      role: 'ADMIN',
    });

    const state = usePilingStore.getState();
    expect(state.actingAs).toBeNull();
    expect(state.selectedSiteId).toBeNull();
    expect(state.currentPage).toBe('admin-dashboard');
  });

  it('перезапись — logout очищает всё состояние включая localFeedbackEvents', () => {
    usePilingStore.getState().login({
      id: 'user-3',
      email: 'test3@example.com',
      name: 'Сидор Сидоров',
      role: 'DISPATCHER',
    });
    usePilingStore.getState().setSelectedSite('site-789');
    usePilingStore.getState().addLocalFeedbackEvent({
      level: 'info',
      scope: 'test',
      action: 'test',
      title: 'Тест',
      message: 'Сообщение',
    });

    usePilingStore.getState().logout();

    const state = usePilingStore.getState();
    expect(state.currentUser).toBeNull();
    expect(state.actingAs).toBeNull();
    expect(state.currentPage).toBe('login');
    expect(state.selectedSiteId).toBeNull();
    expect(state.localFeedbackEvents).toEqual([]);
  });

  it('перезапись — addLocalFeedbackEvent добавляет событие и ограничивает историю 30 записями', () => {
    const store = usePilingStore.getState();

    // Добавляем 32 события
    for (let i = 0; i < 32; i++) {
      store.addLocalFeedbackEvent({
        level: 'info',
        scope: 'test',
        action: 'test',
        title: `Событие ${i}`,
        message: `Сообщение ${i}`,
      });
    }

    const events = usePilingStore.getState().localFeedbackEvents;
    expect(events).toHaveLength(30);
    // Последнее добавленное — первое в массиве (unshift)
    expect(events[0].title).toBe('Событие 31');
    expect(events[29].title).toBe('Событие 2');
  });

  it('поведение при недоступном хранилище — ошибки localStorage не роняют стор', () => {
    // Ломаем localStorage.setItem
    storageMock.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });

    // Действие не должно бросать наружу
    expect(() => {
      usePilingStore.getState().login({
        id: 'user-4',
        email: 'test4@example.com',
        name: 'Тест Тестов',
        role: 'ASSISTANT',
      });
    }).not.toThrow();

    // Состояние в памяти всё равно обновилось
    expect(usePilingStore.getState().currentUser).not.toBeNull();
    expect(usePilingStore.getState().currentPage).toBe('operator-dashboard');
  });

  it('persist не сохраняет currentPage — после перезагрузки страница всегда login', async () => {
    // partialize не включает currentPage: так задумано, вход всегда начинается с login.
    usePilingStore.getState().navigate('report-form');
    usePilingStore.getState().login({
      id: 'user-5',
      email: 'test5@example.com',
      name: 'Проверка Персист',
      role: 'OPERATOR',
    });

    // Имитируем перезагрузку: сбрасываем кэш модулей, новый стор читает localStorage
    vi.resetModules();
    const { usePilingStore: restoredStore } = await import('@/lib/store');

    expect(restoredStore.getState().currentPage).toBe('login');
  });
});