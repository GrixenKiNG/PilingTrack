(() => {
  'use strict';

  const id = 114223779;
  const storageKey = 'orion.analytics';
  const disableKey = 'disableYaCounter' + id;
  const onPublicDomain = ['orionpiling.ru', 'www.orionpiling.ru'].includes(location.hostname);
  const goal = (name) => {
    if (window[disableKey] !== false) return;
    try { window.ym(id, 'reachGoal', name); } catch { /* Analytics must not interrupt the site. */ }
  };
  window.orionMetric = goal;
  window[disableKey] = true;

  function readChoice() {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  }

  function start() {
    if (!onPublicDomain || window[disableKey] === false) return;
    window[disableKey] = false;
    const ym = window.ym = window.ym || function () {
      (ym.a = ym.a || []).push(arguments);
    };
    ym.l = Date.now();
    ym(id, 'init', {
      ssr: true, clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false,
    });
    const tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://mc.yandex.ru/metrika/tag.js?id=' + id;
    document.head.append(tag);
  }

  const panel = document.createElement('aside');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Настройки аналитических cookies');
  panel.style.cssText = 'position:fixed;z-index:40;right:12px;bottom:12px;max-width:380px;width:calc(100% - 24px);box-sizing:border-box;padding:16px;border:1px solid #c4c8c1;border-radius:8px;background:#fff;color:#202521;box-shadow:0 8px 24px #0003;font:15px/1.45 system-ui,sans-serif';
  panel.innerHTML = '<p style="margin:0 0 12px">С вашего разрешения используем cookies Яндекс Метрики, чтобы понимать, какие страницы и услуги полезны посетителям. <a href="https://yandex.ru/legal/confidential/" style="color:#344e45;text-decoration:underline">Политика Яндекса</a></p><div style="display:flex;gap:8px;flex-wrap:wrap"></div>';
  const controls = panel.lastElementChild;
  const settings = document.createElement('button');
  settings.type = 'button';
  settings.textContent = 'Настройки cookies';
  settings.style.cssText = 'margin:8px 0;padding:6px 10px;font:inherit;color:#202521;background:#fff;border:1px solid #878d86;border-radius:4px;cursor:pointer';
  const footer = document.querySelector('footer');
  if (footer) footer.append(settings);
  else {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:12px;text-align:center';
    wrap.append(settings);
    document.body.append(wrap);
  }
  document.body.append(panel);

  function choose(allowed) {
    try { localStorage.setItem(storageKey, allowed ? 'yes' : 'no'); } catch { /* Storage is optional. */ }
    panel.hidden = true;
    if (allowed) start();
    else if (window[disableKey] === false) {
      window[disableKey] = true;
      if (readChoice() === 'no') location.reload();
    }
    if (document.activeElement && panel.contains(document.activeElement)) settings.focus({ preventScroll: true });
  }

  for (const [text, allowed] of [['Разрешить аналитику', true], ['Без аналитики', false]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cssText = 'padding:7px 10px;font:inherit;border:1px solid #535c56;border-radius:4px;cursor:pointer;' +
      (allowed ? 'color:#fff;background:#344e45' : 'color:#202521;background:#fff');
    button.addEventListener('click', () => choose(allowed));
    controls.append(button);
  }
  settings.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) controls.firstElementChild.focus({ preventScroll: true });
  });
  const choice = readChoice();
  if (choice === 'yes') start();
  else if (choice !== 'no') panel.hidden = false;

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (link?.protocol === 'tel:') goal('orion_phone_click');
    else if (link?.protocol === 'mailto:') goal('orion_email_click');
    else if (link?.origin === location.origin && link.pathname === '/orion/site/shift-report.html') goal('orion_report_open');
    else if (event.target.closest('.machine')) goal('orion_equipment_open');
  });
})();
