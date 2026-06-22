import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { assertNotSelfAction } from '@/services/auth/authorization-service';
import { computePinLookup, hashPassword, hashPin } from '@/services/auth/auth-service';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { type CursorPaginationResult } from '@/lib/pagination-cursor';
import type { OperationalUserDTO, UserRole } from '@/lib/types';

function requireTenantId(tenantId: string | null | undefined): string {
  if (!tenantId) throw new ServiceError('Tenant context missing', 400);
  return tenantId;
}

function isUniqueConstraintError(message: string) {
  return message.includes('Unique') || message.includes('unique constraint');
}

export async function listAssignableUsers(tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  return db.user.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
}

export async function listUsers(
  tenantId: string,
  role?: string | null,
  pagination?: CursorPaginationResult
): Promise<OperationalUserDTO[]> {
  const where: Record<string, unknown> = { tenantId: requireTenantId(tenantId) };
  if (role) {
    where.role = role;
  }

  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;

  const users = await db.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      sites: {
        select: { site: { select: { id: true, name: true } } },
      },
      crew: {
        select: {
          id: true,
          name: true,
          isActive: true,
          equipment: { select: { name: true } },
          site: { select: { name: true } },
        },
      },
      _count: { select: { reports: true, sites: true } },
      reports: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { updatedAt: true },
      },
    },
    orderBy: { name: 'asc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });

  const userIds = users.map((user) => user.id);
  const loginEvents = userIds.length > 0
    ? await db.feedbackEvent.findMany({
        where: {
          action: 'auth.login.succeeded',
          actorId: { in: userIds },
        },
        select: { actorId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const lastLoginByUserId = new Map<string, Date>();
  for (const event of loginEvents) {
    if (event.actorId && !lastLoginByUserId.has(event.actorId)) {
      lastLoginByUserId.set(event.actorId, event.createdAt);
    }
  }

  return users.map((user) => {
    const lastLogin = lastLoginByUserId.get(user.id) ?? null;
    const lastReport = user.reports[0]?.updatedAt ?? null;
    const activities = [
      { source: 'login' as const, at: lastLogin },
      { source: 'report' as const, at: lastReport },
      { source: 'profile' as const, at: user.updatedAt },
    ].filter((activity): activity is { source: 'login' | 'report' | 'profile'; at: Date } =>
      activity.at !== null
    );
    const latestActivity = activities.sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
    const activeCrew = user.crew?.isActive ? user.crew : null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role as UserRole,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      assignedSites: user.sites.map(({ site }) => site),
      activeCrew: activeCrew
        ? {
            id: activeCrew.id,
            name: activeCrew.name,
            equipmentName: activeCrew.equipment?.name ?? null,
            siteName: activeCrew.site?.name ?? null,
          }
        : null,
      reportCount: user._count.reports,
      canHardDelete: user._count.reports === 0 && user._count.sites === 0 && user.crew === null,
      lastReportAt: lastReport?.toISOString() ?? null,
      lastLoginAt: lastLogin?.toISOString() ?? null,
      lastActivityAt: latestActivity?.at.toISOString() ?? null,
      lastActivitySource: latestActivity?.source ?? null,
    };
  });
}

export async function createUser(input: {
  email: string;
  password?: string;
  pin?: string;
  name: string;
  role?: string;
  phone?: string;
  tenantId?: string | null;
}, actorUserId?: string | null) {
  if (!input.email || !input.name || (!input.password && !input.pin)) {
    throw new ServiceError('email, name and password or PIN required', 400);
  }

  const tenantId = requireTenantId(input.tenantId);

  try {
    const hashedPassword = input.password ? await hashPassword(input.password) : '';
    const hashedPin = input.pin ? await hashPin(input.pin) : null;
    const pinLookup = input.pin ? computePinLookup(input.pin) : null;

    const createdUser = await db.user.create({
      data: {
        tenantId,
        email: input.email.trim().toLowerCase(),
        password: hashedPassword,
        pin: hashedPin,
        pinLookup,
        name: input.name.trim(),
        phone: String(input.phone || '').trim().slice(0, 20),
        role: input.role || 'OPERATOR',
      },
      select: { id: true, email: true, name: true, phone: true, role: true, isActive: true },
    });

    await recordAuditEvent({
      action: 'user.created',
      scope: 'users',
      actorId: actorUserId || null,
      targetId: createdUser.id,
      metadata: {
        email: createdUser.email,
        role: createdUser.role,
        isActive: createdUser.isActive,
      },
    });

    return createdUser;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    if (isUniqueConstraintError(message)) {
      throw new ServiceError('User with this email already exists', 409);
    }
    throw error;
  }
}

export interface UpdateUserInput {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  isActive?: boolean;
  password?: string;
  pin?: string;
}

export async function updateUser(
  tenantId: string,
  input: UpdateUserInput,
  actorUserId?: string | null
) {
  const scopedTenantId = requireTenantId(tenantId);
  if (!input.id) {
    throw new ServiceError('id required', 400);
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
  if (input.phone !== undefined) data.phone = input.phone.trim().slice(0, 20);
  if (input.role !== undefined) data.role = input.role;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.password) data.password = await hashPassword(input.password);
  if (input.pin) {
    data.pin = await hashPin(input.pin);
    data.pinLookup = computePinLookup(input.pin);
  }
  if (input.isActive === false || input.password || input.pin) {
    data.sessionVersion = { increment: 1 };
  }

  try {
    const previousUser = await db.user.findFirst({
      where: { id: input.id, tenantId: scopedTenantId },
      select: { id: true, email: true, name: true, phone: true, role: true, isActive: true },
    });
    if (!previousUser) {
      throw new ServiceError('User not found', 404);
    }

    const updatedUser = await db.user.update({
      where: { id: input.id, tenantId: scopedTenantId },
      data,
      select: { id: true, email: true, name: true, phone: true, role: true, isActive: true },
    });

    await recordAuditEvent({
      action: 'user.updated',
      scope: 'users',
      actorId: actorUserId || null,
      targetId: updatedUser.id,
      metadata: {
        before: previousUser,
        after: updatedUser,
      },
    });

    return updatedUser;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    if (message.includes('Record to update not found')) {
      throw new ServiceError('User not found', 404);
    }
    if (isUniqueConstraintError(message)) {
      throw new ServiceError('User with this email already exists', 409);
    }
    throw error;
  }
}

export async function deleteUser(tenantId: string, actorUserId: string, targetUserId: string) {
  const scopedTenantId = requireTenantId(tenantId);
  if (!targetUserId) {
    throw new ServiceError('id required', 400);
  }

  assertNotSelfAction(actorUserId, targetUserId, 'Cannot delete yourself');

  const user = await db.user.findFirst({
    where: { id: targetUserId, tenantId: scopedTenantId },
    select: {
      id: true,
      email: true,
      role: true,
      crew: { select: { id: true } },
      _count: { select: { reports: true, sites: true } },
    },
  });
  if (!user) {
    throw new ServiceError('User not found', 404);
  }
  if (user.crew || user._count.reports > 0 || user._count.sites > 0) {
    throw new ServiceError('Cannot delete user with reports or assignments; block the user instead', 409);
  }

  try {
    await db.user.delete({ where: { id: targetUserId, tenantId: scopedTenantId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    if (message.includes('Record to delete not found')) {
      throw new ServiceError('User not found', 404);
    }
    if (message.includes('FOREIGN KEY')) {
      throw new ServiceError('Cannot delete user with linked reports or assignments', 409);
    }
    throw error;
  }

  await recordAuditEvent({
    action: 'user.deleted',
    scope: 'users',
    actorId: actorUserId,
    targetId: targetUserId,
    metadata: {
      email: user.email,
      role: user.role,
    },
  });

  return { success: true };
}
