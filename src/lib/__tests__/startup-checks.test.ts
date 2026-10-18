import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { logger } from '@/lib/logger';
import { reportMissingDefaultTenant } from '../startup-checks';

describe('reportMissingDefaultTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('на проде без DEFAULT_TENANT_ID пишет ошибку в журнал и сообщает о проблеме', () => {
    expect(reportMissingDefaultTenant({ NODE_ENV: 'production' })).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('DEFAULT_TENANT_ID'));
  });

  it('пустая строка из пробелов — тоже «не задана»', () => {
    expect(reportMissingDefaultTenant({ NODE_ENV: 'production', DEFAULT_TENANT_ID: '  ' })).toBe(true);
  });

  it('на проде с переменной молчит', () => {
    expect(reportMissingDefaultTenant({ NODE_ENV: 'production', DEFAULT_TENANT_ID: 'orion' })).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('вне прода не шумит: локально организация берётся из сида', () => {
    expect(reportMissingDefaultTenant({ NODE_ENV: 'development' })).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
