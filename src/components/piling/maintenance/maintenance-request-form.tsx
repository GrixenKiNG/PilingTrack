'use client';

/**
 * Создание заявки на обслуживание — страница вместо прежней ссылки в никуда.
 *
 * Кнопка «+ Создать заявку» на вкладке «Обслуживание» была `<Link>` на доску
 * нарядов: страница менялась, формы не появлялось, заявка не создавалась.
 * Заявка заводилась совсем другой кнопкой с другим названием («Задача ТО»),
 * найти которую по подписи было невозможно.
 *
 * Поля — только те, что модель умеет хранить. Полей из макета, которым нет
 * места в `MaintenanceRecord` (местоположение, вложения), здесь нет: поле,
 * которое собирает данные и молча их теряет, хуже отсутствующего.
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  CreationForm, FormSection, FormLabel, TilePicker, CharCount, type TileOption,
} from '@/components/piling/forms/creation-form';
import type { MaintenanceType, MaintenancePriority } from './maintenance-labels';

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 500;

/**
 * Типы заявки словами заказчика работ, а не кодами наряда.
 *
 * В `MaintenanceType` девять значений, но заводя заявку человек различает
 * четыре случая. Остальные пять (ЕО, ТО-1/2/3, сезонное) ставит план-график, а
 * не рука: предлагать их здесь — значит звать завести регламент вручную мимо
 * плана.
 */
const REQUEST_TYPES: TileOption<MaintenanceType>[] = [
  { value: 'SCHEDULED', label: 'Техническое обслуживание', hint: 'Плановое ТО и регламентные работы' },
  { value: 'REPAIR', label: 'Ремонт', hint: 'Устранение неисправностей' },
  { value: 'INSPECTION', label: 'Диагностика', hint: 'Выявление причин неисправности' },
  { value: 'FAULT', label: 'Неисправность', hint: 'Машина неисправна, нужен разбор' },
];

const PRIORITIES: TileOption<MaintenancePriority>[] = [
  { value: 'CRITICAL', label: 'Критичный', hint: 'Требует срочного вмешательства', tone: 'danger' },
  { value: 'HIGH', label: 'Высокий', hint: 'Важный, но не критичный', tone: 'warning' },
  { value: 'NORMAL', label: 'Обычный', hint: 'Плановые работы' },
  { value: 'LOW', label: 'Низкий', hint: 'Можно отложить' },
];

interface EquipmentOption {
  id: string;
  name: string;
  model: string | null;
  engineHoursTotal: number | null;
}

interface AssigneeOption { id: string; name: string }

const UNASSIGNED = '__none__';

export function MaintenanceRequestForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  // Установка может прийти в адресе — из карточки машины заявку заводят на неё.
  const [equipmentId, setEquipmentId] = useState(params.get('equipmentId') ?? '');
  const [type, setType] = useState<MaintenanceType>('SCHEDULED');
  const [priority, setPriority] = useState<MaintenancePriority>('NORMAL');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [equipmentRes, assigneeRes] = await Promise.all([
        authFetch('/api/equipment?limit=100'),
        authFetch('/api/maintenance/assignees'),
      ]);
      if (cancelled) return;
      if (equipmentRes.ok) setEquipment(((await equipmentRes.json()).data ?? []) as EquipmentOption[]);
      if (assigneeRes.ok) setAssignees(((await assigneeRes.json()).users ?? []) as AssigneeOption[]);
    })();
    return () => { cancelled = true; };
  }, []);

  const selected = equipment.find((item) => item.id === equipmentId) ?? null;

  const submit = async () => {
    // Проверяем до отправки и называем первое незаполненное: список из трёх
    // ошибок разом человек всё равно исправляет по одной.
    if (!equipmentId) return toast.error('Выберите установку');
    if (!title.trim()) return toast.error('Заполните краткое описание');
    if (title.length > TITLE_MAX) return toast.error('Краткое описание длиннее допустимого');
    if (description.length > DESCRIPTION_MAX) return toast.error('Подробное описание длиннее допустимого');

    setBusy(true);
    try {
      const response = await authFetch(`/api/equipment/${equipmentId}/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          status: 'PLANNED',
          priority,
          title: title.trim(),
          description: description.trim(),
          assigneeId: assigneeId || null,
          scheduledAt: scheduledAt || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Не удалось создать заявку');
      }
      toast.success('Заявка создана');
      // Возвращаем на доску, а не на созданную запись: заявку заводят одну за
      // другой, и чаще нужен список, чем только что заполненная карточка.
      router.push('/admin/maintenance');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать заявку');
    } finally {
      setBusy(false);
    }
  };

  return (
    <CreationForm
      title="Создание заявки"
      subtitle="Заявка на техническое обслуживание или ремонт"
      backHref="/admin/maintenance"
      submitLabel="Создать заявку"
      onSubmit={() => void submit()}
      busy={busy}
    >
      <FormSection title="Тип заявки">
        <TilePicker name="Тип заявки" value={type} options={REQUEST_TYPES} onChange={setType} />
      </FormSection>

      <FormSection title="Оборудование">
        <div>
          <FormLabel htmlFor="request-equipment" required>Установка</FormLabel>
          <Select value={equipmentId} onValueChange={setEquipmentId}>
            <SelectTrigger id="request-equipment" className="h-11 w-full">
              <SelectValue placeholder="Выберите установку" />
            </SelectTrigger>
            <SelectContent>
              {equipment.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/*
            Вместо поля «Местоположение» из макета — то, что действительно
            известно о машине. Объект в списке установок не приходит, и
            рисовать пустую строку с подписью «Местоположение» значило бы
            обещать данные, которых нет.
          */}
          {selected && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {selected.model ?? 'модель не указана'}
              {selected.engineHoursTotal != null && ` · наработка ${selected.engineHoursTotal} м.ч.`}
            </p>
          )}
        </div>
      </FormSection>

      <FormSection title="Описание заявки">
        <div>
          <FormLabel htmlFor="request-title" required>Краткое описание</FormLabel>
          <Input
            id="request-title"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например: Плановое ТО 500 м/ч"
            className="h-11"
          />
          <CharCount value={title} max={TITLE_MAX} />
        </div>
        <div>
          <FormLabel htmlFor="request-description">Подробное описание</FormLabel>
          <Textarea
            id="request-description"
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Опишите детали работ, симптомы, замечания…"
            rows={4}
          />
          <CharCount value={description} max={DESCRIPTION_MAX} />
        </div>
      </FormSection>

      <FormSection title="Приоритет и сроки">
        <TilePicker name="Приоритет" value={priority} options={PRIORITIES} onChange={setPriority} />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <FormLabel htmlFor="request-date">Желаемая дата выполнения</FormLabel>
            <Input
              id="request-date"
              type="date"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              className="h-11"
            />
          </div>
          <div>
            <FormLabel htmlFor="request-assignee">Исполнитель</FormLabel>
            <Select
              value={assigneeId || UNASSIGNED}
              onValueChange={(value) => setAssigneeId(value === UNASSIGNED ? '' : value)}
            >
              <SelectTrigger id="request-assignee" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>— не назначен —</SelectItem>
                {assignees.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FormSection>
    </CreationForm>
  );
}
