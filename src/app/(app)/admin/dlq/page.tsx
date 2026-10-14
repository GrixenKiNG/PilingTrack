'use client';

import { AdminDlq } from '@/components/piling/admin-dlq';
import { AdminOrionLeads } from '@/components/piling/admin-orion-leads';
import { AdminOnly } from '@/components/piling/admin-only';

export default function AdminDlqPage() {
  return (
    <AdminOnly>
      <div className="space-y-8">
        <AdminDlq />
        <AdminOrionLeads />
      </div>
    </AdminOnly>
  );
}
