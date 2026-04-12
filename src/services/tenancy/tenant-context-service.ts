export interface TenantContext {
  mode: 'single' | 'multi';
  tenantId: string | null;
  source: 'default' | 'header' | 'none';
}

interface HeaderCarrier {
  headers: {
    get(name: string): string | null;
  };
}

export function isMultiTenantMode() {
  return process.env.MULTI_TENANT_MODE === 'true';
}

export function resolveTenantContext(request?: HeaderCarrier): TenantContext {
  const defaultTenantId = process.env.DEFAULT_TENANT_ID || null;

  if (!isMultiTenantMode()) {
    return {
      mode: 'single',
      tenantId: defaultTenantId,
      source: defaultTenantId ? 'default' : 'none',
    };
  }

  const tenantId = request?.headers.get('x-tenant-id') || defaultTenantId;

  return {
    mode: 'multi',
    tenantId,
    source: request?.headers.get('x-tenant-id') ? 'header' : defaultTenantId ? 'default' : 'none',
  };
}
