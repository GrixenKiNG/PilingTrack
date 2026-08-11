'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Bell, ChevronRight, Clock, Wrench } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  NOTIFICATION_KEYS,
  type WorkspaceSettings,
} from '@/modules/settings/domain/settings';
import { ScreenTitle, SettingsKpis, StatusPill, Toggle, card } from './shared-ui';

/**
 * Маршруты уведомлений — по фактическим отправителям, а не по макету.
 *
 * В контуре ровно два места, которые что-то шлют (`services/reports/
 * event-handlers.ts`): предупреждение о простое и PDF сменного отчёта. Два
 * оставшихся правила настройка хранит, но отправителя у них нет.
 *
 * Раньше здесь стояли выдуманные пороги и получатели: строка обещала простой
 * «более 30 минут», хотя предупреждение срабатывает от 2 часов, а колонка
 * «Получатели» перечисляла роли — доставка идёт в настроенные Telegram-чаты и
 * ролей не знает вовсе.
 */
const RULES = [
  {
    key: 'downtime30',
    event: 'Простой в сменном отчёте',
    threshold: 'дольше 2 ч · от 4 ч важность выше',
    implemented: true,
    icon: Clock,
  },
  {
    key: 'newReports',
    event: 'Сменный отчёт отправлен',
    threshold: 'PDF отчёта в чат',
    implemented: true,
    icon: Bell,
  },
  {
    key: 'planDeviation',
    event: 'Отклонение от производственного плана',
    threshold: 'порог не задан',
    implemented: false,
    icon: AlertTriangle,
  },
  {
    key: 'maintenanceOverdue',
    event: 'Просроченное техническое обслуживание',
    threshold: 'порог не задан',
    implemented: false,
    icon: Wrench,
  },
] as const;

interface NotificationsSettingsProps {
  isAdmin: boolean;
}

export function NotificationsSettings({ isAdmin }: NotificationsSettingsProps) {
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_WORKSPACE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [telegramCount, setTelegramCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void authFetch('/api/settings')
      .then(async (response) => {
        if (!response.ok) throw new Error('settings');
        const body = await response.json() as WorkspaceSettings;
        if (active) setSettings(body);
      })
      .catch(() => active && toast.error('Не удалось загрузить настройки уведомлений'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void authFetch('/api/telegram/configs')
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as { configs?: unknown[] };
        if (active) setTelegramCount(Array.isArray(body.configs) ? body.configs.length : 0);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const toggleRule = async (key: string) => {
    if (!isAdmin || savingKey) return;
    const previous = settings;
    const next = { ...settings, notifications: { ...settings.notifications, [key]: !settings.notifications[key] } };
    setSettings(next);
    setSavingKey(key);
    const response = await authFetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => null);
    if (!response?.ok) {
      setSettings(previous);
      toast.error('Настройка не сохранена');
    } else {
      setSettings(await response.json() as WorkspaceSettings);
      toast.success('Правило уведомления сохранено');
    }
    setSavingKey(null);
  };

  const activeRules = Object.values(settings.notifications).filter(Boolean).length;
  const implementedRules = RULES.filter((rule) => rule.implemented).length;
  const telegramReady = (telegramCount ?? 0) > 0;

  // Каналы перечисляем по факту подключения, а не по макету: почта и SMS
  // в контуре не настроены, и обещать доставку по ним нельзя.
  const channels = [
    { name: 'Telegram', detail: telegramCount == null ? 'проверяем' : telegramReady ? `конфигураций: ${telegramCount}` : 'бот не настроен', ready: telegramReady, href: '/admin/telegram' },
    { name: 'Электронная почта', detail: 'SMTP не подключён', ready: false, href: '/admin/settings' },
    { name: 'Push в браузере', detail: 'не подключено', ready: false, href: '/admin/settings' },
    { name: 'SMS', detail: 'не подключено', ready: false, href: '/admin/settings' },
  ];

  return (
    <>
      <ScreenTitle
        heading="Уведомления"
        subtitle="Маршруты событий, отправители и каналы доставки"
        actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/telegram">Настроить Telegram</Link></Button>}
      />
      <SettingsKpis items={[
        { icon: 'settings', label: 'Правил', value: NOTIFICATION_KEYS.length },
        {
          icon: 'accepted',
          label: 'С отправителем',
          value: `${implementedRules} из ${RULES.length}`,
          detail: loading ? undefined : `признак включён у ${activeRules}`,
        },
        { icon: 'notifications', label: 'Каналов подключено', value: telegramCount == null ? '…' : channels.filter((channel) => channel.ready).length },
        { icon: 'risk', label: 'Каналов не настроено', value: telegramCount == null ? '…' : channels.filter((channel) => !channel.ready).length, alert: channels.some((channel) => !channel.ready) },
      ]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <section className={cn(card, 'overflow-hidden')}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
              <div>
                <h2 className="font-bold">Маршрутизация событий</h2>
                <p className="mt-1 text-2xs text-muted-foreground">{isAdmin ? 'Изменения сохраняются в настройках организации.' : 'Изменять правила может только администратор.'}</p>
              </div>
              <Button asChild variant="outline"><Link href="/admin/telegram">Журнал доставки</Link></Button>
            </div>
            <div className="overflow-x-auto">
              <div className="grid min-w-[720px] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_110px_50px] gap-2 border-b border-border px-4 py-2 text-3xs font-semibold uppercase text-muted-foreground">
                <span>Событие</span><span>Когда срабатывает</span><span>Отправитель</span><span>Канал</span><span className="text-right">Признак</span>
              </div>
              {RULES.map((rule) => {
                const Icon = rule.icon;
                return (
                  <div key={rule.key} className="grid min-w-[720px] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_110px_50px] items-center gap-2 border-b border-border px-4 py-2 text-2xs last:border-b-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className={cn('h-4 w-4 shrink-0', rule.implemented ? 'text-muted-foreground' : 'text-warning-strong')} />
                      <span className="min-w-0 leading-snug">{rule.event}</span>
                    </span>
                    <span className="min-w-0 truncate text-muted-foreground">{rule.threshold}</span>
                    <span>
                      <StatusPill tone={rule.implemented ? 'success' : 'warning'}>
                        {rule.implemented ? 'Работает' : 'Не реализован'}
                      </StatusPill>
                    </span>
                    <span className={rule.implemented && telegramReady ? 'text-muted-foreground' : 'text-warning-strong'}>
                      {rule.implemented ? 'Telegram' : '—'}
                    </span>
                    <span className="flex justify-end">
                      <Toggle
                        checked={settings.notifications[rule.key] ?? false}
                        disabled={loading || !isAdmin || savingKey !== null}
                        label={rule.event}
                        onChange={() => void toggleRule(rule.key)}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="flex items-start gap-2 border-t border-border bg-warning/10 p-3 text-2xs font-semibold leading-relaxed text-warning-strong">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Признак сохраняется в настройках организации, но отправка его пока не проверяет:
              включённое и выключенное правило ведут себя одинаково.
              {!telegramReady && telegramCount != null && ' Канал доставки при этом не настроен — не уходит ничего.'}
            </p>
          </section>

          <section className={cn(card, 'p-4')}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">Последние доставки</h2>
              <Link href="/admin/telegram" className="flex items-center gap-1 text-2xs font-semibold text-signal-strong hover:underline">Журнал доставки <ChevronRight className="h-3 w-3" /></Link>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Модуль не ведёт собственный журнал отправок: история доставки хранится на стороне Telegram-интеграции.
            </p>
          </section>
        </div>

        <aside className="space-y-3">
          <section className={cn(card, 'overflow-hidden')}>
            <div className="border-b border-border p-4"><h2 className="font-bold">Каналы доставки</h2></div>
            <div className="divide-y divide-border">
              {channels.map((channel) => (
                <Link key={channel.name} href={channel.href} className="flex min-h-14 items-center gap-3 px-4 py-2 text-xs hover:bg-signal/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal">
                  <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', channel.ready ? 'bg-success-strong' : 'bg-border')} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{channel.name}</span>
                    <span className="block text-3xs text-muted-foreground">{channel.detail}</span>
                  </span>
                  <StatusPill tone={channel.ready ? 'success' : 'neutral'}>{channel.ready ? 'Включён' : 'Не настроен'}</StatusPill>
                </Link>
              ))}
            </div>
          </section>
          <section className={cn(card, 'p-4')}>
            <h2 className="font-bold">Тихие часы</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Не настроены: уведомления уходят круглосуточно. Ограничение по времени суток в контуре пока не реализовано.
            </p>
          </section>
          <section className={cn(card, 'p-4')}>
            <h2 className="font-bold">Повторная отправка</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Событие отправляется один раз. Эскалации на следующего получателя при отсутствии подтверждения нет.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
