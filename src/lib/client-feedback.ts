import { usePilingStore } from '@/lib/store';
import type { FeedbackEventAudience, FeedbackEventLevel, FeedbackEventPriority } from '@/lib/types';

interface ClientFeedbackInput {
  level: FeedbackEventLevel;
  priority?: FeedbackEventPriority;
  scope: string;
  action: string;
  title: string;
  message: string;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
  persist?: boolean;
  audience?: FeedbackEventAudience;
}

export function pushClientFeedback(input: ClientFeedbackInput) {
  usePilingStore.getState().addLocalFeedbackEvent({
    level: input.level,
    priority: input.priority,
    scope: input.scope,
    action: input.action,
    title: input.title,
    message: input.message,
    requestId: input.requestId || null,
    metadata: input.metadata || null,
  });

  if (!input.persist || typeof window === 'undefined') {
    return;
  }

  void fetch('/api/feedback/events', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level: input.level,
      priority: input.priority || 'MEDIUM',
      scope: input.scope,
      action: input.action,
      title: input.title,
      message: input.message,
      requestId: input.requestId || null,
      metadata: input.metadata || null,
      audience: input.audience || 'USER',
    }),
  }).catch(() => {
    // Best-effort persistence only.
  });
}
