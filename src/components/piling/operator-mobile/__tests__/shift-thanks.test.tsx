import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {ShiftThanks, thanksAddress} from '../shift-thanks';

describe('thanksAddress: обращение по имени и отчеству', () => {
  it.each([
    ['Митрофанов Алексей Геннадьевич', 'Алексей Геннадьевич'],
    ['Андреев Пётр Юрьевич', 'Пётр Юрьевич'],
    ['  Иванова   Мария   Петровна ', 'Мария Петровна'],
    ['Гусейнов Эльдар Рза оглы', null],
  ])('«%s» → %s', (full, expected) => {
    expect(thanksAddress(full)).toBe(expected);
  });

  it.each(['Герасимова ЕА', 'Иванов И.П.', 'Машинист', 'QA_AUDIT_1014 Машинист', '', null, undefined])(
    'без уверенности в имени и отчестве не обращается по имени: %s',
    (full) => {
      expect(thanksAddress(full)).toBeNull();
    },
  );
});

describe('ShiftThanks', () => {
  it('благодарит с обращением по имени и сообщает, что отчёт ушёл', () => {
    render(<ShiftThanks operatorName="Митрофанов Алексей Геннадьевич" />);
    expect(screen.getByRole('status')).toHaveTextContent('Спасибо за работу!');
    expect(screen.getByRole('status')).toHaveTextContent('Алексей Геннадьевич, смена закрыта, отчёт ушёл диспетчеру. Хорошего отдыха.');
  });

  it('без имени благодарит без обращения', () => {
    render(<ShiftThanks operatorName="Машинист" />);
    expect(screen.getByRole('status')).toHaveTextContent('Смена закрыта, отчёт ушёл диспетчеру. Хорошего отдыха.');
    expect(screen.getByRole('status')).not.toHaveTextContent(', смена закрыта');
  });

  it('не обещает, что отчёт ушёл, пока сервер его не подтвердил', () => {
    render(<ShiftThanks operatorName="Митрофанов Алексей Геннадьевич" reportSent={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Спасибо за работу!');
    expect(screen.getByRole('status')).toHaveTextContent('Алексей Геннадьевич, смена закрыта. Хорошего отдыха.');
    expect(screen.getByRole('status')).not.toHaveTextContent('ушёл диспетчеру');
  });
});
