// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Публичная форма заявки на сайте ОРИОН. Без входа по замыслу, поэтому защита
  вся здесь. Держится:
  - частота: после лимита заявка не читается и не пишется;
  - сначала сохранение, потом Telegram: недоступный Telegram не теряет заявку;
  - ловушка (скрытое поле): заявка хранится с пометкой, боту — «ок», в чат не идёт;
  - текст в Telegram экранирован (уходит как HTML);
  - исход доставки записывается: `false` от отправителя — это НЕ доставлено;
  - без организации по умолчанию заявка не молча теряется, а отказ 500.
*/
const h = vi.hoisted(() => ({
  check: vi.fn(),
  sendMessage: vi.fn(),
  leadCreate: vi.fn(),
  leadUpdate: vi.fn(),
  withTenantContext: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({
  rateLimiter: {check: h.check},
  getRateLimitIdentifier: () => 'ip:1.2.3.4',
}));
vi.mock('@/core/notifications/telegram', () => ({telegramNotifier: {sendMessage: h.sendMessage}}));
vi.mock('@/core/security/tenant-enforcement', () => ({withTenantContext: h.withTenantContext}));
vi.mock('@/lib/logger', () => ({logger: {error: h.loggerError, info: vi.fn(), warn: vi.fn()}}));

import {POST} from '../route';

const post = (body: unknown, raw = false) => POST(new NextRequest('http://localhost/api/orion/lead', {
  method: 'POST', headers: {'content-type': 'application/json'}, body: raw ? String(body) : JSON.stringify(body),
}));
const LEAD = {name: 'Пётр', contact: '+7 900 000-00-00', message: 'Нужна забивка', consent: true};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DEFAULT_TENANT_ID', 'orion');
  h.check.mockResolvedValue({allowed: true});
  h.sendMessage.mockResolvedValue(true);
  h.leadCreate.mockResolvedValue({id: 'lead-1'});
  h.leadUpdate.mockResolvedValue({});
  h.withTenantContext.mockImplementation(async (_tenantId: string, work: (tx: unknown) => unknown) => work({
    orionLead: {create: h.leadCreate, update: h.leadUpdate},
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/orion/lead — защита', () => {
  it('сверх лимита: 429 с Retry-After, тело не читается, ничего не пишется', async () => {
    h.check.mockResolvedValue({allowed: false, retryAfter: 120});

    const response = await post(LEAD);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(h.leadCreate).not.toHaveBeenCalled();
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['не JSON', '{не json', true],
    ['нет согласия', {...LEAD, consent: false}, false],
    ['пустое имя', {...LEAD, name: '   '}, false],
    ['слишком длинное сообщение', {...LEAD, message: 'я'.repeat(1501)}, false],
    ['нет контакта', {name: 'Пётр', consent: true}, false],
  ])('%s: 400 и ничего не пишется', async (_name, body, raw) => {
    const response = await post(body, raw);

    expect(response.status).toBe(400);
    expect(h.leadCreate).not.toHaveBeenCalled();
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it('ловушка заполнена: заявка хранится с пометкой «спам», боту «ок», в Telegram не идёт', async () => {
    const response = await post({...LEAD, website: 'http://spam.example'});

    expect(await response.json()).toEqual({ok: true});
    expect(h.leadCreate.mock.calls[0][0].data).toMatchObject({isSpam: true, tenantId: 'orion'});
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it('текст для Telegram экранируется: разметка из формы не доходит до чата', async () => {
    await post({...LEAD, name: '<b>Хакер</b>', contact: 'a&b', message: '<script>x</script>'});

    const text = h.sendMessage.mock.calls[0][0] as string;
    expect(text).toContain('&lt;b&gt;Хакер&lt;/b&gt;');
    expect(text).toContain('a&amp;b');
    expect(text).not.toContain('<script>');
  });
});

describe('POST /api/orion/lead — сохранение и доставка', () => {
  it('сохраняет заявку до отправки и отмечает доставку', async () => {
    const response = await post(LEAD);

    expect(await response.json()).toEqual({ok: true});
    expect(h.leadCreate.mock.calls[0][0].data).toEqual({
      tenantId: 'orion', name: 'Пётр', contact: '+7 900 000-00-00', message: 'Нужна забивка', isSpam: false,
    });
    expect(h.leadCreate.mock.invocationCallOrder[0]).toBeLessThan(h.sendMessage.mock.invocationCallOrder[0]);
    expect(h.leadUpdate.mock.calls[0][0]).toMatchObject({where: {id: 'lead-1'}, data: {deliveredAt: expect.any(Date)}});
  });

  it('отправитель вернул false (бот не настроен): заявка НЕ помечена доставленной', async () => {
    h.sendMessage.mockResolvedValue(false);

    const response = await post(LEAD);

    expect(response.status).toBe(200);
    const update = h.leadUpdate.mock.calls[0][0];
    expect(update.data).toEqual({deliveryError: expect.stringContaining('Telegram')});
    expect(update.data).not.toHaveProperty('deliveredAt');
  });

  it('отправитель бросил исключение: заявка сохранена, причина записана, посетителю «ок»', async () => {
    h.sendMessage.mockRejectedValue(new Error('proxy timeout'));

    const response = await post(LEAD);

    expect(response.status).toBe(200);
    expect(h.leadUpdate.mock.calls[0][0].data).toEqual({deliveryError: 'proxy timeout'});
    expect(h.loggerError).toHaveBeenCalledWith('Failed to forward ORION lead to Telegram', expect.objectContaining({leadId: 'lead-1'}));
  });

  it('неудачная запись исхода доставки не ломает ответ: заявка уже сохранена', async () => {
    h.leadUpdate.mockRejectedValue(new Error('db down'));

    const response = await post(LEAD);

    expect(response.status).toBe(200);
    expect(h.loggerError).toHaveBeenCalledWith('Failed to record ORION lead delivery status', expect.anything());
  });

  it('база недоступна при сохранении: 500 «позвоните нам», в Telegram ничего не уходит, заявка в журнале', async () => {
    h.withTenantContext.mockRejectedValue(new Error('db down'));

    const response = await post(LEAD);

    expect(response.status).toBe(500);
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.loggerError).toHaveBeenCalledWith('ORION lead could not be stored', expect.objectContaining({name: 'Пётр', contact: '+7 900 000-00-00'}));
  });

  it('организация по умолчанию не задана: 500 и заявка в журнале, а не молчаливая потеря', async () => {
    vi.stubEnv('DEFAULT_TENANT_ID', '');

    const response = await post(LEAD);

    expect(response.status).toBe(500);
    expect(h.leadCreate).not.toHaveBeenCalled();
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining('DEFAULT_TENANT_ID'), expect.objectContaining({contact: '+7 900 000-00-00'}));
  });
});
