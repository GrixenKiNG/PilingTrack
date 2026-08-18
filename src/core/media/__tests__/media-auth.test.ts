import { describe, it, expect, vi, beforeEach } from 'vitest';

// assertCanAccessMediaEntity уходит в базу за владельцем отчёта и осмотра
// (динамическим import), поэтому мок нужен и здесь.
const { reportFindFirstMock, inspectionFindUniqueMock } = vi.hoisted(() => ({
  reportFindFirstMock: vi.fn(),
  inspectionFindUniqueMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    report: { findFirst: reportFindFirstMock },
    inspection: { findUnique: inspectionFindUniqueMock },
  },
}));

import { assertCanAccessMedia, assertCanAccessMediaEntity } from '../media-auth';

describe('assertCanAccessMediaEntity — equipment', () => {
  it('allows ADMIN to manage equipment media and rejects DISPATCHER', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    await expect(assertCanAccessMediaEntity({ id: 'u', role: 'ADMIN' } as any, 'equipment', 'eq1')).resolves.toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    await expect(assertCanAccessMediaEntity({ id: 'u', role: 'DISPATCHER' } as any, 'equipment', 'eq1')).rejects.toThrow();
  });

  it('rejects OPERATOR for equipment media', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
      assertCanAccessMediaEntity({ id: 'u', role: 'OPERATOR' } as any, 'equipment', 'eq1'),
    ).rejects.toThrow();
  });
});

describe('assertCanAccessMedia — equipment photos (existing records)', () => {
  const equipmentMedia = { userId: 'admin-1', entityType: 'equipment', entityId: 'eq1', tenantId: 'orion' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
  const operator = { id: 'op-1', role: 'OPERATOR', tenantId: 'orion' } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
  const admin = { id: 'admin-1', role: 'ADMIN', tenantId: 'orion' } as any;

  it('allows any same-tenant user to READ an equipment photo (fleet dashboard is for all roles)', () => {
    expect(() => assertCanAccessMedia(operator, equipmentMedia, 'read')).not.toThrow();
  });

  it('rejects cross-tenant and missing-tenant reads of equipment photos (fail closed)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    expect(() => assertCanAccessMedia({ id: 'x', role: 'OPERATOR', tenantId: 'other' } as any, equipmentMedia, 'read')).toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    expect(() => assertCanAccessMedia({ id: 'x', role: 'OPERATOR' } as any, equipmentMedia, 'read')).toThrow();
    expect(() => assertCanAccessMedia(operator, { ...equipmentMedia, tenantId: null }, 'read')).toThrow();
  });

  it('only ADMIN may mutate (confirm/delete) an equipment photo — DISPATCHER and OPERATOR rejected', () => {
    expect(() => assertCanAccessMedia(admin, equipmentMedia)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    expect(() => assertCanAccessMedia({ id: 'd', role: 'DISPATCHER', tenantId: 'orion' } as any, equipmentMedia)).toThrow();
    expect(() => assertCanAccessMedia(operator, equipmentMedia)).toThrow();
  });

  it('keeps legacy behavior for non-equipment media: owner or privileged role', () => {
    const reportMedia = { userId: 'op-1', entityType: 'report', entityId: 'r1', tenantId: 'orion' };
    expect(() => assertCanAccessMedia(operator, reportMedia)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    expect(() => assertCanAccessMedia({ id: 'other-op', role: 'OPERATOR', tenantId: 'orion' } as any, reportMedia)).toThrow();
  });
});

/**
 * Кому можно прикреплять фото к чужому отчёту и осмотру.
 *
 * До 18.08.2026 эти ветки (строки 38-75) не были покрыты: media-auth.ts стоял
 * на 50%. Ошибка здесь означает чужие фото в чужом отчёте.
 */
describe('assertCanAccessMediaEntity — отчёты и осмотры', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- заглушка актора
  const operator = { id: 'op-1', role: 'OPERATOR', tenantId: 'orion' } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- заглушка актора
  const dispatcher = { id: 'd-1', role: 'DISPATCHER', tenantId: 'orion' } as any;

  beforeEach(() => {
    reportFindFirstMock.mockReset();
    inspectionFindUniqueMock.mockReset();
  });

  it('привилегированная роль проходит без похода в базу', async () => {
    await expect(assertCanAccessMediaEntity(dispatcher, 'report', 'r1')).resolves.toBeUndefined();
    expect(reportFindFirstMock).not.toHaveBeenCalled();
  });

  it('оператор прикрепляет фото к своему отчёту', async () => {
    reportFindFirstMock.mockResolvedValue({ userId: 'op-1' });
    await expect(assertCanAccessMediaEntity(operator, 'report', 'r1')).resolves.toBeUndefined();
  });

  it('оператор НЕ прикрепляет фото к чужому отчёту', async () => {
    reportFindFirstMock.mockResolvedValue({ userId: 'someone-else' });
    await expect(assertCanAccessMediaEntity(operator, 'report', 'r1')).rejects.toThrow(/Forbidden/);
  });

  it('несохранённый отчёт разрешён — оператор снимает фото до отправки смены', async () => {
    // Идентификатор отчёта оператор создаёт на клиенте и прикрепляет фото
    // раньше, чем строка появится в базе. Запрет здесь ломал бы форму смены
    // на каждом новом отчёте.
    reportFindFirstMock.mockResolvedValue(null);
    await expect(assertCanAccessMediaEntity(operator, 'report', 'draft-id')).resolves.toBeUndefined();
  });

  it('оператор ведёт фото своего осмотра', async () => {
    inspectionFindUniqueMock.mockResolvedValue({ performedById: 'op-1' });
    await expect(assertCanAccessMediaEntity(operator, 'inspection', 'insp-1__item-3')).resolves.toBeUndefined();
    // Составной идентификатор режется по разделителю — в базу уходит осмотр.
    expect(inspectionFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'insp-1' } }),
    );
  });

  it('оператор НЕ ведёт фото чужого осмотра', async () => {
    inspectionFindUniqueMock.mockResolvedValue({ performedById: 'op-2' });
    await expect(assertCanAccessMediaEntity(operator, 'inspection', 'insp-1__item-3')).rejects.toThrow(/Forbidden/);
  });

  it('несуществующий осмотр запрещён — в отличие от отчёта, черновиков тут нет', async () => {
    inspectionFindUniqueMock.mockResolvedValue(null);
    await expect(assertCanAccessMediaEntity(operator, 'inspection', 'нет__item')).rejects.toThrow(/Forbidden/);
  });

  it('без типа или идентификатора сущности — отказ, а не молчаливый пропуск', async () => {
    await expect(assertCanAccessMediaEntity(operator, null, 'r1')).rejects.toThrow();
    await expect(assertCanAccessMediaEntity(operator, 'report', null)).rejects.toThrow();
  });

  it('незнакомый тип сущности закрыт по умолчанию', async () => {
    await expect(assertCanAccessMediaEntity(operator, 'invoice', 'x1')).rejects.toThrow(/недоступна/);
  });
});
