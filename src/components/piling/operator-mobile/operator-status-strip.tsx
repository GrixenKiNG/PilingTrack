'use client';

import {CircleAlert, CloudCheck, WifiOff} from 'lucide-react';
import {cn} from '@/lib/utils';
import type {QueuedCommand} from './offline-queue';

/** Постоянный и честный статус доставки данных смены. */
export function OperatorStatusStrip({online, items}: {online: boolean; items: QueuedCommand[]}) {
  const failed = items.filter((item) => item.state === 'FAILED').length;
  const pending = items.filter((item) => item.state === 'PENDING').length;
  const view = failed > 0
    ? {
        icon: CircleAlert,
        title: `Нужно проверить: ${failed}`,
        detail: 'Сервер отклонил запись — причина показана ниже',
        tone: 'danger' as const,
      }
    : !online
      ? {
          icon: WifiOff,
          title: 'Офлайн',
          detail: pending > 0
            ? `На устройстве ждёт отправки: ${pending}`
            : 'Выработка и события сохранятся на устройстве',
          tone: 'warning' as const,
        }
      : pending > 0
        ? {
            icon: CloudCheck,
            title: `Ожидает отправки: ${pending}`,
            detail: 'Передадим автоматически, как только сервер ответит',
            tone: 'warning' as const,
          }
        : {
            icon: CloudCheck,
            title: 'Синхронизировано',
            detail: 'Сервер доступен · на устройстве нет очереди',
            tone: 'ok' as const,
          };

  const Icon = view.icon;

  /*
    «Всё хорошо» — одна строка, а не карточка в полсотни точек.

    Строка обязана быть всегда: без неё автономная работа неотличима от потери
    данных. Но сообщение «Синхронизировано · на устройстве нет очереди» — это
    сообщение об ОТСУТСТВИИ события, и занимать под него высоту наравне с
    настоящей тревогой неправильно: место нужно тому, что требует действия.
    Как только появляется очередь, отказ или пропадает связь — строка
    разворачивается в прежнюю карточку с пояснением.
  */
  if (view.tone === 'ok') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="operator-status-strip mx-4 mt-1 flex items-center gap-1.5 text-3xs font-semibold text-success-strong"
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{view.title}</span>
        <span className="truncate font-normal text-muted-foreground">· {view.detail}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'operator-status-strip mx-3 mt-2 flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 shadow-xs',
        view.tone === 'warning' && 'border-warning/45 bg-warning/10',
        view.tone === 'danger' && 'border-destructive/40 bg-destructive/8',
      )}
    >
      <span className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg',
        view.tone === 'warning' && 'bg-warning/20 text-warning-strong',
        view.tone === 'danger' && 'bg-destructive/15 text-destructive',
      )}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold leading-tight">{view.title}</span>
        <span className="mt-0.5 block text-3xs leading-tight text-muted-foreground">{view.detail}</span>
      </span>
    </div>
  );
}
