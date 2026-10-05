import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import type {WorkWarning} from '@/modules/operator-mobile/contracts';
import {Screen} from '../ui';
import {WarningsPanel} from '../warnings-panel';

/**
 * Читаемость общих частей экрана машиниста для поля (просьба владельца, 05.10.2026):
 * подпись под заголовком и предупреждения — не мельче 14 px, строка
 * «К сведению» — не ниже 44 px. Классы здесь — источник правила: тест падает
 * при откате правки (см. revert-checks-8.log, «СШ»).
 */
describe('читаемость общих частей экрана машиниста (поле)', () => {
  it('подпись шапки — не мельче 14 px', () => {
    render(
      <Screen title="Смена" subtitle="Woltman-PVE 50PR">
        <p>тело экрана</p>
      </Screen>,
    );
    const subtitle = screen.getByText('Woltman-PVE 50PR');
    expect(subtitle.className).toContain('text-sm');
    expect(subtitle.className).not.toContain('text-2xs');
  });

  it('предупреждения для поля — значок и строка «К сведению»', () => {
    const warnings = [
      {code: 'a1', level: 'ALERT', title: 'Просрочено ТО', detail: 'детали', resolution: 'решение'},
      {code: 'n1', level: 'NOTE', title: 'Обогреватель не работает', detail: 'д', resolution: 'р'},
    ] as unknown as WorkWarning[];
    render(<WarningsPanel warnings={warnings} />);
    const caption = screen.getByText('Нарушение · видит диспетчер');
    expect(caption.className).toContain('text-sm');
    expect(caption.className).not.toContain('text-3xs');
    const toggle = screen.getByRole('button', {name: /К сведению: 1/});
    expect(toggle.className).toContain('min-h-11');
  });
});