import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { assertNotSelfAction } from '@/services/auth/authorization-service';
import { hashPassword } from '@/services/auth/auth-service';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { parseCursorPagination, type CursorPaginationResult } from '@/lib/pagination-cursor';
import { resolveTenantContext } from '@/services/tenancy/tenant-context-service';

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
  role?: string | null,
  pagination?: CursorPaginationResult
) {
  const where: Record<string, unknown> = {};
  if (role) {
    where.role = role;
  }

  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;

  return db.user.findMany({
    where,
    select: { id: true, email: true, name: true, phone: true, role: true, isActive: true },
    orderBy: { name: 'asc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });
}

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  role?: string;
  phone?: string;
  tenantId?: string | null;
}, actorUserId?: string | null) {
  if (!input.email || !input.name || !input.password) {
    throw new ServiceError('email, name, password required', 400);
  }

  // User.tenantId is NOT NULL in the database. Inherit the creating admin's
  // tenant, falling back to the configured default. Fail closed rather than
  // insert a NULL (which surfaces as an opaque 500 — hit on prod 2026-06-17).
  const tenantId = input.tenantId || resolveTenantContext().tenantId;
  if (!tenantId) {
    throw new ServiceError('tenantId is required to create a user', 400);
  }

  try {
    const hashedPassword = await hashPassword(input.password);

    const createdUser = await db.user.create({
      data: {
        tenantId,
        email: input.email.trim().toLowerCase(),
        password: hashedPassword,
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

export async function updateUser(input: {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  isActive?: boolean;
  password?: string;
}, actorUserId?: string | null) {
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

  try {
    const previousUser = await db.user.findUnique({
      where: { id: input.id },
      select: { id: true, email: true, name: true, phone: true, role: true, isActive: true },
    });

    const updatedUser = await db.user.update({
      where: { id: input.id },
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

export async function deleteUser(actorUserId: string, targetUserId: string) {
  if (!targetUserId) {
    throw new ServiceError('id required', 400);
  }

  assertNotSelfAction(actorUserId, targetUserId, 'Cannot delete yourself');

  const user = await db.user.findUnique({ where: { id: targetUserId } });
  if (!user) {
    throw new ServiceError('User not found', 404);
  }

  try {
    await db.user.delete({ where: { id: targetUserId } });
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
