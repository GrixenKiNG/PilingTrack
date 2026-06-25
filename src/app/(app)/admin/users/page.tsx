'use client';

import { AdminUsers } from '@/components/piling/admin-users';
import { AdminOnly } from '@/components/piling/admin-only';

export default function AdminUsersPage() {
  return (
    <AdminOnly>
      <AdminUsers />
    </AdminOnly>
  );
}
