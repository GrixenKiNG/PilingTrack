import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createUserSchema, deleteIdSchema, updateUserSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';
import { parseCursorPagination } from '@/lib/pagination-cursor';


export const runtime = 'nodejs';

async function getUsersModule() {
  return import('@/modules/users');
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'users.manage');
    const role = request.nextUrl.searchParams.get('role');
    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const { listUsers } = await getUsersModule();
    const users = await listUsers(role, pagination);
    const nextCursor = pagination.getNextCursor(users);
    return NextResponse.json({ users, nextCursor });
  },
  { domain: 'users', cache: true, cacheTTL: 30_000 }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'users.manage');
    const body = await request.json();

    const validation = createUserSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    // isActive is intentionally extracted to exclude it from `rest` (createUser
    // does not accept it; new users default to active).
    const { pin, password, isActive: _isActive, ...rest } = validation.data;
    if (!password?.trim() && !pin?.trim()) {
      return NextResponse.json(
        { error: 'password or pin is required' },
        { status: 400 }
      );
    }

    const { createUser } = await getUsersModule();
    const createdUser = await createUser({
      ...rest,
      password: password?.trim() || pin?.trim() || '',
      role: rest.role || 'OPERATOR',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      tenantId: user!.tenantId,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    }, user!.id);
    return NextResponse.json({ user: createdUser }, { status: 201 });
  },
  { domain: 'users' }
);

export const PUT = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'users.manage');
    const body = await request.json();

    const validation = updateUserSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const { updateUser } = await getUsersModule();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const updatedUser = await updateUser(validation.data, user!.id);
    return NextResponse.json({ user: updatedUser });
  },
  { domain: 'users' }
);

export const DELETE = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'users.manage');
    const body = await request.json();

    const validation = deleteIdSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const { deleteUser } = await getUsersModule();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const result = await deleteUser(user!.id, validation.data.id);
    return NextResponse.json(result);
  },
  { domain: 'users' }
);
