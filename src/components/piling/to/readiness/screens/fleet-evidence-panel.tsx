'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight } from '@/components/piling/icons/unified-icons';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { Button } from '@/components/ui/button';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { fetchReadinessDefects } from '../api/client';
import type { DefectDto } from '../api/contracts';
import { EquipmentPhoto } from './shared';
import type { ReferenceUiProps } from './types';
import type { FleetGroup, FleetItem } from './fleet-workspace-model';

const SECTIONS = { basis: 'Основания оценки', inspection: 'Осмотры', maintenance: 'Обслуживание', defects: 'Дефекты', documents: 'Документы' } as const;
type Section = keyof typeof SECTIONS;
/** Те же значки, что у соответствующих разделов модуля: осмотр, ТО, дефект, документы. */
const SECTION_ICON: Record<Section, PilingIconName> = {
  basis: 'technical-readiness', inspection: 'inspection', maintenance: 'repair',
  defects: 'defect', documents: 'documents',
};
const GROUP_ICON: Record<FleetGroup, PilingIconName> = {
  ready: 'accepted', attention: 'maintenance-due', blocked: 'defect', unknown: 'risk',
};
const RECORD_STATUS: Record<string, string> = {
  COMPLETED: 'Завершён', IN_PROGRESS: 'В работе', DRAFT: 'Черновик', PLANNED: 'Запланировано',
  ASSIGNED: 'Назначено', ON_HOLD: 'Приостановлено', DONE: 'Выполнено', CANCELLED: 'Отменено',
  OPEN: 'Открыт', IN_WORK: 'В работе', CLOSED: 'Закрыт', REJECTED: 'Отклонён',
};
const SEVERITY: Record<string, string> = { CRITICAL: 'Критический', HIGH: 'Высокий', NORMAL: 'Обычный', LOW: 'Низкий' };

export function FleetSourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer"
    className="inline-flex min-h-11 items-center gap-2 rounded px-1 text-sm font-semibold text-signal-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-signal">
    {children}<span aria-hidden="true">↗</span><span className="sr-only"> (в новой вкладке)</span>
  </a>;
}

export function FleetEvidencePanel({ item, props }: { item: FleetItem; props: ReferenceUiProps }) {
  const [section, setSection] = useState<Section>('basis');
  const [defectResult, setDefectResult] = useState<{ id: string; data?: DefectDto[]; error?: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { equipment, presentation, snapshot } = item;
  const detail = props.details[equipment.id];
  const timezone = props.bootstrap?.tenant.timezone ?? 'Europe/Moscow';
  const cardUnavailable = props.outOfRoleSources.includes('Карточка установки');
  const maintenanceUnavailable = props.outOfRoleSources.includes('Обслуживание и журнал ТО');
  const detailError = props.workspaceIssues.find((issue) => issue.source === `Карточка «${equipment.name}»`);
  const maintenanceError = props.workspaceIssues.find((issue) => issue.source === 'Обслуживание');
  const records = props.maintenance.filter((record) => record.equipment?.id === equipment.id);
  const inspectionEvidence = presentation.evidence.find((evidence) => evidence.key === 'inspection');
  const inspection = detail?.latestInspection;
  const date = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value))
    ? formatDateTimeInTimezone(value, timezone) : 'Дата не указана';

  useEffect(() => {
    if (section !== 'defects') return;
    const controller = new AbortController();
    void fetchReadinessDefects(controller.signal, { equipmentId: equipment.id }).then(
      (data) => { if (!controller.signal.aborted) setDefectResult({ id: equipment.id, data: data.filter((record) => record.equipmentId === equipment.id) }); },
      (error: unknown) => { if (!controller.signal.aborted) setDefectResult({ id: equipment.id, error: error instanceof Error ? error.message : 'Не удалось загрузить дефекты' }); },
    );
    return () => controller.abort();
  }, [equipment.id, section]);

  const chooseSection = (next: Section) => {
    setSection(next);
    requestAnimationFrame(() => headingRef.current?.focus());
  };
  const sourceLinks = (key: string) => presentation.evidence.find((evidence) => evidence.key === key)?.links?.filter(
    // A register URL is not a specific source. Keep such references visible without a misleading jump.
    (link) => !link.href.startsWith('/admin/to?'),
  ) ?? [];
  const missingDetail = <div role="status" className="rounded-lg bg-muted p-3 text-sm leading-relaxed">
    {cardUnavailable ? 'Текущей роли недоступна карточка установки.' : detailError?.message || 'Подробности установки ещё не получены. Отсутствие ответа не означает отсутствие записей.'}
    {!cardUnavailable && <Button variant="outline" className="mt-2 w-full" onClick={props.onRetry} disabled={props.loading}>Повторить загрузку</Button>}
  </div>;

  return <aside aria-label={`Подробности ${equipment.name}`} className="min-w-0 rounded-xl border border-border bg-card">
    <div className="border-b border-border p-4">
      <p className="text-xs font-medium text-muted-foreground">Выбрана установка</p>
      {/*
        Фото повторяет строку списка: панель и строка обязаны читаться как одна
        и та же машина. Без снимка в панели связь между выбором слева и
        разбором справа держалась только на совпадении названия.
      */}
      <div className="mt-1 flex min-w-0 items-start gap-3">
        <EquipmentPhoto cardData={item.fleet} name={equipment.name} className="h-16 w-16 shrink-0 rounded-lg" />
        <div className="min-w-0">
          <h2 className="text-xl font-bold">{equipment.name}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><PilingIcon name="site" size={14} decorative />{item.site}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><PilingIcon name="crew" size={14} decorative />{item.fleet?.assignedCrewName || 'Экипаж не назначен'}</p>
        </div>
      </div>
      <p className={cn('mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold',
        item.group === 'ready' ? 'border-success/20 bg-success/10 text-success-strong'
          : item.group === 'blocked' ? 'border-destructive/20 bg-destructive/10 text-destructive-strong'
            : item.group === 'unknown' ? 'border-border bg-muted text-muted-foreground'
              : 'border-warning/20 bg-warning/10 text-warning-strong')}>
        <PilingIcon name={GROUP_ICON[item.group]} size={18} decorative />{presentation.title}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <PilingIcon name="history" size={14} decorative />Оценка: {date(presentation.calculatedAt)} · {timezone}
      </p>
    </div>
    <div className="p-4">
      {section !== 'basis' && <Button variant="ghost" className="mb-2 min-h-11 px-0 text-signal-strong" onClick={() => chooseSection('basis')}>← К основаниям оценки</Button>}
      <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-bold focus-visible:outline-2 focus-visible:outline-signal">
        <PilingIcon name={SECTION_ICON[section]} size={18} decorative />{SECTIONS[section]}
      </h3>
      {section === 'basis' && <>
        <p className="mt-2 text-sm leading-relaxed">{presentation.description}</p>
        {(presentation.blockers.length > 0 || presentation.warnings.length > 0) && <ul className="mt-3 space-y-2 text-sm">
          {presentation.blockers.map((notice, index) => <li key={`block-${index}`} className="flex gap-2 rounded-lg bg-destructive/10 p-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-strong" /><span>{notice.label}</span></li>)}
          {presentation.warnings.map((notice, index) => <li key={`warning-${index}`} className="flex gap-2 rounded-lg bg-signal/10 p-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-strong" /><span>{notice.label}</span></li>)}
        </ul>}
        <p className="mb-2 mt-4 text-xs font-semibold text-muted-foreground">Факты на момент оценки</p><p className="mb-3 text-xs leading-relaxed text-muted-foreground">Незавершённый пункт не всегда блокирует работу: это зависит от действующих правил оценки.</p>
        <div className="divide-y divide-border rounded-lg border border-border">
          {presentation.stages.map((stage) => <details key={stage.key} className="group px-3">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-signal">
              {stage.state === 'pass' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success-strong" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-signal-strong" />}
              <span className="min-w-0 flex-1"><span className="block font-semibold">{stage.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{stage.value}</span></span>
              <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
            </summary>
            <div className="pb-3 text-sm leading-relaxed">
              {stage.key === 'INSPECTION' && <>{inspectionEvidence
                ? <><p>{inspectionEvidence.label}. Запись: <span className="break-all text-xs">{inspectionEvidence.reference}</span></p>
                    {sourceLinks('inspection').map((link) => <FleetSourceLink key={link.href} href={link.href}>{link.text}</FleetSourceLink>)}
                    {sourceLinks('inspection').length === 0 && <p className="mt-2 text-muted-foreground">Подробная запись этого источника пока недоступна. Здесь показаны сведения, сохранённые при оценке.</p>}</>
                : <p className="text-muted-foreground">Ссылка на осмотр не сохранена в этой оценке.</p>}</>}
              {stage.key === 'ENGINE_HOURS' && <p>Оценка сохраняет наличие показаний. Текущая наработка: {equipment.engineHoursTotal?.toLocaleString('ru-RU') ?? 'не получена'} ч. Эти данные могли обновиться после оценки.</p>}
              {stage.key === 'PERMIT' && <>{presentation.evidence.find((evidence) => evidence.key === 'permit')
                ? <p>Наряд: <span className="break-all text-xs">{presentation.evidence.find((evidence) => evidence.key === 'permit')?.reference}</span>. {props.permits.find((permit) => permit.id === presentation.evidence.find((evidence) => evidence.key === 'permit')?.reference)?.title || 'Подробности наряда не получены в текущей выборке.'}</p>
                : <p>Отдельный наряд не указан в доказательствах этой оценки.</p>}</>}
              {stage.key === 'MAINTENANCE' && <>{sourceLinks('maintenance').length
                ? sourceLinks('maintenance').map((link) => <div key={link.href}><FleetSourceLink href={link.href}>{link.text}</FleetSourceLink></div>)
                : <p>Отдельные записи ТО не указаны в оценке. Регламент и текущие записи доступны ниже.</p>}</>}
              {stage.key === 'ACCEPTANCE' && <p>Приёмка отражена в сохранённой оценке. Для проверки и выполнения процесса откройте центр готовности выбранной установки.</p>}
            </div>
          </details>)}
        </div>
        <details className="mt-3 rounded-lg bg-muted/50 p-3 text-xs">
          <summary className="min-h-8 cursor-pointer font-semibold">Как читать оценку</summary>
          <p className="mt-2 leading-relaxed">Балл: {presentation.score == null ? 'не подтверждён' : `${presentation.score}/100`}. Это показатель расчёта, а не процент допущенных машин. Решение определяется правилами, блокировками и замечаниями.</p>
          <p className="mt-2">Правила: {presentation.ruleSetVersion ?? 'не получены'}</p>
          <p className="mt-2">Оценка относится к указанному времени и не заменяет проверку текущей смены.</p>
        </details>
        <Button className="mt-3 min-h-11 w-full" variant="outline" onClick={() => props.onViewChange('readiness')}>Открыть центр готовности <ArrowRight className="ml-2 h-4 w-4" /></Button>
        <h3 className="mb-2 mt-5 text-sm font-bold">Текущие записи установки</h3>
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">Могли измениться после оценки. Открываются в этой панели.</p>
        <div className="grid grid-cols-2 gap-2">
          {(['inspection', 'maintenance', 'defects', 'documents'] as const).map((key) => <Button key={key} variant="outline" className="min-h-11 justify-start gap-2 whitespace-normal" onClick={() => chooseSection(key)}>
            <PilingIcon name={SECTION_ICON[key]} size={16} decorative />{SECTIONS[key]}
          </Button>)}
        </div>
      </>}
      {section === 'inspection' && <div className="mt-3 space-y-3 text-sm">
        <p className="text-muted-foreground">Последний осмотр в карточке установки. Он может отличаться от источника сохранённой оценки.</p>
        {!detail ? missingDetail : inspection ? <>
          <div className="rounded-lg border border-border p-3">
            <p className="font-semibold">{RECORD_STATUS[inspection.status] ?? inspection.status}</p>
            <p className="mt-2">{date(inspection.inspectionDate)}</p>
            <p className="mt-2">Заполнено пунктов: {inspection.itemsAnswered} из {inspection.itemsTotal}</p>
            <p className="mt-2 text-xs text-muted-foreground">Заполнение пунктов само по себе не подтверждает допуск.</p>
            {inspectionEvidence && inspectionEvidence.reference !== inspection.id && <p className="mt-2 rounded bg-signal/10 p-2">Это другая запись, не источник выбранной оценки.</p>}
            <FleetSourceLink href={`/inspections/${inspection.id}`}>Открыть этот осмотр</FleetSourceLink>
          </div>
        </> : <p className="rounded-lg bg-muted p-3">В карточке установки нет осмотров.</p>}
      </div>}
      {section === 'maintenance' && <div className="mt-3 space-y-3 text-sm">
        {!detail ? missingDetail : <div className="rounded-lg bg-muted p-3">
          <p>Наработка: {equipment.engineHoursTotal?.toLocaleString('ru-RU') ?? 'не получена'} ч</p>
          <p className="mt-2">Следующее ТО: {detail.equipment?.nextMaintenanceAtHours?.toLocaleString('ru-RU') ?? 'не задано'} ч</p>
          <p className="mt-2">По дате: {date(detail.equipment?.nextMaintenanceDate)}</p>
        </div>}
        {maintenanceUnavailable ? <p>Журнал ТО недоступен текущей роли.</p> : maintenanceError ? <p role="alert">{maintenanceError.message}</p> : records.length ? records.map((record) => <article key={record.id} className="rounded-lg border border-border p-3">
          <p className="font-semibold">{record.title}</p><p className="mt-1">{RECORD_STATUS[record.status] ?? record.status}</p>
          <p className="mt-1 text-xs text-muted-foreground">Создано: {date(record.createdAt)}</p>
          <FleetSourceLink href={`/admin/maintenance/${record.id}`}>Открыть эту запись</FleetSourceLink>
        </article>) : <p className="rounded-lg bg-muted p-3">В загруженном журнале нет записей для этой установки.</p>}
      </div>}
      {section === 'defects' && <div className="mt-3 space-y-3 text-sm">
        <p className="text-muted-foreground">Дефекты {equipment.name}. Блокирующие условия готовности показываются отдельно в основаниях оценки.</p>
        {defectResult?.id !== equipment.id ? <p role="status">Загружаем журнал дефектов…</p> : defectResult.error
          ? <div role="alert"><p>{defectResult.error}</p><Button variant="outline" className="mt-2" onClick={() => chooseSection('basis')}>Вернуться к основаниям</Button></div>
          : defectResult.data?.length ? defectResult.data.map((defect) => <article key={defect.id} className="rounded-lg border border-border p-3">
            <p className="font-semibold">{defect.title}</p>
            <p className="mt-1">{RECORD_STATUS[defect.status]} · {SEVERITY[defect.severity]}</p>
            <p className="mt-2 whitespace-pre-wrap">{defect.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">Сообщено: {date(defect.reportedAt)}</p>
            {defect.resolution && <p className="mt-2">Устранение: {defect.resolution}</p>}
            {defect.maintenanceRecordId && <FleetSourceLink href={`/admin/maintenance/${defect.maintenanceRecordId}`}>Связанная запись ТО</FleetSourceLink>}
          </article>) : <p className="rounded-lg bg-muted p-3">В ответе журнала нет дефектов этой установки.</p>}
        {snapshot?.facts?.criticalDefect && <p className="rounded-lg bg-destructive/10 p-3">На момент оценки зафиксирован критический дефект. Текущий журнал не отменяет сохранённый факт.</p>}
      </div>}
      {section === 'documents' && <div className="mt-3 space-y-3 text-sm">
        {!detail ? missingDetail : detail.documents === undefined ? <p>Сведения о документах не получены.</p>
          : detail.documents.length ? detail.documents.map((document) => <article key={document.id} className="rounded-lg border border-border p-3">
            <p className="font-semibold">{document.title || document.name || 'Документ установки'}</p>
            <p className="mt-2">Срок действия: {document.expiresAt ? date(document.expiresAt) : 'не указан'}</p>
          </article>) : <p className="rounded-lg bg-muted p-3">Документы не загружены. Это не подтверждает их наличие или действительность.</p>}
        {!cardUnavailable && <FleetSourceLink href={`/admin/equipment/${equipment.id}#documents`}>Открыть документы в карточке</FleetSourceLink>}
      </div>}
    </div>
    <div className="border-t border-border px-4 py-2">
      {!cardUnavailable && <FleetSourceLink href={`/admin/equipment/${equipment.id}`}>Паспорт и история установки</FleetSourceLink>}
      <p className="pb-2 text-xs leading-relaxed text-muted-foreground">Оригиналы открываются в новой вкладке. Выбор установки и фильтры остаются здесь.</p>
    </div>
  </aside>;
}
