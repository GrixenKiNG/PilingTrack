'use client';

/**
 * Редактор плитки установки на своём месте — в «Настройки → Шаблоны плиток».
 *
 * Раньше редактор жил на экране мониторинга: плавающая кнопка в углу,
 * появлявшаяся только после `?design=1`, а в настройках стояла ссылка,
 * уводившая туда же. Настройка внешнего вида — работа администратора, а не
 * то, что должно попадаться под руку диспетчеру, следящему за сменой.
 *
 * Список установок нужен редактору для двух вещей: показать предпросмотр на
 * настоящей карточке и знать, к какой установке привязать загружаемое фото.
 * Поэтому компонент сам забирает снимок парка — на экране мониторинга его
 * больше нет, откуда взять список.
 */

import { useCallback, useEffect, useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import type { FleetCard, FleetSnapshot } from '@/components/piling/admin-equipment/fleet-types';
import { EquipmentTileEditor } from './equipment-tile-editor';
import { useEquipmentTileTemplate } from './use-equipment-tile-template';

export function EquipmentTileTemplateSettings() {
  const [cards, setCards] = useState<FleetCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/monitoring/fleet?_ts=${Date.now()}`);
      if (!res.ok) {
        setError('Не удалось получить список установок.');
        return;
      }
      const data: FleetSnapshot = await res.json();
      setCards(data.equipment);
      setError(null);
    } catch {
      setError('Нет соединения с сервисом мониторинга.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка при монтировании; состояние выставляет асинхронный загрузчик (тот же приём, что в fleet-dashboard)
    void load();
  }, [load]);

  // После загрузки фото карточка обновляется, чтобы предпросмотр показал
  // новый снимок, а не старый.
  const controller = useEquipmentTileTemplate(undefined, () => void load());

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!cards) {
    return <p className="text-sm text-muted-foreground">Загружаем список установок…</p>;
  }

  if (cards.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Пока нет ни одной установки — редактировать плитку не на чем.
      </p>
    );
  }

  return (
    <>
      <Button variant="outline" className="w-full justify-start" onClick={() => setOpen(true)}>
        <LayoutTemplate className="mr-2 h-4 w-4" />
        Открыть редактор плиток
      </Button>
      {open && (
        <EquipmentTileEditor
          cards={cards}
          controller={controller}
          autoOpen
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
