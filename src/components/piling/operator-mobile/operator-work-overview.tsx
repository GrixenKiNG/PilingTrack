'use client';

import {useState, type ReactNode} from 'react';
import {Clock, Flag, TriangleAlert} from 'lucide-react';
import {PilingIcon, type PilingIconName} from '@/components/piling/icons';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {formatNumber} from '@/lib/format';
import './operator-concept.css';

export type WorkAction = 'PILES' | 'PASSPORT' | 'DRILLING' | 'DOWNTIME';
type Variant = 'base' | 'v2' | 'v5' | 'v7' | 'v10';

export function OperatorMachineHeader({state}: {state: OperatorMobileState}) {
  return <div className="oc-machine"><PilingIcon name="equipment-rig" size={40} decorative /><div><strong>{state.assignment?.equipmentName ?? 'Установка не назначена'}</strong><span>{state.assignment?.siteName ?? 'Площадка не назначена'}</span><small>{state.productionDate.split('-').reverse().join('.')}</small></div></div>;
}

/** One overview of server facts; actions delegate to each version's existing forms. */
export function OperatorWorkOverview({state, variant, busy, onAction, onFinish, onIncident, onDefect, children}: {
  state: OperatorMobileState; variant: Variant; busy?: boolean;
  onAction: (action: WorkAction) => void; onFinish: () => void;
  onIncident?: () => void; onDefect?: () => void; children?: ReactNode;
}) {
  const [allEntries, setAllEntries] = useState(false);
  const preparation = [
    {label: 'СИЗ и допуск', done: state.identity.ppe.confirmed && state.identity.ppe.missing.length === 0 && state.identity.briefing.ok && state.identity.knowledge.ok && state.identity.documents.every(d => !d.required || d.verdict === 'VALID' || d.verdict === 'EXPIRING')},
    ...(['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE'] as const).map((stage, i) => ({label: ['Осмотр машины', 'Площадка', 'Пуск'][i], done: state.checklists.some(c => c.stage === stage && c.done)})),
  ];
  const ready = state.phase === 'WORK' && state.permit.allowed && preparation.every(s => s.done);
  const minutes = Math.round(state.production.downtimeHours * 60);
  const entries = [...state.entries].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
  const status = <div className={`oc-status ${ready ? 'oc-ok' : 'oc-attention'}`}><PilingIcon name={ready ? 'check' : 'risk'} size={26} decorative /><div><strong>{ready ? 'К работе допущен' : 'Требуется проверка допуска'}</strong><span>{ready ? 'Подготовка завершена, замечаний по допуску нет.' : state.permit.blocks.map(b=>b.title).join(' · ') || 'Обязательные проверки ещё не завершены.'}</span></div></div>;
  const stats = <div className="oc-stats">{[
    {icon: 'pile-driving', label: 'Сваи', value: formatNumber(state.production.piles.count,0), unit: 'шт.', tone: 'pile'},
    {icon: 'drilling-auger', label: 'Бурение', value: formatNumber(state.production.drilling.meters,1), unit: 'м', tone: 'drill'},
    {icon: 'downtime', label: 'Простой', value: formatNumber(minutes,0), unit: 'мин', tone: 'pause'},
  ].map(m=><div className={`oc-stat oc-${m.tone}`} key={m.label}>{m.tone === 'pause' ? <Clock className="oc-symbol oc-clock" size={40} aria-hidden /> : <PilingIcon name={m.icon as PilingIconName} size={30} decorative />}<div><span>{m.label}</span><strong>{m.value}</strong><small>{m.unit}</small></div></div>)}</div>;
  const action = (kind: WorkAction, label: string, icon: PilingIconName, cls: string) => <button type="button" className={`oc-action ${cls}`} disabled={busy || (kind !== 'DOWNTIME' && !ready)} onClick={()=>onAction(kind)}>{kind === 'DOWNTIME' ? <Clock className="oc-symbol" size={32} aria-hidden /> : <PilingIcon name={icon} size={26} decorative />}<span>{label}</span></button>;
  const finish = <button type="button" className="oc-action oc-finish" disabled={busy} onClick={onFinish}><Flag className="oc-symbol" size={30} aria-hidden /><span>Завершить работу</span></button>;
  return <div className={`operator-concept oc-${variant}`}>
    <OperatorMachineHeader state={state} />
    {variant === 'v5' && <section className="oc-card oc-stages"><h2>Этапы смены</h2><ol>{['Допуск','Осмотр','Площадка','Работа','Итог'].map((label,i)=><li key={label} className={i<3&&preparation[i].done?'is-done':i===3?'is-current':''}><span>{i<3&&preparation[i].done?<PilingIcon name="check" size={16} decorative />:i+1}</span>{label}</li>)}</ol>{status}</section>}
    {variant !== 'v5' && <div className="oc-readiness">{status}</div>}
    <div className="oc-overview-stats">{stats}</div>
    <section className="oc-card oc-work"><h2>{variant === 'v5' ? 'Следующее действие' : variant === 'v2' ? 'Итоги смены' : 'Работа'}</h2>
      {variant==='v5'&&<p className="oc-caption">Запишите результат выполненной работы.</p>}
      <div className="oc-actions">
        {action('PILES',variant==='v10'?'Свая':'Добавить сваю','add','oc-primary')}
        {action('DRILLING',variant==='v10'?'Бурение':'Добавить бурение','drilling-auger','oc-drilling')}
        {action('DOWNTIME','Простой','downtime','oc-downtime')}
        {onIncident&&<button type="button" className="oc-action oc-incident" onClick={onIncident}><TriangleAlert className="oc-symbol" size={32} aria-hidden /><span>Инцидент</span></button>}
      </div>
      <div className="oc-additional"><button type="button" disabled={!ready||busy} onClick={()=>onAction('PASSPORT')}><PilingIcon name="documents" size={18} decorative />Свая с паспортом</button>{onDefect&&<button type="button" onClick={onDefect}><PilingIcon name="defect" size={18} decorative />Дефект</button>}</div>
      {children}
    </section>
    <section className="oc-card oc-preparation"><h2>Подготовка <small>{preparation.filter(s=>s.done).length} из 4</small></h2>{preparation.map(s=><div key={s.label}><PilingIcon name={s.done?'check':'inspection'} size={22} decorative /><span>{s.label}</span><small>{s.done?'Выполнено':'Ожидает'}</small></div>)}{finish}</section>
    <section className="oc-card oc-recent"><header><h2>Последние записи</h2>{entries.length>2&&<button type="button" onClick={()=>setAllEntries(!allEntries)}>{allEntries?'Свернуть':'Все записи'}<PilingIcon name="external" size={16} decorative /></button>}</header>
      {entries.length===0?<p className="oc-caption">За смену пока ничего не записано.</p>:(allEntries?entries:entries.slice(0,2)).map(e=><div className="oc-entry" key={e.id}><time>{new Date(e.occurredAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time><PilingIcon name={e.kind==='PILES'?'pile-driving':e.kind==='DRILLING'?'drilling-auger':'downtime'} size={26} decorative /><div><strong>{e.label}</strong><span>{e.kind==='DOWNTIME'?`${Math.round(e.value*60)} мин`:`${formatNumber(e.value,0)} шт. · ${formatNumber(e.meters??0,1)} м`}</span>{e.corrections.length>0&&<small>Есть поправки: {e.corrections.length}</small>}</div><span className="oc-saved"><PilingIcon name="check" size={15} decorative /><span>Сохранено</span></span></div>)}
    </section>
    <div className="oc-mobile-finish">{finish}</div>
  </div>;
}

