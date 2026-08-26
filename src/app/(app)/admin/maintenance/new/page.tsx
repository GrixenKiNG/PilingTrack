'use client';

import { Suspense } from 'react';
import { MaintenanceRequestForm } from '@/components/piling/maintenance/maintenance-request-form';

// Suspense обязателен: форма читает `equipmentId` из адреса через
// useSearchParams, а он требует границы приостановки при пререндере.
export default function NewMaintenanceRequestPage() {
  return (
    <Suspense fallback={null}>
      <MaintenanceRequestForm />
    </Suspense>
  );
}
