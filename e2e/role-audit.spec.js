import {test,expect} from './fixtures/disposable.fixture';
import { createRoleAuditFixture } from './fixtures/role-audit.mjs';
import {login} from './page-objects/login.page';

// Real, isolated accounts. No actingAs, shared production users or external bots.
const homes={ADMIN:'/admin',DISPATCHER:'/admin',OPERATOR:'/operator',ASSISTANT:'/assistant',MECHANIC:'/admin/to',FOREMAN:'/admin',SAFETY_ENGINEER:'/admin/to'};
test.describe('seven real roles',()=>{
 test.describe.configure({mode:'default'});
 let fixture;
 test.beforeAll(async()=>{fixture=await createRoleAuditFixture()});
 for(const [role,home] of Object.entries(homes))test(role+' login, permissions and mobile layout',async({page},info)=>{
  if(role==='OPERATOR'||role==='ASSISTANT')test.setTimeout(90000);
  // Forced document navigation cancels WebKit prefetches. Let finite requests
  // finish first; SSE stays open and is intentionally excluded from this wait.
  const pending=new Set();let lastRequest=Date.now();
  page.on('request',r=>{if(!r.url().includes('/api/feedback/stream')){pending.add(r);lastRequest=Date.now()}});
  const finished=r=>{if(pending.delete(r))lastRequest=Date.now()};
  page.on('requestfinished',finished);page.on('requestfailed',finished);
  const settled=async()=>{if(info.project.name==='Mobile Safari')await expect.poll(()=>pending.size===0&&Date.now()-lastRequest>=500,{timeout:15000}).toBe(true);};
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);void info.attach('page-error',{body:e.stack||e.message,contentType:'text/plain'});});
  page.on('requestfailed',r=>{const u=new URL(r.url());void info.attach('request-failed',{body:JSON.stringify({url:u.origin+u.pathname,error:r.failure()?.errorText}),contentType:'application/json'});});
  page.on('response',async response=>{if(response.status()>=400&&response.url().includes('/api/'))await info.attach('api-error',{body:JSON.stringify({url:response.url(),status:response.status(),body:await response.text().catch(()=>'<unavailable>')}),contentType:'application/json'}).catch(()=>{});});
  await page.setViewportSize({width:1280,height:900});
  await login(page,fixture.users[role].email,fixture.password);
  await expect(page).toHaveURL(new RegExp(home+'$'));
  await expect(page.getByText('QA '+role,{exact:true}).first()).toBeVisible();
  await settled();
  await page.goto('/admin/users');
  if(role==='ADMIN'){await expect(page).toHaveURL(/\/admin\/users$/);await expect(page.getByText('QA OPERATOR',{exact:true}).first()).toBeVisible()}
  else await expect(page).toHaveURL(new RegExp(home+'$'));
  await settled();
  if(role==='ADMIN')await page.goto(home);
  if(role==='OPERATOR'||role==='ASSISTANT'){
   if(role==='OPERATOR'){
    await page.getByRole('button',{name:'Проверить средства защиты',exact:true}).click();
    const [ppe]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/operator/mobile/command')),page.getByRole('button',{name:'Комплект в порядке',exact:true}).click()]);
    expect(ppe.status()).toBe(200);
   }
   await page.getByRole('button',{name:role==='OPERATOR'?'Прочитать инструкцию':'Пройти инструктаж',exact:true}).click();
   await page.getByRole('button',{name:'Прочитал и ознакомлен',exact:true}).click();
   const [response]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/operator/knowledge-attempt')),page.getByRole('button',{name:role==='OPERATOR'?'Пройти проверку знаний':'Пройти проверку',exact:true}).click()]);
   expect(response.ok()).toBe(true);const attempt=(await response.json()).data;expect(attempt.questions).toHaveLength(8);
   for(const q of attempt.questions){
    const question=page.getByText(q.text,{exact:true});
    await expect(question).toBeVisible();
    await page.getByRole('button',{name:q.options[q.correct],exact:true}).click();
    const next=page.getByRole('button',{name:'Верно, дальше',exact:true});
    await expect(next).toBeEnabled();await next.click();
    await expect(question).toBeHidden();
   }
   const [saved]=await Promise.all([page.waitForResponse(r=>r.url().includes(role==='OPERATOR'?'/api/operator/mobile/command':'/api/assistant/command')),page.getByRole('button',{name:'Записать результат',exact:true}).click()]);
   expect(saved.ok()).toBe(true);expect((await saved.json()).data.correct).toBe(8);await settled();await page.reload();
   await expect(page.getByText(role==='OPERATOR'?'Приём установки':'Допуск в порядке',{exact:true})).toBeVisible();
  }else if(role==='MECHANIC'||role==='SAFETY_ENGINEER')await expect(page.getByText('Чек-лист смены (5 шагов)',{exact:true})).toBeVisible();
  else await expect(page.getByRole('heading',{name:'Дашборд',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath(role+'-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  await page.screenshot({path:info.outputPath(role+'-mobile.png'),fullPage:true});expect(errors).toEqual([]);
 });
 test('monitoring and analytics expose failed refresh and recover',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await login(page,fixture.users.ADMIN.email,fixture.password);
  await page.goto('/monitoring');
  const heading=page.getByRole('heading',{name:'Аналитика по установкам',exact:true});
  await expect(heading).toBeVisible();
  const analytics=heading.locator('xpath=../../..');
  await expect(analytics.locator('table')).toBeVisible();
  await expect(page.getByTestId('equipment-tile').first()).toBeVisible();
  await page.route('**/api/monitoring/fleet*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"QA unavailable"}'}));
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/monitoring/fleet')&&r.status()===503),page.evaluate(()=>window.dispatchEvent(new Event('online')))]);
  const stale=page.getByRole('alert').filter({hasText:'Показан предыдущий снимок'});
  await expect(stale).toBeVisible();
  await page.unroute('**/api/monitoring/fleet*');
  await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await expect(stale).toBeHidden();
  await page.route('**/api/admin/equipment-analytics*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"QA unavailable"}'}));
  await analytics.getByRole('button',{name:'Сегодня',exact:true}).click();
  await expect(analytics.getByText('Сервер вернул 503',{exact:true})).toBeVisible();
  await expect(analytics.locator('table')).toHaveCount(0);
  await page.unroute('**/api/admin/equipment-analytics*');
  await analytics.getByRole('button',{name:'7 дней',exact:true}).click();
  await expect(analytics.locator('table')).toBeVisible();
  await expect(analytics.getByText('Сервер вернул 503',{exact:true})).toBeHidden();
 });
});
