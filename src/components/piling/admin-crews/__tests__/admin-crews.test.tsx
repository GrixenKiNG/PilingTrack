/**
 * R102 (важно №1, №2, №7, №8, №9): экран бригад.
 *
 * - «Удалить» и «Деактивировать» делали одно и то же (isActive=false), но
 *   выглядели по-разному; после «Удалить» строка исчезала из списка, хотя
 *   бригаду можно было активировать обратно. Теперь одно действие
 *   с подтверждением, строка остаётся неактивной;
 * - тост обещал удаление, которого не было (`Бригада удалена`);
 * - форма разрешала пустое название (сервер подставлял «Unnamed Crew»);
 * - пустой список справочника выглядел как «данных нет».
 *
 * Дочерние диалоги/селекты и данные подменены заглушками: тест про поведение
 * экрана, а не про вёрстку Radix.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import type { CrewDTO, EquipmentDTO, SiteDTO, UserDTO } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  hook: { current: {} as Record<string, unknown> },
  setCrews: vi.fn(),
  deleteCrew: vi.fn(),
  toggleActive: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/use-ability', () => ({ useAbility: () => true }));
vi.mock('../use-crews-data', () => ({ useCrewsData: () => mocks.hook.current }));
vi.mock('@/components/piling/ops-shell/permitted-entity-history', () => ({ PermittedEntityHistory: () => null }));
vi.mock('../delete-dialog', () => ({
  DeleteDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button onClick={onConfirm}>Подтвердить деактивацию</button> : null,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open = true }: { children: ReactNode; open?: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

import { AdminCrews } from '../admin-crews';
import { CrewFormDialog } from '../crew-form-dialog';

const crew = {
  id: 'c1',
  name: 'Бригада 1',
  isActive: true,
  operator: { name: 'Машинист 1' },
  equipment: { name: 'СП-49' },
  site: { id: 's1', name: 'Объект 1' },
  assistants: [{ userId: 'u1', name: 'Помощник 1' }],
} as unknown as CrewDTO;

function baseHook() {
  return {
    crews: [crew], setCrews: mocks.setCrews,
    equipmentList: [], sites: [], loading: false, loadError: null,
    reloadCrews: vi.fn(), referenceError: null, loadingReferenceData: false,
    loadReferenceData: vi.fn().mockResolvedValue(undefined),
    availableOperators: [], assistantUsers: [], activeEquipment: [], activeSites: [],
    toggleActive: mocks.toggleActive, createCrew: vi.fn(), updateCrew: vi.fn(),
    deleteCrew: mocks.deleteCrew,
  };
}

describe('AdminCrews — одно действие деактивации (F-R102-1,2,8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteCrew.mockResolvedValue(undefined);
    mocks.hook.current = baseHook();
  });

  it('нет кнопки «Удалить»; «Деактивировать» подтверждается и оставляет строку неактивной', async () => {
    render(<AdminCrews />);

    expect(screen.getByRole('button', { name: 'Деактивировать' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить деактивацию' }));

    await waitFor(() => expect(mocks.deleteCrew).toHaveBeenCalledWith('c1'));
    expect(toast.success).toHaveBeenCalledWith('Бригада деактивирована — её можно активировать снова');

    // Строка остаётся в списке (было — исчезала), просто становится неактивной.
    const updater = mocks.setCrews.mock.calls[0][0] as (prev: CrewDTO[]) => CrewDTO[];
    const next = updater([crew]);
    expect(next).toHaveLength(1);
    expect(next[0].isActive).toBe(false);
  });
});

/**
 * R124-5: помощник, чей пользователь удалён, не попадал в активный справочник
 * и исчезал из состава формы, оставаясь в отправляемых `assistantUserIds`.
 * Состав выглядел пустым, но сохранить бригаду было нельзя: сервер отбивал
 * невидимого помощника 400, а убрать его из формы было нечем.
 */
describe('CrewFormDialog — удалённый помощник виден и удаляем (F-R124-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const editWithDeletedAssistant = {
    id: 'c1', name: 'Бригада 1', isActive: true,
    operatorId: 'o1', equipmentId: 'e1', siteId: 's1',
    assistants: [{ id: 'a1', crewId: 'c1', userId: 'u-del', name: 'Пётр Удалённый' }],
  } as unknown as CrewDTO;

  it('имя удалённого помощника остаётся в составе, а не подменяется пустотой', () => {
    render(
      <CrewFormDialog
        open onClose={vi.fn()} mode="edit" editItem={editWithDeletedAssistant}
        operators={[{ id: 'o1', name: 'Оператор' }] as unknown as UserDTO[]}
        equipment={[{ id: 'e1', name: 'Техника' }] as unknown as EquipmentDTO[]}
        sites={[{ id: 's1', name: 'Объект' }] as unknown as SiteDTO[]}
        assistants={[]} loadingReferenceData={false} referenceError={null}
        onSubmit={vi.fn()} submitting={false}
      />,
    );

    expect(screen.getByText('Пётр Удалённый')).toBeInTheDocument();
    expect(screen.getByText('1 помощник(ов) в составе бригады')).toBeInTheDocument();
    expect(screen.queryByText('Помощники не выбраны')).toBeNull();
  });

  it('нераспознанный помощник подписан, а не показан сырым id', () => {
    const withUnknown = {
      ...editWithDeletedAssistant,
      assistants: [{ id: 'a2', crewId: 'c1', userId: 'u-gone', name: '' }],
    } as unknown as CrewDTO;

    render(
      <CrewFormDialog
        open onClose={vi.fn()} mode="edit" editItem={withUnknown}
        operators={[{ id: 'o1', name: 'Оператор' }] as unknown as UserDTO[]}
        equipment={[{ id: 'e1', name: 'Техника' }] as unknown as EquipmentDTO[]}
        sites={[{ id: 's1', name: 'Объект' }] as unknown as SiteDTO[]}
        assistants={[]} loadingReferenceData={false} referenceError={null}
        onSubmit={vi.fn()} submitting={false}
      />,
    );

    expect(screen.getByText('Помощник удалён')).toBeInTheDocument();
    expect(screen.queryByText('u-gone')).toBeNull();
  });
});

describe('CrewFormDialog — справочники и название (F-R102-7,9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('пустые списки объяснены, а не выглядят как «данных нет»', () => {
    render(
      <CrewFormDialog
        open onClose={vi.fn()} mode="create" editItem={null}
        operators={[]} equipment={[]} sites={[]} assistants={[]}
        loadingReferenceData={false} referenceError={null} onSubmit={vi.fn()} submitting={false}
      />,
    );

    expect(screen.getByText('Нет активных машинистов — заведите пользователя с ролью «Машинист».')).toBeInTheDocument();
    expect(screen.getByText('Список установок пуст — заведите технику в разделе «Техника».')).toBeInTheDocument();
    expect(screen.getByText('Список объектов пуст — заведите объект в разделе «Объекты».')).toBeInTheDocument();
  });

  it('пустое название нельзя сохранить — кнопка заблокирована до ввода', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const editItem = {
      id: 'c1', name: '', isActive: true, assistants: [],
      operatorId: 'o1', equipmentId: 'e1', siteId: 's1',
    } as unknown as CrewDTO;

    render(
      <CrewFormDialog
        open onClose={vi.fn()} mode="edit" editItem={editItem}
        operators={[{ id: 'o1', name: 'Оператор' }] as unknown as UserDTO[]}
        equipment={[{ id: 'e1', name: 'Техника' }] as unknown as EquipmentDTO[]}
        sites={[{ id: 's1', name: 'Объект' }] as unknown as SiteDTO[]}
        assistants={[]} loadingReferenceData={false} referenceError={null}
        onSubmit={onSubmit} submitting={false}
      />,
    );

    const save = screen.getByRole('button', { name: /Сохранить/ });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Бригада №1'), { target: { value: 'Бригада №2' } });
    expect(save).not.toBeDisabled();

    fireEvent.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: 'Бригада №2' });
  });

  /**
   * R121-8: «Название» бригады не имело maxLength, хотя createCrewSchema и
   * updateCrewSchema (src/lib/validation-schemas.ts) ограничивают имя 200
   * символами. Длинное имя уходило на сервер и возвращало 400 без имени поля.
   */
  it('название ограничено длиной 200, как в схеме маршрута', () => {
    render(
      <CrewFormDialog
        open onClose={vi.fn()} mode="create" editItem={null}
        operators={[]} equipment={[]} sites={[]} assistants={[]}
        loadingReferenceData={false} referenceError={null} onSubmit={vi.fn()} submitting={false}
      />,
    );

    expect(screen.getByPlaceholderText('Бригада №1')).toHaveAttribute('maxLength', '200');
  });
});
