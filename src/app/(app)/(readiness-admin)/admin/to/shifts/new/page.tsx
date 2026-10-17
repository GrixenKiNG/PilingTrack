'use client';

import { Suspense, useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { ShiftCreateForm } from '@/components/piling/to/readiness/shift-create-form';

/**
 * Часовой пояс организации нужен форме до отправки: производственные сутки и
 * плановое окно смены считаются в нём, а не в поясе браузера.
 *
 * Пока пояс не пришёл, форму не показываем: подставить «Europe/Moscow» и потом
 * молча переставить время — значит дать человеку подтвердить одно окно, а
 * отправить другое. Поэтому при сбое загрузки показываем ошибку с повтором, а не
 * молча берём московский пояс.
 */
function ShiftCreatePage() {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authFetch('/api/readiness/bootstrap');
        if (cancelled) return;
        if (!response.ok) return setFailed(true);
        const body = await response.json().catch(() => null);
        setTimezone(body?.data?.tenant?.timezone ?? body?.tenant?.timezone ?? 'Europe/Moscow');
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  if (failed && !timezone) {
    return (
      <QueryErrorBanner
        title="Не удалось загрузить часовой пояс организации"
        message="Без него окно смены можно задать неверно. Повторите попытку."
        onRetry={() => { setFailed(false); setAttempt((n) => n + 1); }}
      />
    );
  }
  if (!timezone) return null;
  return <ShiftCreateForm timezone={timezone} backHref="/admin/to?tab=shifts" />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ShiftCreatePage />
    </Suspense>
  );
}
