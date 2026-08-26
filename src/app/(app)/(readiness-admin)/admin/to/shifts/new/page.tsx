'use client';

import { Suspense, useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import { ShiftCreateForm } from '@/components/piling/to/readiness/shift-create-form';

/**
 * Часовой пояс организации нужен форме до отправки: производственные сутки и
 * плановое окно смены считаются в нём, а не в поясе браузера.
 *
 * Пока пояс не пришёл, форму не показываем: подставить «Europe/Moscow» и потом
 * молча переставить время — значит дать человеку подтвердить одно окно, а
 * отправить другое.
 */
function ShiftCreatePage() {
  const [timezone, setTimezone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await authFetch('/api/readiness/bootstrap');
      if (cancelled) return;
      if (!response.ok) return setTimezone('Europe/Moscow');
      const body = await response.json().catch(() => null);
      setTimezone(body?.data?.tenant?.timezone ?? body?.tenant?.timezone ?? 'Europe/Moscow');
    })();
    return () => { cancelled = true; };
  }, []);

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
