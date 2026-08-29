import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach, describe, expect, it} from 'vitest';
import {findForeignVisibleText} from '../../../../../scripts/operator-v3-preflight';

const created: string[] = [];

function fixture(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'operator-v3-language-'));
  created.push(directory);
  const file = join(directory, 'screen.tsx');
  writeFileSync(file, source, 'utf8');
  return file;
}

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, {recursive: true, force: true});
});

describe('предварительная проверка русского интерфейса operator/v3', () => {
  it('находит иностранный текст, который увидит оператор', () => {
    const file = fixture('export const Screen = () => <button aria-label="Start shift">Start shift</button>;');

    expect(findForeignVisibleText(file)).toEqual(expect.arrayContaining([
      expect.objectContaining({message: expect.stringContaining('Start shift')}),
    ]));
  });

  it('не считает внутренние коды и варианты оформления пользовательским текстом', () => {
    const file = fixture(`
      export const Screen = ({state}: {state: string}) => (
        <div data-testid="operator-screen">
          <span className={state === 'STOP_REQUIRED' ? 'danger' : 'neutral'}>
            {state === 'STOP_REQUIRED' ? 'Требуется безопасная остановка' : 'Работа разрешена'}
          </span>
        </div>
      );
    `);

    expect(findForeignVisibleText(file)).toEqual([]);
  });

  it('разрешает название продукта в видимом тексте', () => {
    const file = fixture('export const Screen = () => <p>PilingTrack</p>;');

    expect(findForeignVisibleText(file)).toEqual([]);
  });
});
