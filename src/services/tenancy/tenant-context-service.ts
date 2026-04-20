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
  // Accept 'multi' (canonical, per validate-env) and 'true' (legacy).
  // Anything else — including 'single', 'false', or unset — disables it.
  const v = process.env.MULTI_TENANT_MODE;
  return v === 'multi' || v === 'true';
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
