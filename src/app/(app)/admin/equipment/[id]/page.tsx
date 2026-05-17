'use client';

import { use } from 'react';
import { EquipmentDetail } from '@/components/piling/admin-equipment/detail/equipment-detail';

export default function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EquipmentDetail equipmentId={id} />;
}
