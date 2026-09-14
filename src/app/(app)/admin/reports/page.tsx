'use client';

import { Suspense } from 'react';
import { ReportsModule } from '@/components/piling/admin-reports/reports-module';

/**
 * Suspense обязателен: вкладка читается из адреса (`useSearchParams`), а без
 * границы ожидания Next валит на этом всю статическую сборку страницы.
 */
export default function AdminReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsModule />
    </Suspense>
  );
}
