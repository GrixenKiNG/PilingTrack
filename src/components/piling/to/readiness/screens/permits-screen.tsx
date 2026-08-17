'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Search } from '@/components/piling/icons/unified-icons';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/lib/api';
import { formatDateInTimezone, formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { READINESS_READY_THRESHOLD } from '@/modules/readiness';
import { PERMIT_STATE_LABEL } from '../readiness-labels';
import { handoverRoleLabel } from '../handover-journal';
import type { WorkPermitDto } from '../api/contracts';
import { CommandDialog } from '../shared/command-dialog';
import { PermitForm } from '../forms/permit-form';
import { ProcessRoleStrip, RefKpi, commandFailure, downloadReadinessExport } from './shared';
import type { ReferenceUiProps } from './types';

function EvidenceState({ state }: { state: string }) {
  return (
    <span
      className={cn(
        'rounded px-2 py-1 text-xs font-semibold',
        state === 'pass' && 'bg-success/10 text-success-strong',
        state === 'warning' && 'bg-signal/10 text-signal-strong',
        state === 'missing' && 'bg-muted text-muted-foreground',
        state === 'block' && 'bg-destructive/10 text-destructive-strong',
      )}
    >
      {state === 'pass' ? 'Выполнено' : state === 'block' ? 'Есть' : state === 'warning' ? 'С замечаниями' : 'Не подтверждено'}
    </span>
  );
}

export function PermitsScreen(props: ReferenceUiProps) {
  /*
    Оформление наряда — полноэкранная форма, а не диалог (макет владельца от
    16.08.2026). Режим живёт состоянием этого экрана, а не отдельным маршрутом:
    модуль готовности — вкладочная оболочка, и новый адрес пришлось бы
    протаскивать через всю навигацию ради одной формы.
  */
  const [composing, setComposing] = useState(false);
  const [permitQuery, setPermitQuery] = useState('');
  const [permitFilter, setPermitFilter] = useState<'ALL' | 'APPROVED' | 'PENDING_APPROVAL'>('ALL');
  /*
    Диалог остался только для решений по существующему наряду: отправить,
    согласовать, отозвать. Создание переехало в полноэкранную форму — прежнее
    окошко умещало весь наряд в одно поле «состав и границы работ», риск и срок
    жизни, чего для наряда-допуска мало.
  */
  const [command, setCommand] = useState<{permit: WorkPermitDto; action: 'submit' | 'approve' | 'revoke'} | null>(null);
  const [commandText, setCommandText] = useState('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  // Сроки документов экипажей: те же данные, что во вкладке «Документы».
  const [documents, setDocuments] = useState<{expired: number; expiring: number} | null>(null);
  useEffect(() => {
    let cancelled = false;
    void authFetch('/api/user-documents/control')
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as {expired?: number; expiring?: number};
        // Право на этот список есть не у всех, кому открыт экран нарядов —
        // отказ оставляет плитку в состоянии «не загружено», а не врёт «в порядке».
        if (!cancelled) setDocuments({expired: body.expired ?? 0, expiring: body.expiring ?? 0});
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const active = props.permits.filter((item) => item.state === 'APPROVED').length;
  const blocked = props.permits.filter((item) => ['EXPIRED', 'REVOKED'].includes(item.state)).length;
  const pending = props.permits.filter((item) => item.state === 'PENDING_APPROVAL').length;
  const crewByEquipment = new Map(props.crews.flatMap((crew) => crew.isActive && crew.equipment ? [[crew.equipment.id, crew] as const] : []));
  const awaitingApproval = props.permits.filter((item) => item.state === 'PENDING_APPROVAL');
  const equipmentWithApprovedPermit = new Set(
    props.permits.flatMap((item) => item.state === 'APPROVED' ? [item.equipmentId] : []),
  ).size;
  /*
    Счётчики плиток — по авторитетным снимкам, а не по производной модели.
    У производной доказательства заполнены только для выбранной установки
    (журнал ТО грузится по одной), поэтому плитка «Техника» показывала
    «Осмотрено: 0 из 9» при девяти выполненных осмотрах.
  */
  const inspectedCount = props.currentReadiness.filter((item) => item.facts?.inspectionCompleted).length;
  const maintenanceOkCount = props.currentReadiness.filter((item) => item.facts
    && item.facts.maintenanceConfigured
    && item.facts.maintenanceOverdueHours === 0
    && item.facts.maintenanceOverdueDays === 0).length;
  /**
   * Чей журнал согласования показываем: наряд выбранной установки, иначе
   * первый ожидающий решения. Журнал строится из его approvals[].
   */
  const journalPermit = props.permits.find((item) => item.equipmentId === props.selectedId)
    ?? awaitingApproval[0]
    ?? props.permits[0]
    ?? null;
  const validApprovals = journalPermit
    ? journalPermit.approvals.filter((item) => item.valid && item.permitVersion === journalPermit.version).length
    : 0;
  const filteredPermits = props.permits.filter((permit) => {
    if (permitFilter !== 'ALL' && permit.state !== permitFilter) return false;
    const equipmentName = props.equipment.find((item) => item.id === permit.equipmentId)?.name ?? '';
    const query = permitQuery.trim().toLocaleLowerCase('ru-RU');
    return !query || permit.id.toLocaleLowerCase('ru-RU').includes(query) || equipmentName.toLocaleLowerCase('ru-RU').includes(query) || permit.scope.toLocaleLowerCase('ru-RU').includes(query);
  });
  const runPermitAction = async (permit: WorkPermitDto, action: 'submit' | 'approve' | 'revoke', confirmed = false) => {
    if (!confirmed) { setCommand({permit, action}); setCommandText(''); setCommandError(null); return; }
    if (action === 'revoke' && !commandText.trim()) { setCommandError('Укажите причину отзыва наряда.'); return; }
    setCommandPending(true);
    const response = await authFetch(`/api/readiness/work-permits/${permit.id}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"work-permit-${permit.id}-v${permit.version}"`,
        // Замещение передаём и при согласовании: администратор подписывает
        // наряд обычного риска именно как диспетчер. Правило «автор не
        // согласует свой наряд» остаётся на сервере.
        ...(props.bootstrap?.actor.actingAs ? { 'x-readiness-acting-as': props.bootstrap.actor.actingAs } : {}),
      },
      body: JSON.stringify(action === 'revoke'
        ? { expectedVersion: permit.version, reason: commandText.trim() }
        : { expectedVersion: permit.version }),
    });
    setCommandPending(false);
    if (!response.ok) { setCommandError(await commandFailure(response)); if (response.status === 409) props.onRetry(); return; }
    toast.success(action === 'submit' ? 'Наряд отправлен на согласование' : action === 'approve' ? 'Наряд согласован' : 'Наряд отозван');
    setCommand(null);
    props.onRetry();
  };

  if (composing) {
    return (
      <PermitForm
        equipment={props.equipment}
        fleetCards={props.fleetCards}
        selectedEquipmentId={props.selectedId}
        bootstrap={props.bootstrap}
        onCancel={() => setComposing(false)}
        onCreated={() => { setComposing(false); props.onRetry(); }}
      />
    );
  }

  return (
    <>
      <ScreenTitle heading="Наряд-допуски" subtitle="Проверка условий и разрешений на выполнение работ" actions={<div className="flex gap-2"><Button variant="outline" onClick={() => void downloadReadinessExport('permits', props.filters).catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт'))}>Экспорт</Button>{/* Установку выбирают в самой форме, поэтому кнопка больше не ждёт
                выделенной строки в списке — раньше она была недоступна, пока
                пользователь не догадается кликнуть установку. */}
            <Button type="button" disabled={!props.bootstrap?.capabilities.entities.permit.edit} onClick={() => setComposing(true)} className="min-h-11 bg-signal-strong hover:bg-signal-strong">+ Создать наряд</Button></div>} />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="documents" label="Всего нарядов" tone="info" value={props.permits.length} />
        <RefKpi icon="accepted" label="Действуют" tone="success" value={active} />
        <RefKpi icon="history" label="На согласовании" tone="warning" value={pending} alert={pending > 0} />
        <RefKpi icon="defect" label="Заблокированы" tone="danger" value={blocked} alert={blocked > 0} />
      </section>
      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex items-center gap-2"><CheckCircle2 className="h-6 w-6 text-success-strong" /><h2 className="font-bold">Условия допуска подтверждены для {active} из {props.permits.length} нарядов</h2></div>
        {/*
          Красный сегмент был `flex-1` — он забирал ВСЮ оставшуюся ширину, а не
          долю заблокированных. Черновики (ни одна из трёх категорий) красились
          красным как «заблокировано», хотя легенда рядом честно писала 0.
          Полоса противоречила собственной подписи. Теперь каждый сегмент имеет
          свою ширину, а остаток отдан черновикам нейтральным цветом.
        */}
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-border">
          {([
            [active, 'bg-success-strong'],
            [pending, 'bg-signal'],
            [blocked, 'bg-destructive-strong'],
            [Math.max(0, props.permits.length - active - pending - blocked), 'bg-muted-foreground/40'],
          ] as const).map(([count, cls], index) => (
            <div key={index} className={cls} style={{ width: `${props.permits.length ? count / props.permits.length * 100 : 0}%` }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-2xs text-muted-foreground"><span>● <b>{active}</b> допущено</span><span className="text-signal-strong">● <b>{pending}</b> ожидают подтверждения</span><span className="text-destructive-strong">● <b>{blocked}</b> заблокировано</span>{props.permits.length - active - pending - blocked > 0 && <span>● <b>{props.permits.length - active - pending - blocked}</b> черновиков</span>}<span className="xl:ml-auto text-muted-foreground">Фактическая проверка условий готовности</span></div>
      </section>
      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex items-center justify-between"><div><h2 className="font-bold">Доказательства допуска</h2><p className="mt-0.5 text-2xs text-muted-foreground">Полный комплект подтверждений перед началом работ</p></div>{/*
            Было «{active} из {equipment.length}» — согласованные НАРЯДЫ против
            числа УСТАНОВОК. Величины несопоставимы, и на живых данных выходило
            «10 из 9 комплектов подтверждено». Считаем установки, у которых есть
            действующий наряд, из общего числа установок.
          */}
          <span className="text-xs text-muted-foreground">{equipmentWithApprovedPermit} из {props.equipment.length} установок с действующим нарядом</span></div>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            // Плитка обещала «Удостоверения проверяются» и ничего не проверяла.
            // Контроль сроков уже есть (`/api/user-documents/control`) — берём
            // его, а не подпись о намерении.
            {
              title: 'Люди',
              icon: 'operator' as PilingIconName,
              state: documents === null ? 'missing'
                : documents.expired > 0 ? 'block'
                  : documents.expiring > 0 ? 'warning' : 'pass',
              lines: [
                `Экипажей: ${props.crews.filter((crew) => crew.isActive).length}`,
                documents === null ? 'Сроки документов не загружены'
                  : documents.expired > 0 ? `Просрочены документы: ${documents.expired}`
                    : documents.expiring > 0 ? `Истекают: ${documents.expiring}`
                      : 'Документы действуют',
              ],
            },
            { title: 'Техника', icon: 'equipment-rig' as PilingIconName, state: blocked > 0 ? 'warning' : 'pass', lines: [`Ограничений: ${blocked}`, `Осмотрено: ${inspectedCount} из ${props.equipment.length}`] },
            { title: 'Место работ', icon: 'site' as PilingIconName, state: props.crews.some((crew) => crew.isActive && crew.site) ? 'pass' : 'missing', lines: [`Объектов: ${new Set(props.crews.flatMap((crew) => crew.site?.id ? [crew.site.id] : [])).size}`,
              // Подтверждения схемы площадки в системе нет — не делаем вид, что есть.
              `Экипажей без объекта: ${props.crews.filter((crew) => crew.isActive && !crew.site).length}`] },
            { title: 'Документы', icon: 'documents' as PilingIconName, state: pending > 0 ? 'warning' : 'pass', lines: [`Регламент ТО соблюдён: ${maintenanceOkCount} из ${props.equipment.length}`, pending > 0 ? `Ожидают: ${pending}` : 'Решения подтверждены'] },
          ].map((item) => (
            <article key={item.title} className="rounded-lg border border-border p-2">
              <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-info/10 text-info-strong"><PilingIcon name={item.icon} size={12} decorative /></span><div className="min-w-0 flex-1"><h3 className="text-xs font-bold">{item.title}</h3><EvidenceState state={item.state} /></div></div>
              <div className="mt-2 space-y-1 text-3xs text-muted-foreground">{item.lines.map((line) => <div key={line}>• {line}</div>)}</div>
            </article>
          ))}
        </div>
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className={cn(card, 'overflow-x-auto')}>
          <div className="p-3"><h2 className="font-bold">Реестр нарядов-допусков</h2><div className="mt-2 flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Поиск нарядов" value={permitQuery} onChange={(event) => setPermitQuery(event.target.value)} placeholder="Номер, установка, объект" className="min-h-11 bg-muted pl-9 text-xs" /></div>{([['ALL', 'Все'], ['APPROVED', 'Действующие'], ['PENDING_APPROVAL', 'На согласовании']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={permitFilter === value} onClick={() => setPermitFilter(value)} className={cn('min-h-11 rounded border px-3 text-2xs', permitFilter === value ? 'border-info bg-info/10 text-info-strong' : 'border-border text-muted-foreground')}>{label}</button>)}</div></div>
          <div className="hidden min-w-[880px] grid-cols-[125px_minmax(120px,1.2fr)_minmax(110px,1fr)_70px_100px_80px_110px_120px] border-y border-border bg-muted px-3 py-2 text-3xs uppercase tracking-wide text-muted-foreground md:grid"><span>№ наряда</span><span>Установка</span><span>Объект</span><span>Смена</span><span>Действует до</span><span>Готовность</span><span>Статус</span><span>Действие</span></div>
          <div className="hidden max-h-[230px] min-w-[760px] divide-y divide-border overflow-y-auto md:block">
            {filteredPermits.map((permit, index) => {
              const item = props.equipment.find((entry) => entry.id === permit.equipmentId);
              const crew = crewByEquipment.get(permit.equipmentId);
              const current = props.currentReadiness.find((entry) => entry.equipmentId === permit.equipmentId);
              return (
                <div key={permit.id} className={cn('grid grid-cols-[125px_minmax(120px,1.2fr)_minmax(110px,1fr)_70px_100px_80px_110px_120px] items-center px-3 py-2 text-2xs hover:bg-signal/5', index === 0 && 'bg-signal/5 ring-1 ring-inset ring-signal/25')}>
                  <span className="font-bold">НД-{permit.id.slice(-8).toUpperCase()}</span><span>{item?.name || 'Установка'}</span><span>{crew?.site?.name || 'Не назначен'}</span><span>{permit.shiftId ? permit.shiftId.slice(-6) : '—'}</span><span>{formatDateInTimezone(permit.validTo, props.bootstrap?.tenant.timezone, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span className="pr-2"><b className={cn(current?.score != null && current.score >= READINESS_READY_THRESHOLD ? 'text-success-strong' : 'text-signal-strong')}>{current?.score ?? '—'}%</b><span className="mt-1 block h-1 overflow-hidden rounded-full bg-border"><span className={cn('block h-full rounded-full', current?.score != null && current.score >= READINESS_READY_THRESHOLD ? 'bg-success-strong' : 'bg-signal')} style={{ width: `${current?.score ?? 0}%` }} /></span></span><span className={cn('font-semibold', permit.state === 'APPROVED' ? 'text-success-strong' : permit.state === 'PENDING_APPROVAL' ? 'text-signal-strong' : 'text-muted-foreground')}>{PERMIT_STATE_LABEL[permit.state]}</span><span>{permit.state === 'DRAFT' && props.bootstrap?.capabilities.entities.permit.edit && <button type="button" onClick={() => void runPermitAction(permit, 'submit')} className="min-h-11 rounded border border-signal/30 px-2 font-semibold text-signal-strong">Отправить</button>}{permit.state === 'PENDING_APPROVAL' && (props.bootstrap?.capabilities.entities.permit.approveDispatcher || props.bootstrap?.capabilities.entities.permit.approveAdmin) && <button type="button" onClick={() => void runPermitAction(permit, 'approve')} className="min-h-11 rounded border border-success/30 px-2 font-semibold text-success-strong">Согласовать</button>}{permit.state === 'APPROVED' && props.bootstrap?.capabilities.entities.permit.edit && <button type="button" onClick={() => void runPermitAction(permit, 'revoke')} className="min-h-11 rounded border border-destructive/30 px-2 font-semibold text-destructive-strong">Отозвать</button>}</span>
                </div>
              );
            })}
            {filteredPermits.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">По выбранным условиям наряды не найдены.</div>}
          </div>
          <div className="space-y-2 p-3 md:hidden">
            {filteredPermits.map((permit) => {
              const item = props.equipment.find((equipment) => equipment.id === permit.equipmentId);
              const crew = crewByEquipment.get(permit.equipmentId);
              const current = props.currentReadiness.find((entry) => entry.equipmentId === permit.equipmentId);
              const action = permit.state === 'DRAFT' ? 'submit' : permit.state === 'PENDING_APPROVAL' ? 'approve' : permit.state === 'APPROVED' ? 'revoke' : null;
              const canAct = action === 'submit' ? props.bootstrap?.capabilities.entities.permit.edit
                : action === 'approve' ? (props.bootstrap?.capabilities.entities.permit.approveDispatcher || props.bootstrap?.capabilities.entities.permit.approveAdmin)
                  : action === 'revoke' ? props.bootstrap?.capabilities.entities.permit.edit : false;
              return <article key={permit.id} className="rounded-lg border border-border p-3 text-xs">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><b className="block truncate">НД-{permit.id.slice(-8).toUpperCase()}</b><span className="mt-1 block truncate text-muted-foreground">{item?.name || 'Установка'} · {crew?.site?.name || 'Объект не назначен'}</span></div><span className={cn('shrink-0 rounded px-2 py-1 text-3xs font-semibold', permit.state === 'APPROVED' ? 'bg-success/10 text-success-strong' : permit.state === 'PENDING_APPROVAL' ? 'bg-signal/10 text-signal-strong' : 'bg-muted text-muted-foreground')}>{PERMIT_STATE_LABEL[permit.state]}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-2xs"><span className="text-muted-foreground">Действует до<br /><b className="text-foreground">{formatDateTimeInTimezone(permit.validTo, props.bootstrap?.tenant.timezone)}</b></span><span className="text-muted-foreground">Готовность<br /><b className="text-signal-strong">{current?.score ?? '—'}%</b></span></div>
                {action && canAct && <Button type="button" variant="outline" className="mt-3 min-h-11 w-full text-xs" onClick={() => void runPermitAction(permit, action)}>{action === 'submit' ? 'Отправить' : action === 'approve' ? 'Согласовать' : 'Отозвать'}</Button>}
              </article>;
            })}
            {filteredPermits.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">По выбранным условиям наряды не найдены.</div>}
          </div>
        </section>
        <aside className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Ожидают согласования</h2><span className="text-xs text-muted-foreground">{pending}</span></div>
          <div className="mt-2 space-y-2">
            {awaitingApproval.slice(0, 3).map((permit, index) => {
              const canApprove = props.bootstrap?.capabilities.entities.permit.approveDispatcher
                || props.bootstrap?.capabilities.entities.permit.approveAdmin;
              return (
                <div key={permit.id} className={cn('rounded-lg border p-2.5', index === 0 ? 'border-signal bg-signal/5' : 'border-border')}>
                  <div className="text-xs font-bold">НД-{permit.id.slice(-8).toUpperCase()}</div>
                  <div className="mt-1 text-3xs text-muted-foreground">{props.equipment.find((item) => item.id === permit.equipmentId)?.name || 'Установка'} · {crewByEquipment.get(permit.equipmentId)?.site?.name || 'Объект не назначен'}</div>
                  <div className="mt-1 line-clamp-2 text-3xs text-signal-strong">{permit.risk === 'ELEVATED' ? 'Повышенный риск · требуется два согласования' : 'Ожидает решения диспетчера'}</div>
                  {/* Действие прямо в панели: раньше карточка только называла
                      наряд, а согласовывать приходилось идти в таблицу. */}
                  {canApprove && (
                    <Button
                      type="button"
                      className="mt-2 h-9 w-full bg-signal text-2xs text-white hover:bg-signal-strong"
                      onClick={() => void runPermitAction(permit, 'approve')}
                    >
                      Проверить и согласовать
                    </Button>
                  )}
                </div>
              );
            })}
            {awaitingApproval.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Нарядов на согласовании нет.</p>}
          </div>
          {/*
            Журнал строится из реальных решений (WorkPermitApproval: роль,
            решение, время). Раньше здесь стояли три постоянные строки —
            «Создан мастером», «Проверен инженером ОТ», «Ожидает диспетчера»,
            — но таких этапов в модели наряда нет вовсе: жизненный цикл это
            DRAFT → PENDING_APPROVAL → APPROVED, а подписи хранятся в
            approvals[]. Даты не показывались, потому что их неоткуда было
            взять: этапы были выдуманы.
          */}
          <div className="mt-3 border-t border-border pt-3">
            <h3 className="text-xs font-bold">Журнал согласования</h3>
            {journalPermit ? (
              <>
                <div className="mt-1 text-3xs text-muted-foreground">НД-{journalPermit.id.slice(-8).toUpperCase()}</div>
                <ol className="mt-2 space-y-2">
                  {journalPermit.approvals.length === 0 && (
                    <li className="text-3xs text-muted-foreground">Решений пока нет.</li>
                  )}
                  {journalPermit.approvals.map((approval) => {
                    // Аннулированное решение и решение по прежней версии наряда
                    // не подтверждают ничего — показываем это, а не галочку.
                    const current = approval.valid && approval.permitVersion === journalPermit.version;
                    return (
                      <li key={`${approval.role}-${approval.approvedAt}`} className="flex items-start gap-2">
                        {current
                          ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success-strong" />
                          : <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />}
                        <div className="min-w-0">
                          <div className={cn('text-3xs font-semibold', !current && 'text-muted-foreground')}>
                            {current ? 'Согласовано' : `Аннулировано (версия ${approval.permitVersion})`} · {handoverRoleLabel(approval.role)}
                          </div>
                          <div className="text-3xs text-muted-foreground">{formatDateTimeInTimezone(approval.approvedAt, props.bootstrap?.tenant.timezone)}</div>
                        </div>
                      </li>
                    );
                  })}
                  {journalPermit.state === 'PENDING_APPROVAL' && (
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full border-2 border-signal" />
                      <div className="text-3xs font-semibold text-signal-strong">
                        {journalPermit.risk === 'ELEVATED' && validApprovals < 2
                          ? `Ожидает ещё ${2 - validApprovals} решения (повышенный риск)`
                          : 'Ожидает решения диспетчера'}
                      </div>
                    </li>
                  )}
                </ol>
              </>
            ) : (
              <p className="mt-2 text-3xs text-muted-foreground">Выберите наряд, чтобы увидеть его решения.</p>
            )}
          </div>
        </aside>
      </div>
      {/*
        Полоса ролей описывает то, что действительно умеет код. Раньше первым
        стоял «Мастер: формирует условия, проверяет экипаж, прикладывает
        документы» — а у роли FOREMAN нет права `readiness.permit.edit` вовсе,
        и этапа «проверка мастером» в жизненном цикле наряда не существует.
        Реальный цикл: черновик → на согласовании → согласован, и подписи
        лежат в approvals[].
      */}
      <ProcessRoleStrip
        ariaLabel="Кто что делает с нарядом-допуском"
        roles={[
          { label: 'Инженер ОТ или механик', icon: 'inspection', tasks: ['Создаёт наряд-допуск', 'Описывает состав и границы работ', 'Отправляет на согласование'], tone: 'green' },
          { label: 'Диспетчер', icon: 'crew', tasks: ['Проверяет условия', 'Согласовывает наряд', 'Отказ фиксируется в журнале'], tone: 'blue' },
          { label: 'Администратор', icon: 'accepted', tasks: ['Второе решение при повышенном риске', 'Свой наряд согласовать нельзя', 'Отзыв прекращает действие'], tone: 'orange' },
        ]}
      />
      <CommandDialog
        open={command !== null}
        pending={commandPending}
        title={command?.action === 'submit' ? 'Отправить на согласование' : command?.action === 'approve' ? 'Согласовать наряд' : 'Отозвать наряд'}
        description={command ? `Версия ${command.permit.version} · риск ${command.permit.risk === 'ELEVATED' ? 'повышенный' : 'обычный'} · ${props.bootstrap?.tenant.timezone ?? 'Europe/Moscow'}` : ''}
        onClose={() => { setCommand(null); setCommandText(''); setCommandError(null); }}
        footer={<Button type="button" disabled={commandPending || (command?.action === 'revoke' && !commandText.trim())} onClick={() => command ? void runPermitAction(command.permit, command.action, true) : undefined} className="bg-signal-strong hover:bg-signal-strong">{commandPending ? 'Выполняется…' : 'Подтвердить действие'}</Button>}
      >
        <div className="space-y-3 text-sm">
          <p>{command?.action === 'approve' ? 'Решение попадёт в доказательный журнал и вызовет новый снимок готовности.' : command?.action === 'submit' ? 'После отправки содержание нельзя менять без сброса согласований.' : 'Отзыв немедленно прекращает действие наряда и может заблокировать запуск смены.'}</p>
          {command?.action === 'revoke' && (
            <label className="grid gap-1 font-medium">Причина отзыва
              <textarea value={commandText} onChange={(event) => setCommandText(event.target.value)} className="min-h-24 rounded-md border border-input bg-background p-3 font-normal" />
            </label>
          )}
          {commandError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive-strong">{commandError}</p>}
        </div>
      </CommandDialog>
    </>
  );
}
