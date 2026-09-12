import type {Prisma} from '@/generated/postgres-client/client';
import {z} from 'zod';

export const ALERT_DELIVERY_EVENT = 'NotificationDeliveryRequested';
export const alertSchema = z.object({severity: z.enum(['low', 'medium', 'high', 'critical']), message: z.string().min(1),
  siteId: z.string().optional(), reportId: z.string().optional(), ruleId: z.string().optional()});

/** Enqueue inside the transaction which records the incident or defect. */
export async function enqueueAlert(tx: Pick<Prisma.TransactionClient, 'outboxEvent'>, input: {
  tenantId: string; aggregateId: string; alert: z.infer<typeof alertSchema>;
}) {
  await tx.outboxEvent.create({data: {
    type: ALERT_DELIVERY_EVENT, aggregateType: 'Notification', aggregateId: input.aggregateId,
    tenantId: input.tenantId, payload: alertSchema.parse(input.alert), projected: true,
  }});
}

export async function enqueueCriticalDefects(tx: Pick<Prisma.TransactionClient, 'outboxEvent'>, input: {
  tenantId: string; aggregateId: string; equipmentId: string; reportedBy: string;
  defects: {severity: string; title: string}[];
}) {
  const defects = input.defects.filter(d => d.severity === 'HIGH' || d.severity === 'CRITICAL');
  if (!defects.length) return;
  await enqueueAlert(tx, {tenantId: input.tenantId, aggregateId: input.aggregateId, alert: {
    severity: defects.some(d => d.severity === 'CRITICAL') ? 'critical' : 'high',
    ruleId: 'criticalDefect',
    message: ['Опасный дефект установки ' + input.equipmentId,
      ...defects.map(d => d.title), 'Зафиксировал: ' + input.reportedBy].join('\n'),
  }});
}

