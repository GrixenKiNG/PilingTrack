import { z } from 'zod';

/**
 * Форма вида документа работника.
 *
 * Живёт отдельным модулем, а не в `route.ts`: файл маршрута Next может
 * экспортировать только обработчики и его собственные настройки, любой лишний
 * экспорт валит сборку проверкой типов маршрута. Схему читает и `[id]/route.ts`
 * — там из неё делается частичная для PATCH.
 */
export const documentTypeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  requiresExpiry: z.boolean().optional(),
  defaultValidMonths: z.number().int().min(1).max(600).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  requiredForOperator: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});
