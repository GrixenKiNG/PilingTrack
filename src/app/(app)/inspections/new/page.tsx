'use client';

import { Suspense } from 'react';
import { StartInspectionForm } from '@/components/piling/inspections/start-inspection-form';

export default function NewInspectionPage() {
  return (
    <Suspense fallback={null}>
      <StartInspectionForm />
    </Suspense>
  );
}
