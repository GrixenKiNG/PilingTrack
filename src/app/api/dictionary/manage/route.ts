import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createDictionaryItem, deleteDictionaryItem } from '@/services/dictionaries/dictionary-service';
import { z } from 'zod';
import { withMutation } from '@/core/api-wrapper';

const createDictionaryItemSchema = z.object({
  type: z.enum(['pileGrade', 'drillingType', 'downtimeReason']),
  name: z.string().min(1).max(100),
});

const deleteDictionaryItemSchema = z.object({
  type: z.enum(['pileGrade', 'drillingType', 'downtimeReason']),
  id: z.string().min(1),
});


export const runtime = 'nodejs';

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'dictionary.manage');
    const body = await request.json();
    const validated = createDictionaryItemSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const item = await createDictionaryItem(validated.data.type, validated.data.name);
    return NextResponse.json({ item });
  },
  { domain: 'dictionary' }
);

export const DELETE = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'dictionary.manage');
    const body = await request.json();
    const validated = deleteDictionaryItemSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const result = await deleteDictionaryItem(validated.data.type, validated.data.id);
    return NextResponse.json(result);
  },
  { domain: 'dictionary' }
);
