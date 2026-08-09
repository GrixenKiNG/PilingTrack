'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, Link2, Radio, Send } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ReadinessBootstrap } from '../api/contracts';
import { InfoRow, ScreenTitle, SettingsKpis, StatusPill, card } from './shared-ui';

interface TelematicsDevice {
  id: string;
  label: string;
  provider: string;
  status: string;
  lastSeenAt?: string | null;
}

interface IntegrationsSettingsProps {
  devices: TelematicsDevice[];
  bootstrap: ReadinessBootstrap | null;
}

const DEVICE_STATUS_LABEL: Record<string, string> = {
  ONLINE: 'На связи',
  ACTIVE: 'На связи',
  OFFLINE: 'Нет связи',
  INACTIVE: 'Отключено',
};

export function IntegrationsSettings({ devices, bootstrap }: IntegrationsSettingsProps) {
  const [telegramCount, setTelegramCount] = useState<number | null>(null);

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

  const online = devices.filter((device) => device.status === 'ONLINE' || device.status === 'ACTIVE');
  const telegramReady = (telegramCount ?? 0) > 0;

  /**
   * Перечисляем только системы, которые в контуре действительно есть. Макет
   * показывает шесть карточек (1С:ТОИР, SMTP, вебхуки заказчика), но их
   * подключений нет — рисовать их значило бы обещать обмен, которого нет.
   */
  const systems = [
    {
      key: 'telematics',
      name: 'Телематика',
      description: devices.length > 0 ? `${devices[0]?.provider ?? 'GPS/CAN'} · моточасы и координаты` : 'GPS/CAN · моточасы и координаты',
      icon: Radio,
      ready: online.length > 0,
      status: devices.length === 0 ? 'Устройства не зарегистрированы' : online.length > 0 ? `На связи ${online.length} из ${devices.length}` : 'Нет связи',
      href: '/admin/equipment',
      action: 'Оборудование',
    },
    {
      key: 'telegram',
      name: 'Telegram',
      description: 'Уведомления и команды',
      icon: Send,
      ready: telegramReady,
      status: telegramCount == null ? 'Проверяем подключение…' : telegramReady ? `Конфигураций: ${telegramCount}` : 'Бот не настроен',
      href: '/admin/telegram',
      action: 'Настроить',
    },
  ];

  return (
    <>
      <ScreenTitle
        heading="Интеграции"
        subtitle="Обмен с телематикой и внешними каналами"
        actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/settings">Системные настройки</Link></Button>}
      />
      <SettingsKpis items={[
        { icon: 'settings', label: 'Подключено систем', value: telegramCount == null ? '…' : systems.filter((system) => system.ready).length },
        { icon: 'equipment-rig', label: 'Устройств телематики', value: devices.length },
        { icon: 'accepted', label: 'На связи', value: online.length },
        { icon: 'risk', label: 'Требуют настройки', value: telegramCount == null ? '…' : systems.filter((system) => !system.ready).length, alert: systems.some((system) => !system.ready) },
      ]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className={cn(card, 'p-4')}>
          <h2 className="font-bold">Подключённые системы</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {systems.map((system) => {
              const Icon = system.icon;
              return (
                <article key={system.key} className={cn('flex flex-col gap-3 rounded-xl border p-3', system.ready ? 'border-border' : 'border-warning/30 bg-warning/5')}>
                  <div className="flex items-start gap-3">
                    <span className={cn('grid h-11 w-14 shrink-0 place-items-center rounded-lg', system.ready ? 'bg-success/10 text-success-strong' : 'bg-muted text-muted-foreground')}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="min-w-0 truncate text-xs font-bold">{system.name}</h3>
                        <StatusPill tone={system.ready ? 'success' : 'warning'}>{system.ready ? 'Работает' : 'Не настроено'}</StatusPill>
                      </div>
                      <p className="mt-0.5 text-3xs text-muted-foreground">{system.description}</p>
                      <p className="mt-1 text-2xs">{system.status}</p>
                    </div>
                  </div>
                  <Button asChild variant="outline" className="mt-auto w-full"><Link href={system.href}>{system.action}</Link></Button>
                </article>
              );
            })}
          </div>
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-border p-3 text-2xs leading-relaxed text-muted-foreground">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
            Других внешних систем к контуру не подключено. Обмен с учётными системами и вебхуки заказчика не настроены.
          </p>
        </section>

        <aside className="space-y-3">
          <section className={cn(card, 'overflow-hidden')}>
            <div className="flex items-center justify-between gap-2 border-b border-border p-4">
              <h2 className="font-bold">Устройства телематики</h2>
              <StatusPill tone={online.length > 0 ? 'success' : 'neutral'}>{online.length > 0 ? 'Онлайн' : 'Нет данных'}</StatusPill>
            </div>
            <div className="divide-y divide-border">
              {devices.map((device) => (
                <div key={device.id} className="space-y-2 p-4 text-xs">
                  <div className="flex items-center gap-2">
                    <b className="min-w-0 flex-1 truncate">{device.label}</b>
                    <StatusPill tone={online.includes(device) ? 'success' : 'neutral'}>{DEVICE_STATUS_LABEL[device.status] ?? device.status}</StatusPill>
                  </div>
                  <InfoRow label="Поставщик" value={device.provider} />
                  <InfoRow label="Последний сеанс" value={device.lastSeenAt ? formatDateTimeInTimezone(device.lastSeenAt, bootstrap?.tenant.timezone) : 'сеансов не было'} />
                </div>
              ))}
              {devices.length === 0 && (
                <p className="flex items-start gap-2 p-4 text-xs leading-relaxed text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
                  Устройства не зарегистрированы. Пока их нет, моточасы вводятся вручную оператором.
                </p>
              )}
            </div>
          </section>
          <section className={cn(card, 'p-4')}>
            <h2 className="font-bold">Часовой пояс контура</h2>
            <p className="mt-2 font-mono text-sm font-bold">{bootstrap?.tenant.timezone ?? 'Europe/Moscow'}</p>
            <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">В этом поясе считаются производственные сутки, сроки нарядов и графики смен.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
