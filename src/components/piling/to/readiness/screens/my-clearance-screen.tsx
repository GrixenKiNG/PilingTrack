'use client';

/**
 * «Мой допуск» — личный раздел, открытый каждому работнику.
 *
 * Модуль «ТБ и допуски» доступен всем ролям: инструктаж проходит каждый.
 * Но остальные вкладки — рабочее место инженера ОТ, и машинист их не
 * откроет. Без этого раздела «доступ для всех» означал бы модуль, где все
 * вкладки отвечают отказом, — доступ к запертой двери.
 *
 * Показываем ровно то же, что человек видит на своём экране смены: тот же
 * расчёт допуска (`getOperatorClearance`) и его собственный журнал.
 * Расхождение здесь было бы хуже отсутствия экрана: «допущен» в одном месте
 * и отказ при пуске смены в другом.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { RefKpi } from './shared';
import { EquipmentPermitMatrix } from './equipment-permit-matrix';

interface ClearanceDocument {
  typeId: string;
  typeName: string;
  status: 'ok' | 'expiring' | 'expired' | 'perpetual' | 'missing';
  expiresAt: string | null;
  daysLeft: number | null;
}

interface SelfView {
  clearance: {
    cleared: boolean;
    blockers: Array<{ label: string }>;
    warnings: Array<{ label: string }>;
    documents: ClearanceDocument[];
  };
  briefings: {
    required: Array<{ code: string; title: string; version: string; repeatMonths: number }>;
    pending: Array<{ code: string; title: string; version: string; reason: 'never' | 'outdated' }>;
    overdue: Array<{ code: string; title: string; dueAt: string; daysOverdue: number }>;
    lastBriefingAt: string | null;
  };
  knowledgeValidUntil: string | null;
  history: Array<{
    id: string;
    kind: 'INSTRUCTION' | 'KNOWLEDGE';
    recordedAt: string;
    documentTitle: string;
    documentVersion: string;
    result: string | null;
    validUntil: string | null;
  }>;
}

const DOCUMENT_STATUS_LABEL: Record<ClearanceDocument['status'], string> = {
  ok: 'Действует',
  perpetual: 'Бессрочный',
  expiring: 'Скоро истекает',
  expired: 'Просрочен',
  missing: 'Не заведён',
};

const isTrouble = (status: ClearanceDocument['status']) =>
  status === 'expired' || status === 'missing';

export function MyClearanceScreen() {
  const [data, setData] = useState<SelfView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await authFetch('/api/safety/my-clearance');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      setData((await response.json()) as SelfView);
      setFailed(null);
    } catch (error) {
      // Пустой экран вместо ошибки человек прочитает как «у меня всё в
      // порядке» — на своём допуске это худшая из подмен.
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить допуск');
      setData(null);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  const clearance = data?.clearance;

  return (
    <>
      <ScreenTitle
        heading="Мой допуск"
        subtitle="Ваши документы, инструктажи и проверка знаний"
        actions={(
          <Button variant="outline" onClick={() => { setData(null); void load(); }}>Обновить</Button>
        )}
      />

      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi
          icon="accepted"
          label="Допуск к работе"
          tone={clearance && !clearance.cleared ? 'danger' : 'success'}
          value={clearance ? (clearance.cleared ? 'Есть' : 'Нет') : '—'}
          alert={Boolean(clearance && !clearance.cleared)}
          detail={clearance?.cleared ? 'все обязательные документы действуют' : 'смена не откроется'}
        />
        <RefKpi
          icon="history"
          label="Скоро истекает"
          tone="warning"
          value={clearance?.warnings.length ?? '—'}
          detail="документов требуют продления"
        />
        <RefKpi
          icon="documents"
          label="Инструктажи"
          tone={data && (data.briefings.pending.length || data.briefings.overdue.length) ? 'warning' : 'success'}
          value={data ? (data.briefings.pending.length + data.briefings.overdue.length || 'В норме') : '—'}
          detail={data?.briefings.lastBriefingAt
            ? `последний ${formatRuDate(data.briefings.lastBriefingAt)}`
            : 'записей нет'}
        />
        <RefKpi
          icon="risk"
          label="Проверка знаний"
          tone="info"
          value={data ? (data.knowledgeValidUntil ? 'Сдана' : 'Нет записи') : '—'}
          detail={data?.knowledgeValidUntil ? `действует до ${formatRuDate(data.knowledgeValidUntil)}` : 'проверку ещё не проходили'}
        />
      </section>

      {failed && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
          {failed}
        </p>
      )}

      {data === null && !failed && (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      )}

      {data && clearance
        && (clearance.blockers.length > 0 || clearance.warnings.length > 0
          || data.briefings.pending.length > 0 || data.briefings.overdue.length > 0) && (
        <section className={cn(card, 'mt-2 p-3')}>
          <h2 className="font-bold">Что нужно сделать</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {clearance.blockers.map((issue) => (
              <li key={issue.label} className="text-destructive-strong">{issue.label}</li>
            ))}
            {/* Просроченный повторный инструктаж — нарушение, непрочитанная
                редакция — задача на сегодня. Разные цвета, потому что разные
                последствия. */}
            {data.briefings.overdue.map((item) => (
              <li key={`o-${item.code}`} className="text-destructive-strong">
                Просрочен повторный инструктаж: {item.title} — {item.daysOverdue} дн.
              </li>
            ))}
            {data.briefings.pending.map((item) => (
              <li key={`p-${item.code}`} className="text-warning-strong">
                {item.reason === 'never'
                  ? `Не пройден инструктаж: ${item.title}`
                  : `Вышла новая редакция ${item.version}: ${item.title} — прочитайте заново`}
              </li>
            ))}
            {clearance.warnings.map((issue) => (
              <li key={issue.label} className="text-warning-strong">{issue.label}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Документы прикладывает администратор или инженер ОТ — обратитесь к ним, срок продления
            бывает несколько недель. Инструктаж и проверку знаний вы проходите сами перед сменой на
            своём рабочем экране.
          </p>
        </section>
      )}

      {clearance && (
        <section className={cn(card, 'mt-2 p-3')}>
          <h2 className="font-bold">Обязательные документы</h2>
          {clearance.documents.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Обязательных документов в организации не задано — допуск по бумагам не проверяется.
            </p>
          ) : (
            <div className="mt-2 divide-y divide-border">
              {clearance.documents.map((document) => (
                <div key={document.typeId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{document.typeName}</span>
                  <span className={cn(
                    'text-xs font-semibold',
                    isTrouble(document.status)
                      ? 'text-destructive-strong'
                      : document.status === 'expiring' ? 'text-warning-strong' : 'text-success-strong',
                  )}>
                    {DOCUMENT_STATUS_LABEL[document.status]}
                  </span>
                  <span className="w-28 text-right text-xs text-muted-foreground">
                    {document.expiresAt ? `до ${formatRuDate(document.expiresAt)}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Свою матрицу работник ВИДИТ, но не правит: допуск к технике выдаёт
          администратор, и кнопка правки у своего же допуска была бы дверью,
          которую сервер всё равно закроет. */}
      {data && <div className="mt-2"><EquipmentPermitMatrix editable={false} /></div>}

      {data && (
        <section className={cn(card, 'mt-2 p-3')}>
          <h2 className="font-bold">Мои инструктажи и проверки знаний</h2>
          {data.history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Записей пока нет. Инструктаж проводит мастер или инженер ОТ.
            </p>
          ) : (
            <div className="mt-2 divide-y divide-border">
              {data.history.map((record) => (
                <div key={record.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="w-36 shrink-0 text-xs text-muted-foreground">
                    {formatRuDate(record.recordedAt)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{record.documentTitle}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {record.kind === 'KNOWLEDGE' ? 'проверка знаний' : 'ознакомление'}
                      {record.documentVersion ? ` · ред. ${record.documentVersion}` : ''}
                    </span>
                  </span>
                  <span className="text-xs font-semibold">
                    {record.result ?? '✓'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
