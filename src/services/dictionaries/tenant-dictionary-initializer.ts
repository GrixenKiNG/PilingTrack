import type { Prisma } from '@/generated/postgres-client/client';
import {
  DOWNTIME_REASON_TEMPLATES,
  DRILLING_TYPE_TEMPLATES,
  normalizeDictionaryName,
  PILE_GRADE_TEMPLATES,
} from './system-templates';

type TenantDictionaryClient = Pick<
  Prisma.TransactionClient,
  'pileGrade' | 'drillingType' | 'downtimeReason'
>;

export async function initializeTenantDictionaries(
  client: TenantDictionaryClient,
  tenantId: string
): Promise<void> {
  await Promise.all([
    client.pileGrade.createMany({
      data: PILE_GRADE_TEMPLATES.map((template) => ({
        tenantId,
        name: template.name,
        normalizedName: normalizeDictionaryName(template.name),
        code: template.code,
        lengthMm: template.lengthMm,
        sectionOrDiameter: null,
        notes: '',
      })),
      skipDuplicates: true,
    }),
    client.drillingType.createMany({
      data: DRILLING_TYPE_TEMPLATES.map((template) => ({
        tenantId,
        name: template.name,
        normalizedName: normalizeDictionaryName(template.name),
      })),
      skipDuplicates: true,
    }),
    client.downtimeReason.createMany({
      data: DOWNTIME_REASON_TEMPLATES.map((template) => ({
        tenantId,
        name: template.name,
        normalizedName: normalizeDictionaryName(template.name),
      })),
      skipDuplicates: true,
    }),
  ]);
}
