import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {uploadPhoto} from '@/components/piling/operator-mobile/api';
import {ChecklistRunScreen} from '../checklist-run';
import {makeChecklist} from './fixtures';

/**
 * Клиент `api.ts` подменяем целиком: нужен управляемый `uploadPhoto`, чтобы
 * руками задать порядок ответов на два снимка. Всё остальное в этом тесте не
 * участвует.
 */
vi.mock('@/components/piling/operator-mobile/api', () => {
  class ApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  class QueuedOffline extends Error {
    constructor(readonly label: string) {
      super(label);
      this.name = 'QueuedOffline';
    }
  }
  return {
    ApiError,
    QueuedOffline,
    uploadPhoto: vi.fn(),
    fetchState: vi.fn(),
    sendCommand: vi.fn(),
    sendQueuedCommand: vi.fn(),
    newCommandId: () => 'cmd-test',
    currentPosition: async () => null,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return {promise, resolve};
}

/**
 * Находка Д5 независимого аудита: два снимка подряд перезаписывали друг друга,
 * потому что список брался из черновика на момент рендера. Без исправления
 * после двух загрузок в пункте остаётся один снимок.
 */
describe('находка Д5: снимки не теряются при загрузке подряд', () => {
  it('два снимка приходят в обратном порядке — оба на месте', async () => {
    const upload = vi.mocked(uploadPhoto);
    const first = deferred<string>();
    const second = deferred<string>();
    upload.mockReset();
    upload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const {container} = render(
      <ChecklistRunScreen
        checklist={makeChecklist()} warnings={[]} busy={false} error={null}
        commandId="cmd-1" onSubmit={() => {}}
      />,
    );

    const leak = screen.getByTestId('inspection-item-i-leak');
    fireEvent.click(within(leak).getByRole('button', {name: 'Неисправность'}));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    /**
     * Файл подставляем напрямую в свойство: у `input[type=file]` оно только для
     * чтения, и `fireEvent.change` с `target.files` до него не доходит.
     */
    const pick = (file: File) => {
      Object.defineProperty(input as HTMLInputElement, 'files', {value: [file], configurable: true});
      fireEvent.change(input as HTMLInputElement);
    };

    pick(new File(['a'], 'a.jpg', {type: 'image/jpeg'}));
    pick(new File(['b'], 'b.jpg', {type: 'image/jpeg'}));
    expect(vi.mocked(uploadPhoto)).toHaveBeenCalledTimes(2);

    // Второй ответ приходит первым — так и терялся первый снимок.
    second.resolve('media-2');
    await waitFor(() => expect(within(leak).getByText(/Снимков приложено: 1/)).toBeInTheDocument());
    first.resolve('media-1');
    await waitFor(() => expect(within(leak).getByText(/Снимков приложено: 2/)).toBeInTheDocument());
  });
});
