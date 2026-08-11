'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Camera,
  ChevronRight,
  ClipboardCheck,
  Search,
} from '@/components/piling/icons/unified-icons';
import {
  DoneControl,
  MeasureControl,
  Status4Control,
  YesNoControl,
} from '@/components/piling/inspections/inspection-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/lib/api';
import { pluralizeRu } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TYPE_LABEL } from '../../to-module-bits';
import { ScreenTitle, SettingsKpis, StatusPill, card } from './shared-ui';

export interface ChecklistTemplateSummary {
  id: string;
  name: string;
  level: string;
  blockType?: string | null;
  isActive?: boolean;
  sectionCount?: number;
  itemCount?: number;
  updatedAt?: string;
}

interface TemplateItem {
  id: string;
  text: string;
  answerType: string;
  unit?: string | null;
  norm?: string | null;
  required: boolean;
  photoRequired: boolean;
}

interface TemplateDetail {
  id: string;
  name: string;
  level: string;
  blockType?: string | null;
  sections: Array<{ id: string; title: string; items: TemplateItem[] }>;
}

/** Подписи типов ответа — в интерфейсе оператора они на русском. */
const ANSWER_TYPE_LABEL: Record<string, string> = {
  YES_NO: 'Да / Нет',
  STATUS4: 'Четыре состояния',
  DONE: 'Выполнено',
  MEASURE: 'Измерение',
};

const BLOCK_LABEL: Record<string, string> = {
  BASE: 'Базовый',
  HAMMER: 'Молот',
  ROTARY: 'Вращатель',
};

/**
 * Предпросмотр пункта глазами оператора.
 *
 * Контролы ответа берём те же, что стоят в окне осмотра
 * (`inspections/inspection-controls`), а не рисуем похожие: иначе предпросмотр
 * начнёт расходиться с настоящим экраном при первой же правке контролов, и
 * администратор будет проверять шаблон по картинке, которой нет в работе.
 */
function OperatorPreview({
  item,
  sectionTitle,
  position,
  total,
}: {
  item: TemplateItem;
  sectionTitle: string;
  position: number;
  total: number;
}) {
  const [value, setValue] = useState('');

  return (
    <div className="mx-auto w-full max-w-[280px] rounded-[20px] border-[6px] border-primary bg-background p-3 shadow-sm">
      <div className="flex items-center justify-between text-3xs text-muted-foreground">
        <span className="font-mono">9:41</span>
        <span>{position} из {total}</span>
      </div>
      <div className="mt-2 rounded-lg border border-border p-3">
        <div className="text-3xs font-semibold uppercase text-muted-foreground">{sectionTitle}</div>
        <p className="mt-1.5 text-xs font-semibold leading-snug text-foreground">
          {position}. {item.text}
          {item.required && <span className="ml-1 text-destructive-strong">*</span>}
        </p>
        <div className="mt-3">
          {item.answerType === 'YES_NO' && <YesNoControl value={value} onChange={setValue} disabled={false} />}
          {item.answerType === 'STATUS4' && <Status4Control value={value} onChange={setValue} disabled={false} />}
          {item.answerType === 'DONE' && <DoneControl value={value} onChange={setValue} disabled={false} />}
          {item.answerType === 'MEASURE' && (
            <MeasureControl value={value} onChange={setValue} unit={item.unit ?? null} norm={item.norm ?? null} disabled={false} />
          )}
        </div>
        {item.photoRequired && (
          <div className="mt-3 grid min-h-[64px] place-items-center rounded-lg border border-dashed border-border text-3xs text-muted-foreground">
            <Camera className="h-5 w-5" />
            Фото обязательно
          </div>
        )}
      </div>
    </div>
  );
}

export function ChecklistsSettings() {
  const [templates, setTemplates] = useState<ChecklistTemplateSummary[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  // Держим ответ вместе с идентификатором запроса: так при переключении
  // шаблона старая карточка исчезает без синхронного сброса состояния в эффекте.
  const [loaded, setLoaded] = useState<{ id: string; detail: TemplateDetail | null; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void authFetch('/api/checklist-templates')
      .then(async (response) => {
        if (!response.ok) throw new Error('Не удалось загрузить чек-листы');
        const body = await response.json() as { templates?: ChecklistTemplateSummary[] };
        if (!active) return;
        const list = Array.isArray(body.templates) ? body.templates : [];
        setTemplates(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Не удалось загрузить чек-листы'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void authFetch(`/api/checklist-templates/${selectedId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Не удалось открыть шаблон');
        const body = await response.json() as { template?: TemplateDetail };
        if (active) setLoaded({ id: selectedId, detail: body.template ?? null, error: null });
      })
      .catch((reason) => active && setLoaded({
        id: selectedId,
        detail: null,
        error: reason instanceof Error ? reason.message : 'Не удалось открыть шаблон',
      }));
    return () => { active = false; };
  }, [selectedId]);

  const detail = loaded?.id === selectedId ? loaded.detail : null;
  const detailError = loaded?.id === selectedId ? loaded.error : null;

  const normalized = query.trim().toLocaleLowerCase('ru-RU');
  const filtered = templates.filter((template) => !normalized
    || `${template.name} ${template.level} ${template.blockType ?? ''}`.toLocaleLowerCase('ru-RU').includes(normalized));
  const itemTotal = templates.reduce((sum, template) => sum + (template.itemCount ?? 0), 0);
  const photoItems = detail?.sections.reduce((sum, section) => sum + section.items.filter((item) => item.photoRequired).length, 0) ?? 0;

  // Сквозная нумерация по шаблону: оператор видит «12 из 24», а не «2 из 5»
  // внутри раздела.
  const flatItems = detail?.sections.flatMap((section) =>
    section.items.map((item) => ({ item, sectionTitle: section.title }))) ?? [];
  const previewIndex = flatItems.findIndex(({ item }) => item.id === selectedItemId);
  const preview = previewIndex >= 0 ? flatItems[previewIndex] : flatItems[0];

  return (
    <>
      <ScreenTitle
        heading="Чек-листы"
        subtitle="Шаблоны проверок для смены, техники и обслуживания"
        actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/checklists">Создать чек-лист</Link></Button>}
      />
      <SettingsKpis items={[
        { icon: 'inspection', label: 'Всего шаблонов', value: templates.length },
        { icon: 'accepted', label: 'Действующих', value: templates.filter((item) => item.isActive !== false).length },
        { icon: 'documents', label: 'Пунктов проверки', value: itemTotal },
        { icon: 'risk', label: 'Без пунктов', value: templates.filter((item) => (item.itemCount ?? 0) === 0).length, alert: templates.some((item) => (item.itemCount ?? 0) === 0) },
      ]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <section className={cn(card, 'flex max-h-[720px] flex-col overflow-hidden')}>
          <div className="border-b border-border p-3">
            <h2 className="font-bold">Шаблоны чек-листов</h2>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input aria-label="Поиск шаблонов" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по шаблонам" className="min-h-11 pl-9 text-xs" />
            </div>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {loading && <div className="p-6 text-center text-xs text-muted-foreground">Загружаем шаблоны…</div>}
            {error && <div role="alert" className="p-6 text-xs text-destructive-strong">{error}</div>}
            {!loading && !error && filtered.length === 0 && <div className="p-6 text-center text-xs text-muted-foreground">Шаблоны не найдены.</div>}
            {filtered.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setSelectedId(template.id)}
                aria-current={template.id === selectedId}
                className={cn(
                  'flex w-full min-h-14 items-center gap-2 border-l-2 px-3 py-2 text-left transition',
                  template.id === selectedId ? 'border-signal bg-signal/10' : 'border-transparent hover:bg-muted',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">{template.name}</span>
                  <span className="mt-0.5 block text-3xs text-muted-foreground">
                    {TYPE_LABEL[template.level] ?? template.level} · {BLOCK_LABEL[template.blockType ?? 'BASE'] ?? template.blockType} · {template.itemCount ?? 0} {pluralizeRu(template.itemCount ?? 0, ['пункт', 'пункта', 'пунктов'])}
                  </span>
                </span>
                <StatusPill tone={template.isActive === false ? 'neutral' : 'success'}>{template.isActive === false ? 'Архив' : 'Действует'}</StatusPill>
              </button>
            ))}
          </div>
          <div className="border-t border-border p-3">
            <Button asChild variant="outline" className="w-full"><Link href="/admin/checklists">Управление шаблонами</Link></Button>
          </div>
        </section>

        <section className={cn(card, 'overflow-hidden')}>
          {detailError && <div role="alert" className="p-6 text-sm text-destructive-strong">{detailError}</div>}
          {!detail && !detailError && <div className="p-10 text-center text-sm text-muted-foreground">{selectedId ? 'Открываем шаблон…' : 'Выберите шаблон слева.'}</div>}
          {detail && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{detail.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-3xs text-muted-foreground">
                    <StatusPill tone="success">{TYPE_LABEL[detail.level] ?? detail.level}</StatusPill>
                    <span>{BLOCK_LABEL[detail.blockType ?? 'BASE'] ?? detail.blockType}</span>
                    <span>·</span>
                    <span>{detail.sections.length} {pluralizeRu(detail.sections.length, ['раздел', 'раздела', 'разделов'])}</span>
                    <span>·</span>
                    <span>фото обязательно у {photoItems} {pluralizeRu(photoItems, ['пункта', 'пунктов', 'пунктов'])}</span>
                  </div>
                </div>
                <Button asChild variant="outline"><Link href={`/admin/checklists/${detail.id}`}>Редактировать <ChevronRight className="ml-1 h-4 w-4" /></Link></Button>
              </div>
              <div className="max-h-[620px] space-y-3 overflow-y-auto p-4">
                {detail.sections.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">В шаблоне пока нет разделов.</div>}
                {detail.sections.map((section) => (
                  <article key={section.id} className="rounded-xl border border-border">
                    <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <ClipboardCheck className="h-4 w-4 shrink-0 text-signal-strong" />
                      <h3 className="min-w-0 truncate text-xs font-bold">{section.title}</h3>
                      <span className="ml-auto shrink-0 text-3xs text-muted-foreground">{section.items.length} {pluralizeRu(section.items.length, ['пункт', 'пункта', 'пунктов'])}</span>
                    </header>
                    <div className="overflow-x-auto">
                      <div className="grid min-w-[620px] grid-cols-[44px_minmax(0,1fr)_130px_92px_66px] gap-2 border-b border-border px-3 py-1.5 text-3xs font-semibold uppercase text-muted-foreground">
                        <span>№</span><span>Пункт проверки</span><span>Тип ответа</span><span>Обязательность</span><span>Фото</span>
                      </div>
                      {section.items.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedItemId(item.id)}
                          aria-current={preview?.item.id === item.id}
                          className={cn(
                            'grid min-h-11 w-full min-w-[620px] grid-cols-[44px_minmax(0,1fr)_130px_92px_66px] items-center gap-2 border-b border-border px-3 py-2 text-left text-2xs transition last:border-b-0 hover:bg-signal/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal',
                            preview?.item.id === item.id && 'bg-signal/10',
                          )}
                        >
                          <span className="font-mono text-muted-foreground">{index + 1}</span>
                          <span className="min-w-0">
                            <span className="block leading-snug">{item.text}</span>
                            {item.norm && <span className="mt-0.5 block text-3xs text-muted-foreground">Норма: {item.norm}{item.unit ? ` ${item.unit}` : ''}</span>}
                          </span>
                          <span className="text-muted-foreground">{ANSWER_TYPE_LABEL[item.answerType] ?? item.answerType}</span>
                          <span>{item.required ? <StatusPill tone="warning">Обязательно</StatusPill> : <span className="text-muted-foreground">—</span>}</span>
                          <span>{item.photoRequired
                            ? <StatusPill tone="info">Нужно</StatusPill>
                            : <span className="text-muted-foreground">—</span>}</span>
                        </button>
                      ))}
                      {section.items.length === 0 && <div className="px-3 py-6 text-center text-2xs text-muted-foreground">В разделе нет пунктов.</div>}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <aside className={cn(card, 'self-start p-4')}>
          <h2 className="font-bold">Предпросмотр для оператора</h2>
          <p className="mt-1 text-3xs leading-relaxed text-muted-foreground">
            Так пункт выглядит в окне осмотра. Контролы ответа здесь те же, что видит оператор.
          </p>
          {preview ? (
            <>
              <div className="mt-3">
                <OperatorPreview
                  // Сброс выбранного ответа при переходе к другому пункту:
                  // иначе «Да» с прошлого пункта осталось бы стоять на новом.
                  key={preview.item.id}
                  item={preview.item}
                  sectionTitle={preview.sectionTitle}
                  position={(previewIndex >= 0 ? previewIndex : 0) + 1}
                  total={flatItems.length}
                />
              </div>
              <dl className="mt-4 space-y-2 border-t border-border pt-3 text-2xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Тип ответа</dt>
                  <dd className="text-right font-semibold">{ANSWER_TYPE_LABEL[preview.item.answerType] ?? preview.item.answerType}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Обязательный ответ</dt>
                  <dd className="text-right font-semibold">{preview.item.required ? 'да' : 'нет'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Требовать фото</dt>
                  <dd className="text-right font-semibold">{preview.item.photoRequired ? 'да' : 'нет'}</dd>
                </div>
                {preview.item.norm && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Норма</dt>
                    <dd className="text-right font-semibold">{preview.item.norm}{preview.item.unit ? ` ${preview.item.unit}` : ''}</dd>
                  </div>
                )}
              </dl>
              {detail && (
                <Button asChild variant="outline" className="mt-3 w-full">
                  <Link href={`/admin/checklists/${detail.id}`}>Изменить пункт</Link>
                </Button>
              )}
            </>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              {detail ? 'В шаблоне пока нет пунктов.' : 'Выберите шаблон, чтобы увидеть предпросмотр.'}
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
