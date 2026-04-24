import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { updateUserSchema } from '@/lib/validation-schemas';
import { withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

async function getUsersModule() {
  return import('@/modules/users');
}

export const PUT = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'users.manage');
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Zod validation — do NOT call .partial() here; updateUserSchema already
    // makes optional fields optional and keeps `id` REQUIRED.
    const validation = updateUserSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const validatedData = validation.data;
    const { updateUser } = await getUsersModule();

    const updated = await updateUser({
      id: validatedData.id,
      isActive: validatedData.isActive,
      name: validatedData.name,
      role: validatedData.role,
      phone: validatedData.phone,
      email: validatedData.email,
      password: validatedData.password,
    }, user!.id);

    return NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        isActive: updated.isActive,
        name: updated.name,
        role: updated.role,
        phone: updated.phone,
      },
    });
  },
  { domain: 'users' }
);
