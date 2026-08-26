/**
 * Regression: админская оболочка держит две шапки — десктопную
 * (`hidden lg:flex`) и мобильную (`lg:hidden`). Прячется всегда одна, но в
 * дереве React живут обе, поэтому `<FeedbackCenter />` монтируется дважды.
 * Пока опрос сидел внутри компонента, каждый экземпляр заводил свой
 * `setInterval` и свой `inFlightRef` (`useRef` не дедуплицирует через границу
 * экземпляров), и `/api/feedback/events` получал ровно вдвое больше запросов.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  authFetch: mocks.authFetch,
}));

let setIntervalSpy: ReturnType<typeof vi.spyOn>;
let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

/**
 * Сколько интервалов осталось «в живых». Считать вызовы `setInterval` нельзя:
 * каждый монтируемый экземпляр пересоздаёт общий таймер (снял старый —
 * поставил новый), поэтому важна именно разница.
 */
function liveIntervals(): number {
  return setIntervalSpy.mock.calls.length - clearIntervalSpy.mock.calls.length;
}

function Probe({ open = false }: { open?: boolean }) {
  useFeedbackFeedRef.current?.({ enabled: true, isPrivileged: false, open });
  return null;
}

function DisabledProbe() {
  useFeedbackFeedRef.current?.({ enabled: false, isPrivileged: false, open: false });
  return null;
}

// Хук импортируется динамически (модульное состояние сбрасывается между
// тестами через resetModules), поэтому компоненты берут его через ссылку.
const useFeedbackFeedRef: {
  current: null | ((args: { enabled: boolean; isPrivileged: boolean; open: boolean }) => unknown);
} = { current: null };

describe('useFeedbackFeed', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [], summary: null }),
    });
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { useFeedbackFeed } = await import('../use-feedback-feed');
    useFeedbackFeedRef.current = useFeedbackFeed as typeof useFeedbackFeedRef.current;
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('два экземпляра дают один запрос и один живой таймер, а не два', async () => {
    render(
      <>
        <Probe />
        <Probe />
      </>
    );

    // Ответ authFetch — микрозадача, а не таймер: act() её и сливает.
    await act(async () => {});

    expect(mocks.authFetch).toHaveBeenCalledTimes(1);
    expect(mocks.authFetch).toHaveBeenCalledWith('/api/feedback/events?limit=25');
    expect(liveIntervals()).toBe(1);
  });

  it('снимает таймер, когда размонтирован последний экземпляр', async () => {
    const view = render(
      <>
        <Probe />
        <Probe />
      </>
    );

    await act(async () => {});
    expect(liveIntervals()).toBe(1);

    view.unmount();

    expect(liveIntervals()).toBe(0);
  });

  it('не опрашивает без авторизованного пользователя', async () => {
    render(<DisabledProbe />);

    await act(async () => {});

    expect(mocks.authFetch).not.toHaveBeenCalled();
    expect(liveIntervals()).toBe(0);
  });
});
