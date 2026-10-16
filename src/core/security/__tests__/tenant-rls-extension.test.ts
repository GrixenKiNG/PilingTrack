import {describe, expect, it, vi} from 'vitest';
import {runWithTenantContext, setRequestTenantId} from '../tenant-context';
import {applyTenantGuc, runOutsideGucScope, runWithGucApplied, isGucApplied} from '../tenant-rls';

/**
 * Расширение клиента: каждая операция над моделью несёт организацию. Оно ставит
 * set_config и сам запрос в один пакет, иначе переменная погасла бы раньше запроса.
 */
function fakeClient() {
  const calls: string[] = [];
  const client = {
    $extends: vi.fn((extension: unknown) => ({extension})),
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`raw:${strings.join('?')}:${values.join(',')}`);
      return 'set-config-op';
    }),
    $transaction: vi.fn(async (ops: unknown[]) => ['set-config-result', await ops[1]]),
  };
  const extension = (applyTenantGuc(client as never) as unknown as {
    extension: {query: {$allModels: {$allOperations: (input: {args: unknown; query: (a: unknown) => Promise<unknown>}) => Promise<unknown>}}};
  }).extension;
  return {client, calls, operation: extension.query.$allModels.$allOperations};
}

describe('расширение клиента: организация в каждом запросе', () => {
  it('без организации запрос идёт как есть', async () => {
    const {client, operation} = fakeClient();
    const query = vi.fn().mockResolvedValue('rows');
    expect(await operation({args: {where: 1}, query})).toBe('rows');
    expect(query).toHaveBeenCalledWith({where: 1});
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('с организацией set_config и запрос уходят одним пакетом, наружу — только результат запроса', async () => {
    const {client, calls, operation} = fakeClient();
    const query = vi.fn().mockResolvedValue('rows');
    const result = await runWithTenantContext(async () => {
      setRequestTenantId('orion');
      return operation({args: {where: 1}, query});
    });
    expect(result).toBe('rows');
    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(calls[0]).toContain("set_config('app.current_tenant'");
    expect(calls[0]).toContain('orion');
  });

  it('внутри уже открытой транзакции пакет не создаётся повторно', async () => {
    const {client, operation} = fakeClient();
    const query = vi.fn().mockResolvedValue('rows');
    await runWithTenantContext(async () => {
      setRequestTenantId('orion');
      await runWithGucApplied(() => operation({args: {}, query}));
    });
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
  });

  it('запрос глобальным клиентом из транзакции выходит из пометки и снова несёт организацию', async () => {
    await runWithTenantContext(async () => {
      setRequestTenantId('orion');
      await runWithGucApplied(async () => {
        expect(isGucApplied()).toBe(true);
        expect(runOutsideGucScope(() => isGucApplied())).toBe(false);
      });
    });
  });
});
