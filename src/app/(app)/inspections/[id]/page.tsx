'use client';

import { use } from 'react';
import { RunInspection } from '@/components/piling/inspections/run-inspection';

export default function InspectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <RunInspection inspectionId={id} />;
}
