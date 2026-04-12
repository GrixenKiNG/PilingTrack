import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  createSiteSchema,
  createEquipmentSchema,
  createCrewSchema,
  reportUpsertSchema,
  createUserSchema,
  dictionaryItemSchema,
  telegramConfigSchema,
  paginationSchema,
  pinAuthSchema,
} from '../validation-schemas';

describe('validation-schemas', () => {
  describe('loginSchema', () => {
    it('validates valid login', () => {
      const result = loginSchema.safeParse({ email: 'test@piling.ru', password: 'secret123' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = loginSchema.safeParse({ email: 'not-an-email', password: 'secret' });
      expect(result.success).toBe(false);
    });

    it('rejects empty password', () => {
      const result = loginSchema.safeParse({ email: 'test@piling.ru', password: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing fields', () => {
      const result = loginSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('createUserSchema', () => {
    it('validates valid user with password', () => {
      const result = createUserSchema.safeParse({
        email: 'user@piling.ru',
        name: 'Test User',
        role: 'OPERATOR',
        password: 'password123',
      });
      expect(result.success).toBe(true);
    });

    it('validates valid user with PIN', () => {
      const result = createUserSchema.safeParse({
        email: 'user@piling.ru',
        name: 'Test User',
        role: 'OPERATOR',
        pin: '1234',
      });
      expect(result.success).toBe(true);
    });

    it('rejects when neither password nor PIN provided', () => {
      const result = createUserSchema.safeParse({
        email: 'user@piling.ru',
        name: 'Test User',
        role: 'OPERATOR',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid role', () => {
      const result = createUserSchema.safeParse({
        email: 'user@piling.ru',
        name: 'Test User',
        role: 'INVALID_ROLE',
        password: 'pass',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid PIN format', () => {
      const result = createUserSchema.safeParse({
        email: 'user@piling.ru',
        name: 'Test User',
        role: 'OPERATOR',
        pin: 'abc123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createSiteSchema', () => {
    it('validates valid site', () => {
      const result = createSiteSchema.safeParse({ name: 'Test Site' });
      expect(result.success).toBe(true);
    });

    it('defaults status to active', () => {
      const result = createSiteSchema.safeParse({ name: 'Test Site' });
      expect((result as any).data.status).toBe('active');
    });

    it('rejects empty name', () => {
      const result = createSiteSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid status', () => {
      const result = createSiteSchema.safeParse({ name: 'Test', status: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('createEquipmentSchema', () => {
    it('validates valid equipment', () => {
      const result = createEquipmentSchema.safeParse({ name: 'Excavator' });
      expect(result.success).toBe(true);
    });

    it('defaults qty to 1', () => {
      const result = createEquipmentSchema.safeParse({ name: 'Excavator' });
      expect((result as any).data.qty).toBe(1);
    });

    it('defaults isActive to true', () => {
      const result = createEquipmentSchema.safeParse({ name: 'Excavator' });
      expect((result as any).data.isActive).toBe(true);
    });

    it('rejects name too long', () => {
      const result = createEquipmentSchema.safeParse({ name: 'a'.repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe('createCrewSchema', () => {
    it('validates valid crew', () => {
      const result = createCrewSchema.safeParse({
        operatorId: 'op-1',
        equipmentId: 'eq-1',
        siteId: 'site-1',
      });
      expect(result.success).toBe(true);
    });

    it('defaults assistantNames to empty array', () => {
      const result = createCrewSchema.safeParse({
        operatorId: 'op-1',
        equipmentId: 'eq-1',
        siteId: 'site-1',
      });
      expect((result as any).data.assistantNames).toEqual([]);
    });

    it('rejects missing operatorId', () => {
      const result = createCrewSchema.safeParse({
        equipmentId: 'eq-1',
        siteId: 'site-1',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('reportUpsertSchema', () => {
    it('validates minimal valid report', () => {
      const result = reportUpsertSchema.safeParse({
        siteId: 'site-1',
        date: '2026-04-05',
      });
      expect(result.success).toBe(true);
    });

    it('defaults shiftType to DAY', () => {
      const result = reportUpsertSchema.safeParse({
        siteId: 'site-1',
        date: '2026-04-05',
      });
      expect((result as any).data.shiftType).toBe('DAY');
    });

    it('defaults status to draft', () => {
      const result = reportUpsertSchema.safeParse({
        siteId: 'site-1',
        date: '2026-04-05',
      });
      expect((result as any).data.status).toBe('draft');
    });

    it('validates date format', () => {
      const result = reportUpsertSchema.safeParse({
        siteId: 'site-1',
        date: '05-04-2026',
      });
      expect(result.success).toBe(false);
    });

    it('validates piles array', () => {
      const result = reportUpsertSchema.safeParse({
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 5 }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects negative pile count', () => {
      const result = reportUpsertSchema.safeParse({
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: -1 }],
      });
      expect(result.success).toBe(false);
    });

    it('validates drillings with meters', () => {
      const result = reportUpsertSchema.safeParse({
        siteId: 'site-1',
        date: '2026-04-05',
        drillings: [{ typeId: 'type-1', meters: 12.5 }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid shift type', () => {
      const result = reportUpsertSchema.safeParse({
        siteId: 'site-1',
        date: '2026-04-05',
        shiftType: 'EVENING',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('paginationSchema', () => {
    it('coerces string numbers', () => {
      const result = paginationSchema.safeParse({ page: '2', limit: '10' });
      expect(result.success).toBe(true);
      expect((result as any).data.page).toBe(2);
    });

    it('defaults page to 1 and limit to 50', () => {
      const result = paginationSchema.safeParse({});
      expect((result as any).data.page).toBe(1);
      expect((result as any).data.limit).toBe(50);
    });

    it('rejects page <= 0', () => {
      const result = paginationSchema.safeParse({ page: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects limit > 100', () => {
      const result = paginationSchema.safeParse({ limit: 200 });
      expect(result.success).toBe(false);
    });
  });

  describe('telegramConfigSchema', () => {
    it('validates valid config', () => {
      const result = telegramConfigSchema.safeParse({
        label: 'Main Bot',
        botToken: '123456:ABC-DEF',
        chatId: '-1001234567890',
      });
      expect(result.success).toBe(true);
    });

    it('defaults enabled to true', () => {
      const result = telegramConfigSchema.safeParse({
        label: 'Main Bot',
        botToken: '123456:ABC-DEF',
        chatId: '-1001234567890',
      });
      expect((result as any).data.enabled).toBe(true);
    });

    it('rejects empty botToken', () => {
      const result = telegramConfigSchema.safeParse({
        label: 'Main Bot',
        botToken: '',
        chatId: '-1001234567890',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dictionaryItemSchema', () => {
    it('validates valid item', () => {
      const result = dictionaryItemSchema.safeParse({
        type: 'PileGrade',
        name: 'Grade A',
      });
      expect(result.success).toBe(true);
    });

    it('defaults isActive to true', () => {
      const result = dictionaryItemSchema.safeParse({
        type: 'PileGrade',
        name: 'Grade A',
      });
      expect((result as any).data.isActive).toBe(true);
    });
  });
});
