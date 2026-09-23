'use client';

import {useRouter} from 'next/navigation';
import {OperatorWorkOverview} from '../operator-work-overview';
import type {
  ChecklistStage, DefectView, DocumentVerdict, IncidentView, OperatorMobileState, ProductionPermit, WorkWarning,
} from '@/modules/operator-mobile/contracts';
import {
  CONDITION_LABELS, INCIDENT_CATEGORY_LABELS, PHASE_LABELS,
} from '@/modules/operator-mobile/contracts';
import {PHASE_CHECKLIST} from '@/modules/operator-mobile/domain/shift-phases';
import {
  DEFECT_SEVERITY_FIELD_LABELS, DEFECT_STATUS_FIELD_LABELS, isAlarmingSeverity,
} from '@/modules/operator-mobile/domain/defect-labels';
import {formatNumber, formatRuDate} from '@/lib/format';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import {Banner, Button, Card, CardBody, Chip, Empty, Metric, Pair, Row, type Tone} from './v7-ui';

/**
 * Обзорные экраны v7: что показывает каждая вкладка нижнего меню.
 *
 * Всё, что видно, пришло из `/api/operator/mobile/state` и вычислено сервером.
 * Нажатия отсюда только открывают шаг — саму команду отправляет оболочка, у
 * которой один на всех обработчик с ключом команды и очередью офлайна.
 */

/** Шаг, который открывает нажатие. Тип живёт здесь, чтобы обзор и оболочка
    не импортировали друг друга по кругу. */
export type Detour =
  | {kind: 'PPE'}
  | {kind: 'BRIEFING'}
  | {kind: 'KNOWLEDGE'}
  | {kind: 'ACCEPT'}
  | {kind: 'CHECKLIST'; stage: ChecklistStage}
  | {kind: 'PRODUCTION'; entry: 'PILES' | 'PASSPORT' | 'DRILLING' | 'DOWNTIME'}
  | {kind: 'INCIDENT'}
  | {kind: 'CLOSE'}
  | {kind: 'RESULT'};

/**
 * Смена одной строкой для человека.
 *
 * Состояние смены (`STARTED`, `HANDOVER_PENDING`) — внутренний код, машинисту
 * он ничего не говорит. Человеку важно другое: начата ли смена и когда.
 */
function shiftLine(shift: OperatorMobileState['shift']): string {
  if (!shift) return 'Смена не начата';
  if (!shift.startedAt) return 'Смена заведена, работа не начата';
  const started = new Date(shift.startedAt)
    .toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
  return `Начата в ${started}`;
}

/*
 * Ключи берём из типа контракта, а не пишем строками: тогда новый вердикт не
 * доедет до экрана безымянным — сборка не пройдёт, пока подпись не добавят.
 * (Написанная от руки карта уже подвела: она знала «OK», которого в контракте
 * нет, и машинист видел в чипе английское «VALID».)
 */
const DOCUMENT_LABEL: Record<DocumentVerdict, string> = {
  VALID: 'Действует', EXPIRING: 'Истекает', EXPIRED: 'Просрочен', MISSING: 'Не заведён',
};

const DOCUMENT_TONE: Record<DocumentVerdict, Tone> = {
  VALID: 'ok', EXPIRING: 'warn', EXPIRED: 'bad', MISSING: 'bad',
};

const WARNING_TONE: Record<string, Tone> = {STOP: 'bad', ALERT: 'bad', NOTE: 'warn'};

export function WarningsBlock({warnings}: {warnings: WorkWarning[]}) {
  return (
    <>
      {warnings.map((warning) => (
        <Banner
          key={warning.code}
          tone={WARNING_TONE[warning.level] ?? 'warn'}
          title={warning.title}
          note={warning.detail}
          action={warning.resolution}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------- главная --- */

export function HomeScreen({state, busy, onStep, onFinishWork}: {
  state: OperatorMobileState;
  busy: boolean;
  onStep: (detour: Detour) => void;
  onFinishWork: () => void;
}) {
  return (
    <>
      <WarningsBlock warnings={state.warnings} />
      {state.phase === 'IDENTITY' ? <IdentitySteps state={state} onStep={onStep} /> : null}
      {state.phase === 'ADMISSION' ? <AdmissionBlock state={state} onStep={onStep} /> : null}
      {state.phase === 'PRESHIFT_INSPECTION' || state.phase === 'STARTUP' || state.phase === 'SITE_READY'
        ? <StageBlock state={state} onStep={onStep} />
        : null}
      {state.phase === 'WORK'
        ? <WorkBlock state={state} busy={busy} onStep={onStep} onFinishWork={onFinishWork} />
        : null}
      {state.phase === 'CLOSING' ? <ClosingBlock state={state} onStep={onStep} /> : null}
      {state.phase === 'CLOSED' ? <ClosedBlock state={state} /> : null}
    </>
  );
}

function IdentitySteps({state, onStep}: {state: OperatorMobileState; onStep: (detour: Detour) => void}) {
  const {identity} = state;
  const steps: {detour: Detour; title: string; note: string; done: boolean}[] = [
    {
      detour: {kind: 'PPE'},
      title: 'СИЗ',
      note: identity.ppe.confirmed
        ? (identity.ppe.missing.length > 0 ? `Не хватает: ${identity.ppe.missing.join(', ')}` : 'Комплект полон')
        : 'Проверка средств индивидуальной защиты',
      done: identity.ppe.confirmed,
    },
    {
      detour: {kind: 'BRIEFING'},
      title: 'Ознакомление с инструкциями',
      note: identity.briefing.ok
        ? `${identity.briefing.title}, версия ${identity.briefing.version}`
        : 'Не выполнено',
      done: identity.briefing.ok,
    },
    {
      detour: {kind: 'KNOWLEDGE'},
      title: 'Проверка знаний по ТБ',
      note: identity.knowledge.ok
        ? `Действует до ${formatRuDate(identity.knowledge.validUntil)}`
        : (identity.knowledge.lastResult ?? 'Не выполнено'),
      done: identity.knowledge.ok,
    },
  ];
  const current = steps.findIndex((step) => !step.done);

  return (
    <>
      <Card title="Пройдите все шаги, чтобы получить доступ к работе">
        {steps.map((step, index) => (
          <Row
            key={step.title}
            state={step.done ? 'done' : (index === current ? 'now' : 'idle')}
            mark={step.done ? '✓' : index + 1}
            title={step.title}
            note={step.note}
            onClick={() => onStep(step.detour)}
          />
        ))}
        <Row
          state={steps.every((step) => step.done) ? 'done' : 'idle'}
          mark={steps.every((step) => step.done) ? '✓' : 4}
          title="Допуск к смене"
          note={steps.every((step) => step.done) ? 'Разрешён' : 'Ожидает'}
          onClick={() => onStep({kind: 'RESULT'})}
        />
      </Card>
      <Banner
        tone="info"
        title="Прохождение занимает 5–10 минут"
        note="Это важно для вашей безопасности и безопасности коллег"
      />
    </>
  );
}

function AdmissionBlock({state, onStep}: {state: OperatorMobileState; onStep: (detour: Detour) => void}) {
  return (
    <>
      <AssignmentCard state={state} />
      <WeatherCard state={state} />
      <Button onClick={() => onStep({kind: 'ACCEPT'})}>Принять установку</Button>
    </>
  );
}

function StageBlock({state, onStep}: {state: OperatorMobileState; onStep: (detour: Detour) => void}) {
  const stage = PHASE_CHECKLIST[state.phase];
  const checklist = stage ? state.checklists.find((item) => item.stage === stage) : undefined;
  return (
    <>
      <AssignmentCard state={state} />
      {checklist ? (
        <>
          <Card title={checklist.title}>
            <CardBody>
              <div className="pair">
                <span className="pl">{checklist.purpose}</span>
                <Chip tone={checklist.done ? 'ok' : 'warn'}>{checklist.done ? 'Сдан' : 'Не сдан'}</Chip>
              </div>
              <div className="note">
                Пунктов: {checklist.sections.reduce((sum, section) => sum + section.items.length, 0)}
                {' · '}версия {checklist.version}
              </div>
            </CardBody>
          </Card>
          <Button onClick={() => onStep({kind: 'CHECKLIST', stage: checklist.stage})}>
            {checklist.done ? 'Открыть чек-лист' : 'Пройти чек-лист'}
          </Button>
        </>
      ) : (
        <Empty>Чек-лист этого этапа не задан</Empty>
      )}
    </>
  );
}

function WorkBlock({state, busy, onStep, onFinishWork}: {
  state: OperatorMobileState;
  busy: boolean;
  onStep: (detour: Detour) => void;
  onFinishWork: () => void;
}) {
  return <OperatorWorkOverview state={state} variant="v7" busy={busy}
    onAction={(entry)=>onStep({kind: 'PRODUCTION', entry})}
    onIncident={()=>onStep({kind: 'INCIDENT'})} onFinish={onFinishWork} />;
}

function ClosingBlock({state, onStep}: {state: OperatorMobileState; onStep: (detour: Detour) => void}) {
  const after = state.checklists.find((item) => item.stage === 'EO_AFTER');
  return (
    <>
      <ProductionCard state={state} />
      {after ? (
        <>
          <Card title={after.title}>
            <CardBody>
              <div className="pair">
                <span className="pl">{after.purpose}</span>
                <Chip tone={after.done ? 'ok' : 'warn'}>{after.done ? 'Сдан' : 'Не сдан'}</Chip>
              </div>
            </CardBody>
          </Card>
          {!after.done ? (
            <Button onClick={() => onStep({kind: 'CHECKLIST', stage: 'EO_AFTER'})}>
              Послесменное обслуживание
            </Button>
          ) : null}
        </>
      ) : null}
      <Button tone="danger" onClick={() => onStep({kind: 'CLOSE'})}>Закрыть смену</Button>
    </>
  );
}

function ClosedBlock({state}: {state: OperatorMobileState}) {
  const {receipt} = state;
  return (
    <>
      <Card>
        <CardBody>
          <div className="seal" aria-hidden="true">✓</div>
          <div style={{textAlign: 'center', fontSize: 17, fontWeight: 800}}>Смена закрыта</div>
        </CardBody>
        {receipt ? (
          <CardBody>
            <div className="pairs">
              <Pair label="Отчёт" value={receipt.reportId} />
              <Pair label="Отправлен" value={formatRuDate(receipt.submittedAt) || '—'} />
              <Pair label="Закрыт" value={formatRuDate(receipt.closedAt) || '—'} />
            </div>
          </CardBody>
        ) : null}
      </Card>
      <ProductionCard state={state} />
    </>
  );
}

/* ------------------------------------------------------------ карточки --- */

function AssignmentCard({state}: {state: OperatorMobileState}) {
  const {assignment} = state;
  if (!assignment) {
    return (
      <Card title="Установка">
        <Empty>Установка за вами не закреплена</Empty>
      </Card>
    );
  }
  return (
    <Card title="Объект и установка">
      <CardBody>
        <div className="pairs">
          <Pair label="Объект" value={assignment.siteName} />
          <Pair label="Установка" value={`${assignment.equipmentName} · ${assignment.equipmentModel}`} />
          <Pair
            label="Оснастка"
            value={[assignment.hasHammer ? 'молот' : null, assignment.hasRotator ? 'вращатель' : null]
              .filter(Boolean).join(', ') || '—'}
          />
          <Pair label="Помощники" value={assignment.assistants.join(', ') || '—'} />
          <Pair
            label="Топливо на конец прошлой смены"
            value={assignment.fuelPercent === null ? '—' : `${assignment.fuelPercent} %`}
          />
          <Pair
            label="Счётчик моточасов"
            value={assignment.lastMeter
              ? `${formatNumber(assignment.lastMeter.engineHours)} ч · ${formatRuDate(assignment.lastMeter.recordedAt)}`
              : '—'}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function WeatherCard({state}: {state: OperatorMobileState}) {
  const {weather} = state;
  return (
    <Card title="Погода и условия">
      <CardBody>
        {weather ? (
          <div className="pairs">
            <Pair label="Температура" value={weather.temperatureC === null ? '—' : `${formatNumber(weather.temperatureC)} °C`} />
            <Pair label="Ветер" value={weather.windMs === null ? '—' : `${formatNumber(weather.windMs)} м/с`} />
            <Pair
              label="Осадки"
              value={weather.precipitationMmPerHour === null ? '—' : `${formatNumber(weather.precipitationMmPerHour)} мм/ч`}
            />
          </div>
        ) : (
          <div className="note">Погода недоступна — координаты не переданы</div>
        )}
        {state.conditions.length > 0 ? (
          <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
            {state.conditions.map((condition) => (
              <Chip key={condition} tone="info">{CONDITION_LABELS[condition]}</Chip>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ProductionCard({state}: {state: OperatorMobileState}) {
  const {production} = state;
  return (
    <Card title="Выработка смены">
      <CardBody>
        <div className="metrics">
          <Metric value={production.piles.count} label="свай" extra={`${formatNumber(production.piles.meters)} м.п.`} />
          <Metric value={production.drilling.count} label="скважин" extra={`${formatNumber(production.drilling.meters)} м.п.`} />
          <Metric value={formatDowntimeHours(production.downtimeHours)} label="простой" />
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Запрет на работу. Отличается от предупреждения тем, что за ним стоит отказ
 * сервера, а не цвет: см. `domain/production-permit.ts`. Последняя строка обязательна
 * — без неё человек бросает вместе с работой и запись о простое.
 */
function PermitBanner({permit}: {permit: ProductionPermit}) {
  if (permit.allowed) return null;
  return (
    <Banner
      tone="bad"
      title="Работа запрещена"
      note={`${permit.blocks.map((block) => `${block.title}. ${block.resolution}`).join(' ')} Простой, происшествие и отчёт записываются как обычно.`}
    />
  );
}

/* ------------------------------------------------------------ вкладки --- */

export function TasksScreen({state, onEntry}: {
  state: OperatorMobileState;
  onEntry: (entry: 'PILES' | 'PASSPORT' | 'DRILLING' | 'DOWNTIME') => void;
}) {
  const started = state.phase === 'WORK' || state.phase === 'CLOSING';
  const forbidden = !state.permit.allowed;
  return (
    <>
      <ProductionCard state={state} />
      <PermitBanner permit={state.permit} />
      {started ? (
        <>
          <Button tone="soft" disabled={forbidden} onClick={() => onEntry('PILES')}>Записать забивку свай</Button>
          <Button tone="soft" disabled={forbidden} onClick={() => onEntry('PASSPORT')}>Свая с паспортом</Button>
          <Button tone="soft" disabled={forbidden} onClick={() => onEntry('DRILLING')}>Записать бурение</Button>
          <Button tone="ghost" onClick={() => onEntry('DOWNTIME')}>Записать простой</Button>
        </>
      ) : (
        <Banner
          tone="info"
          title="Учёт откроется после допуска и осмотра"
          note={`Сейчас: ${PHASE_LABELS[state.phase]}`}
        />
      )}
      {state.assignment ? (
        <Card title="Объект за всё время">
          <CardBody>
            <div className="metrics">
              <Metric value={state.assignment.sitePiles.count} label="свай" extra={`${formatNumber(state.assignment.sitePiles.meters)} м.п.`} />
              <Metric value={state.assignment.siteDrilling.count} label="скважин" extra={`${formatNumber(state.assignment.siteDrilling.meters)} м.п.`} />
              <Metric value={formatDowntimeHours(state.assignment.siteDowntimeHours)} label="простой" />
            </div>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}

const ENTRY_UNIT: Record<string, string> = {PILES: 'шт.', DRILLING: 'шт.', DOWNTIME: 'ч'};

export function JournalScreen({state}: {state: OperatorMobileState}) {
  return (
    <Card title="Записи смены">
      {state.entries.length === 0
        ? <Empty>За смену записей ещё нет</Empty>
        : state.entries.map((entry) => (
          <Row
            key={entry.id}
            title={entry.label}
            note={[
              entry.meters === null ? null : `${formatNumber(entry.meters)} м.п.`,
              entry.corrections.length > 0 ? `поправок: ${entry.corrections.length}` : null,
            ].filter(Boolean).join(' · ') || undefined}
            chip={(
              <Chip tone={entry.kind === 'DOWNTIME' ? 'warn' : 'info'}>
                {entry.kind === 'DOWNTIME'
                  ? formatDowntimeHours(entry.value)
                  : `${formatNumber(entry.value)} ${ENTRY_UNIT[entry.kind] ?? ''}`}
              </Chip>
            )}
          />
        ))}
    </Card>
  );
}

export function EquipmentScreen({defects}: {defects: DefectView[]}) {
  return (
    <Card title="Открытые неисправности">
      {defects.length === 0
        ? <Empty>Открытых неисправностей нет</Empty>
        : defects.map((defect) => (
          <Row
            key={defect.id}
            title={defect.title}
            note={[
              DEFECT_SEVERITY_FIELD_LABELS[defect.severity] ?? defect.severity,
              defect.reportedByMe ? 'записали вы' : defect.reportedByName,
              formatRuDate(defect.reportedAt),
            ].join(' · ')}
            chip={(
              <Chip tone={isAlarmingSeverity(defect.severity) ? 'bad' : 'warn'}>
                {DEFECT_STATUS_FIELD_LABELS[defect.status] ?? defect.status}
              </Chip>
            )}
          />
        ))}
    </Card>
  );
}

export function IncidentsScreen({incidents}: {incidents: IncidentView[]}) {
  return (
    <Card title="Происшествия смены">
      {incidents.length === 0
        ? <Empty>Происшествий не записано</Empty>
        : incidents.map((incident) => (
          <Row
            key={incident.id}
            title={incident.description}
            note={[
              INCIDENT_CATEGORY_LABELS[incident.category] ?? incident.category,
              formatRuDate(incident.occurredAt),
              incident.photos > 0 ? `фото: ${incident.photos}` : null,
            ].filter(Boolean).join(' · ')}
            chip={(
              <Chip tone={incident.injured || incident.stopRequired ? 'bad' : 'warn'}>
                {incident.reviewedAt ? 'Разобрано' : 'На виду'}
              </Chip>
            )}
          />
        ))}
    </Card>
  );
}

export function MoreScreen({state, onResult}: {state: OperatorMobileState; onResult: () => void}) {
  const router = useRouter();
  return (
    <>
      <Card title="Оператор">
        <CardBody>
          <div className="pairs">
            <Pair label="Имя" value={state.operator.name} />
            <Pair label="Производственные сутки" value={formatRuDate(state.productionDate)} />
            <Pair label="Фаза смены" value={PHASE_LABELS[state.phase]} />
            <Pair label="Смена" value={shiftLine(state.shift)} />
          </div>
        </CardBody>
        <Row title="Итог допуска" note="Сводка по всем шагам" onClick={onResult} />
      </Card>

      <Card title="Документы">
        {state.identity.documents.length === 0
          ? <Empty>Документы не заведены</Empty>
          : state.identity.documents.map((document) => (
            <Row
              key={document.typeId}
              title={document.name}
              note={[
                document.number ? `№ ${document.number}` : null,
                document.expiresAt ? `до ${formatRuDate(String(document.expiresAt))}` : 'бессрочный',
              ].filter(Boolean).join(' · ')}
              chip={<Chip tone={DOCUMENT_TONE[document.verdict]}>{DOCUMENT_LABEL[document.verdict]}</Chip>}
            />
          ))}
      </Card>

      <Card title="Другие разделы">
        <Row
          title="История смен"
          note="Ваши отчёты за прошлые дни"
          onClick={() => router.push('/operator/v7/history')}
        />
        <Row
          title="ТБ и допуски"
          note="Инструктажи и документы — настольный раздел"
          onClick={() => router.push('/admin/safety')}
        />
      </Card>

      <Button tone="ghost" onClick={() => router.push('/operator')}>
        Рабочий экран машиниста
      </Button>
    </>
  );
}
