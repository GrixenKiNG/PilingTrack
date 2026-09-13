import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {ChecklistView} from '@/modules/operator-mobile/contracts';
import {ChecklistScreen} from './checklist-screen';

const checklist: ChecklistView = {
  stage: 'PRESHIFT_INSPECTION',
  title: 'Предсменный осмотр',
  purpose: 'Проверка перед работой',
  version: 'test-1',
  done: false,
  sections: [{
    id: 'cab',
    title: 'Кабина',
    items: [{id: 'glass', text: 'Стёкла и зеркала', severity: 'NOTE'}],
  }],
};

describe('чек-лист машиниста', () => {
  it('позволяет проверить пробелы и называет первый незаполненный пункт', () => {
    const props = {
      warnings: [],
      onSubmit: vi.fn(),
      busy: false,
      error: null,
      commandId: 'test-command',
    };
    const view = render(
      <ChecklistScreen
        key={checklist.stage}
        checklist={checklist}
        {...props}
      />,
    );

    const check = screen.getByRole('button', {name: /Осталось заполнить: 1/});
    expect(check).toBeEnabled();
    fireEvent.click(check);
    expect(screen.getByRole('alert')).toHaveTextContent('Стёкла и зеркала');

    view.rerender(
      <ChecklistScreen
        key="EO_BEFORE"
        checklist={{
          ...checklist,
          stage: 'EO_BEFORE',
          title: 'ЕО перед работой',
          sections: [{
            id: 'engine',
            title: 'Двигатель',
            items: [{id: 'oil', text: 'Уровень масла', severity: 'NOTE'}],
          }],
        }}
        {...props}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Отмечено 0 из 1')).toBeInTheDocument();
  });
});
