import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {useLocalFormDraft} from './use-local-form-draft';

function Form({user = 'operator-1', scope = 'shift-1:piles'}: {user?: string; scope?: string}) {
  const draft = useLocalFormDraft(user, scope, {grade: '', count: ''});
  const [grade, setGrade] = draft.field('grade');
  const [count, setCount] = draft.field('count');
  return <><input aria-label="Марка" value={grade} onChange={(event) => setGrade(event.target.value)} />
    <input aria-label="Количество" value={count} onChange={(event) => setCount(event.target.value)} />
    <button onClick={() => draft.clear({grade, count: ''})}>Принято</button></>;
}
const draftKeys = () => Object.keys(window.localStorage).filter((key) => key.startsWith('pilingtrack:form-draft:'));

beforeEach(() => {vi.restoreAllMocks(); window.localStorage.clear();});

describe('локальный черновик формы', () => {
  it.each([null, []])('отбрасывает повреждённый словарь ответов: %j', (answers) => {
    const key = 'pilingtrack:form-draft:v1:operator:checklist';
    window.localStorage.setItem(key, JSON.stringify({version: 1, updatedAt: Date.now(), value: {answers}}));
    function Checklist() {
      const draft = useLocalFormDraft('operator', 'checklist', {answers: {} as Record<string, string>});
      return <p>Ответов: {Object.keys(draft.value.answers).length}</p>;
    }
    render(<Checklist />);
    expect(screen.getByText('Ответов: 0')).toBeInTheDocument();
    expect(window.localStorage.getItem(key)).toBeNull();
  });
  it('не сохраняет открытый пустой лист', () => {
    render(<Form />);
    expect(draftKeys()).toEqual([]);
  });
  it('восстанавливает ввод после размонтирования и нового монтирования', () => {
    const view = render(<Form />);
    fireEvent.change(screen.getByLabelText('Марка'), {target: {value: 'grade-1'}});
    fireEvent.change(screen.getByLabelText('Количество'), {target: {value: '12'}});
    view.unmount();
    render(<Form />);
    expect(screen.getByLabelText('Марка')).toHaveValue('grade-1');
    expect(screen.getByLabelText('Количество')).toHaveValue('12');
  });
  it('стирает после принятия и не сохраняет оставленную марку как новый черновик', () => {
    const view = render(<Form />);
    fireEvent.change(screen.getByLabelText('Марка'), {target: {value: 'grade-1'}});
    fireEvent.change(screen.getByLabelText('Количество'), {target: {value: '12'}});
    fireEvent.click(screen.getByRole('button', {name: 'Принято'}));
    expect(screen.getByLabelText('Марка')).toHaveValue('grade-1');
    expect(draftKeys()).toEqual([]);
    view.unmount();
    render(<Form />);
    expect(screen.getByLabelText('Количество')).toHaveValue('');
    expect(screen.getByLabelText('Марка')).toHaveValue('');
  });
  it('изолирует пользователей и смены, включая смену ключа без размонтирования', () => {
    const view = render(<Form />);
    fireEvent.change(screen.getByLabelText('Количество'), {target: {value: '12'}});
    view.rerender(<Form user="operator-2" />);
    expect(screen.getByLabelText('Количество')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Количество'), {target: {value: '3'}});
    view.rerender(<Form />);
    expect(screen.getByLabelText('Количество')).toHaveValue('12');
    view.rerender(<Form scope="shift-2:piles" />);
    expect(screen.getByLabelText('Количество')).toHaveValue('');
  });
  it('удаляет ввод старше 24 часов', () => {
    const view = render(<Form />);
    fireEvent.change(screen.getByLabelText('Количество'), {target: {value: '12'}});
    view.unmount();
    const [key] = draftKeys();
    const saved = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    window.localStorage.setItem(key, JSON.stringify({...saved, updatedAt: Date.now() - 24 * 60 * 60 * 1000 - 1}));
    render(<Form />);
    expect(screen.getByLabelText('Количество')).toHaveValue('');
    expect(draftKeys()).toEqual([]);
  });
  it('работает при недоступных чтении и записи localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {throw new Error('Storage denied');});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {throw new Error('Storage denied');});
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {throw new Error('Storage denied');});
    render(<Form />);
    fireEvent.change(screen.getByLabelText('Количество'), {target: {value: '12'}});
    expect(screen.getByLabelText('Количество')).toHaveValue('12');
    fireEvent.click(screen.getByRole('button', {name: 'Принято'}));
    expect(screen.getByLabelText('Количество')).toHaveValue('');
  });
});
