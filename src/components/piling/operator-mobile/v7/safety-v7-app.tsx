'use client';

import {useCallback, useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import type {SelfSafetyView} from '@/modules/safety/application/self-clearance-query';
import {DOCUMENT_EXPIRY_LABELS, type DocumentExpiryStatus} from '@/lib/document-expiry';
import {formatRuDate} from '@/lib/format';
import {
  Banner, Button, Card, CardBody, Chip, Dock, Empty, Pair, PhoneShell, Row, Title,
  type DockItem, type Tone,
} from './v7-ui';

/**
 * «ТБ и допуски» — личный раздел работника в мобильной оболочке.
 *
 * ЧТО ИМЕННО ПЕРЕНЕСЕНО. Настольный `/admin/safety` — модуль для семи ролей: он
 * ведёт допуски ВСЕХ работников, журнал инструктажей, разбор происшествий и
 * наряды. Машинисту с телефона нужна одна его часть — «мой допуск»: свои
 * документы, свои инструктажи, своя проверка знаний. Её и переносим, потому что
 * источник у неё отдельный и личный: `/api/safety/my-clearance` сужает выборку
 * идентификатором ИЗ СЕССИИ и параметра `userId` не имеет вовсе.
 *
 * Вкладки инженера ОТ остаются на настольном экране: тащить в телефон разбор
 * происшествий по всей организации — значит показать машинисту семь вкладок,
 * шесть из которых ответят «Недостаточно прав».
 */

type Tab = 'CLEARANCE' | 'BRIEFINGS' | 'JOURNAL';

const SAFETY_DOCK = [
  {key: 'CLEARANCE', label: 'Допуск', glyph: '⛨', mid: true},
  {key: 'BRIEFINGS', label: 'Инструктажи', glyph: '☰'},
  {key: 'JOURNAL', label: 'Журнал', glyph: '▤'},
] as const satisfies readonly DockItem<Tab>[];

const TAB_TITLES: Record<Tab, string> = {
  CLEARANCE: 'Мой допуск',
  BRIEFINGS: 'Инструктажи',
  JOURNAL: 'Журнал ТБ',
};

/**
 * Состояние документа в карточке допуска.
 *
 * Подписи берём из общего словаря `lib/document-expiry`, а не пишем свои: те же
 * слова видит администратор в карточке работника, и расхождение здесь означало
 * бы, что двое читают про один документ разное. Своё тут одно — `missing`:
 * отсутствие документа это не срок годности, в общий словарь оно не входит.
 */
const DOCUMENT_LABEL: Record<DocumentExpiryStatus | 'missing', string> = {
  ...DOCUMENT_EXPIRY_LABELS,
  missing: 'не заведён',
};

const DOCUMENT_TONE: Record<DocumentExpiryStatus | 'missing', Tone> = {
  perpetual: 'ok', ok: 'ok', expiring: 'warn', expired: 'bad', missing: 'bad',
};

async function readView(): Promise<SelfSafetyView> {
  const response = await fetch('/api/safety/my-clearance', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const payload = await response.json().catch(() => null) as
    (SelfSafetyView & {error?: string}) | null;
  if (!response.ok) {
    const error = new Error(payload?.error ?? 'Сервер не ответил');
    (error as Error & {status?: number}).status = response.status;
    throw error;
  }
  return payload as SelfSafetyView;
}

export function SafetyV7App() {
  const router = useRouter();
  const [view, setView] = useState<SelfSafetyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [tab, setTab] = useState<Tab>('CLEARANCE');

  const load = useCallback(async () => {
    try {
      setView(await readView());
      setError(null);
      setSyncedAt(new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}));
    } catch (cause) {
      if ((cause as Error & {status?: number}).status === 401) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- намеренно: сессия истекла, полная перезагрузка сбрасывает кэш маршрутов и память вкладки прежнего входа
        window.location.href = '/login';
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Не удалось получить допуск');
    }
  }, []);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  useEffect(() => {
    const update = () => setOnline(globalThis.navigator?.onLine ?? true);
    update();
    globalThis.addEventListener?.('online', update);
    globalThis.addEventListener?.('offline', update);
    return () => {
      globalThis.removeEventListener?.('online', update);
      globalThis.removeEventListener?.('offline', update);
    };
  }, []);

  const back = () => router.push('/operator/v7');

  if (error) {
    return (
      <PhoneShell online={online} syncedAt={syncedAt} pending={0} back="Смена" onBack={back}>
        <div className="state">
          <h2>Допуск недоступен</h2>
          <p>{error}</p>
          <Button onClick={() => void load()}>Повторить</Button>
        </div>
      </PhoneShell>
    );
  }

  if (!view) {
    return (
      <PhoneShell online={online} syncedAt={syncedAt} pending={0} back="Смена" onBack={back}>
        <div className="state"><h2>Загрузка</h2><p>Читаем ваш допуск</p></div>
      </PhoneShell>
    );
  }

  const {clearance, briefings, history, knowledgeValidUntil} = view;
  const pendingCount = briefings.pending.length + briefings.overdue.length;

  return (
    <PhoneShell
      online={online}
      syncedAt={syncedAt}
      pending={0}
      back="Смена"
      onBack={back}
      dock={<Dock items={SAFETY_DOCK} active={tab} badges={{BRIEFINGS: pendingCount}} onSelect={setTab} />}
    >
      <Title note="Ваши документы, инструктажи и проверка знаний">{TAB_TITLES[tab]}</Title>

      <div className="body">
        {tab === 'CLEARANCE' ? (
          <>
            <Card>
              <CardBody>
                {clearance.cleared ? <div className="seal" aria-hidden="true">✓</div> : null}
                <div style={{textAlign: 'center', fontSize: 17, fontWeight: 800}}>
                  {clearance.cleared ? 'Допуск в порядке' : 'Допуск не оформлен'}
                </div>
                <div style={{textAlign: 'center', color: clearance.cleared ? 'var(--green)' : 'var(--red)'}}>
                  {clearance.cleared
                    ? 'Препятствий к работе нет'
                    : `Препятствий: ${clearance.blockers.length}`}
                </div>
              </CardBody>
            </Card>

            {clearance.blockers.map((issue) => (
              <Banner key={`b-${issue.typeId}`} tone="bad" title={issue.typeName} note={issue.label} />
            ))}
            {clearance.warnings.map((issue) => (
              <Banner key={`w-${issue.typeId}`} tone="warn" title={issue.typeName} note={issue.label} />
            ))}

            <Card title="Документы">
              {clearance.documents.length === 0
                ? <Empty>Обязательных документов для вашей роли нет</Empty>
                : clearance.documents.map((document) => (
                  <Row
                    key={document.typeId}
                    title={document.typeName}
                    note={document.expiresAt
                      ? `до ${formatRuDate(document.expiresAt)}${document.daysLeft === null ? '' : ` · ${document.daysLeft} дн.`}`
                      : (document.status === 'missing' ? 'документа нет' : 'бессрочный')}
                    chip={(
                      <Chip tone={DOCUMENT_TONE[document.status] ?? 'muted'}>
                        {DOCUMENT_LABEL[document.status] ?? document.status}
                      </Chip>
                    )}
                  />
                ))}
            </Card>

            <Card title="Проверка знаний">
              <CardBody>
                <div className="pairs">
                  <Pair
                    label="Действует до"
                    value={knowledgeValidUntil ? formatRuDate(knowledgeValidUntil) : 'не пройдена'}
                  />
                  <Pair
                    label="Последний инструктаж"
                    value={briefings.lastBriefingAt ? formatRuDate(briefings.lastBriefingAt) : '—'}
                  />
                </div>
              </CardBody>
            </Card>
          </>
        ) : null}

        {tab === 'BRIEFINGS' ? (
          <>
            {briefings.overdue.length > 0 ? (
              <Card title="Просрочены">
                {briefings.overdue.map((item) => (
                  <Row
                    key={item.code}
                    title={item.title}
                    note={`${item.code} · срок ${formatRuDate(item.dueAt)}`}
                    chip={<Chip tone="bad">{item.daysOverdue} дн.</Chip>}
                  />
                ))}
              </Card>
            ) : null}

            {briefings.pending.length > 0 ? (
              <Card title="Ожидают ознакомления">
                {briefings.pending.map((item) => (
                  <Row
                    key={item.code}
                    title={item.title}
                    note={`${item.code} · версия ${item.version}`}
                    chip={<Chip tone="warn">Не пройден</Chip>}
                  />
                ))}
              </Card>
            ) : null}

            <Card title="Обязательны вашей роли">
              {briefings.required.length === 0
                ? <Empty>Требований к вашей роли нет</Empty>
                : briefings.required.map((item) => (
                  <Row
                    key={item.code}
                    title={item.title}
                    note={`${item.code} · версия ${item.version} · ${item.audience}`}
                  />
                ))}
            </Card>

            {pendingCount === 0 ? (
              <Banner tone="ok" title="Инструктажи пройдены" note="Ничего не просрочено и не ожидает." />
            ) : (
              <Banner
                tone="info"
                title="Ознакомление проходится в смене"
                note="Шаг «Ознакомление с инструкциями» на главном экране смены."
              />
            )}
          </>
        ) : null}

        {tab === 'JOURNAL' ? (
          <Card title={`Последние записи: ${history.length}`}>
            {history.length === 0
              ? <Empty>Записей пока нет</Empty>
              : history.map((record) => (
                <Row
                  key={record.id}
                  title={record.documentTitle}
                  note={[
                    formatRuDate(record.recordedAt),
                    `версия ${record.documentVersion}`,
                    record.validUntil ? `до ${formatRuDate(record.validUntil)}` : null,
                  ].filter(Boolean).join(' · ')}
                  chip={(
                    <Chip tone={record.kind === 'KNOWLEDGE' ? 'info' : 'ok'}>
                      {record.kind === 'KNOWLEDGE' ? (record.result ?? 'Проверка') : 'Ознакомление'}
                    </Chip>
                  )}
                />
              ))}
          </Card>
        ) : null}

        <Button tone="ghost" onClick={() => router.push('/admin/safety')}>
          Полный раздел «ТБ и допуски»
        </Button>
      </div>
    </PhoneShell>
  );
}
