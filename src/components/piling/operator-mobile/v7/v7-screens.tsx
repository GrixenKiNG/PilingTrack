'use client';

import type {
  ChecklistView, DefectView, DocumentVerdict, IncidentView, OperatorMobileState, WorkWarning,
} from '@/modules/operator-mobile/contracts';
import {CONDITION_LABELS, PHASE_LABELS} from '@/modules/operator-mobile/contracts';
import {
  DEFECT_SEVERITY_FIELD_LABELS, DEFECT_STATUS_FIELD_LABELS, isAlarmingSeverity,
} from '@/modules/operator-mobile/domain/defect-labels';
import {formatHours, formatNumber, formatRuDate} from '@/lib/format';
import {Banner, Card, CardBody, Chip, Empty, Metric, Pair, Row, type Tone} from './v7-ui';

/**
 * Экраны v7 по фазам смены.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Это витрина живого состояния: всё, что видно на
 * экране, пришло из `/api/operator/mobile/state` и вычислено сервером — фаза,
 * допуск, чек-листы, выработка, предупреждения. Действий здесь нет ни одного:
 * команды смены (приём установки, сдача чек-листа, учёт выработки, закрытие)
 * живут в рабочем контуре `/operator` вместе с очередью офлайна и защитой от
 * двойного нажатия. Второй набор кнопок к тем же командам означал бы два места,
 * где можно испортить смену, — поэтому v7 показывает, но не меняет.
 */

/**
 * Смена одной строкой для человека.
 *
 * Состояние смены (`STARTED`, `HANDOVER_PENDING`) — внутренний код, машинисту
 * он ничего не говорит. Человеку важно другое: начата ли смена и когда. Своего
 * словаря кодов здесь нет намеренно: он был бы вторым рядом с тем, что уже
 * ведёт контур техготовности, и они бы разошлись.
 */
function shiftLine(shift: OperatorMobileState['shift']): string {
  if (!shift) return 'Смена не начата';
  if (!shift.startedAt) return 'Смена заведена, работа не начата';
  const started = new Date(shift.startedAt)
    .toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
  return `Начата в ${started}`;
}

/* ------------------------------------------------------------- допуск --- */

/*
 * Ключи берём из типа контракта, а не пишем строками: тогда новый вердикт не
 * доедет до экрана безымянным — сборка не пройдёт, пока подпись не добавят.
 * (Написанная от руки карта уже подвела: она знала «OK», которого в контракте
 * нет, и машинист видел в чипе английское «VALID».)
 */
const DOCUMENT_LABEL: Record<DocumentVerdict, string> = {
  VALID: 'Действует',
  EXPIRING: 'Истекает',
  EXPIRED: 'Просрочен',
  MISSING: 'Не заведён',
};

const DOCUMENT_TONE: Record<DocumentVerdict, Tone> = {
  VALID: 'ok',
  EXPIRING: 'warn',
  EXPIRED: 'bad',
  MISSING: 'bad',
};

export function IdentityScreen({state}: {state: OperatorMobileState}) {
  const {identity} = state;
  const steps = [
    {
      title: 'СИЗ',
      note: identity.ppe.confirmed
        ? (identity.ppe.missing.length > 0
          ? `Не хватает: ${identity.ppe.missing.join(', ')}`
          : 'Комплект полон')
        : 'Проверка средств индивидуальной защиты',
      done: identity.ppe.confirmed,
    },
    {
      title: 'Ознакомление с инструкцией',
      note: identity.briefing.ok
        ? `${identity.briefing.title}, версия ${identity.briefing.version}`
        : 'Не выполнено',
      done: identity.briefing.ok,
    },
    {
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
      <Card title="Перед сменой">
        {steps.map((step, index) => (
          <Row
            key={step.title}
            state={step.done ? 'done' : (index === current ? 'now' : 'idle')}
            mark={step.done ? '✓' : index + 1}
            title={step.title}
            note={step.note}
          />
        ))}
      </Card>

      <Card title="Документы">
        {identity.documents.length === 0
          ? <Empty>Документы не заведены</Empty>
          : identity.documents.map((document) => (
            <Row
              key={document.typeId}
              title={document.name}
              note={[
                document.number ? `№ ${document.number}` : null,
                document.expiresAt ? `до ${formatRuDate(String(document.expiresAt))}` : 'бессрочный',
              ].filter(Boolean).join(' · ')}
              chip={(
                <Chip tone={DOCUMENT_TONE[document.verdict]}>
                  {DOCUMENT_LABEL[document.verdict]}
                </Chip>
              )}
            />
          ))}
      </Card>

      <Banner
        tone="info"
        title="Допуск оформляется в рабочем экране"
        note="Здесь видно состояние допуска на эти производственные сутки."
        action="Пройти шаги — на экране «Смена машиниста»"
      />
    </>
  );
}

/* ---------------------------------------------------------- приём/объект --- */

export function AdmissionScreen({state}: {state: OperatorMobileState}) {
  const {assignment, weather} = state;
  if (!assignment) {
    return (
      <>
        <Empty>Установка за вами не закреплена</Empty>
        {state.options.length > 0 ? (
          <Card title="Доступные установки">
            {state.options.map((option) => (
              <Row key={option.equipmentId} title={option.equipmentName} note={option.siteName} />
            ))}
          </Card>
        ) : null}
      </>
    );
  }

  return (
    <>
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

      <Card title="Объект за всё время">
        <CardBody>
          <div className="metrics">
            <Metric
              value={assignment.sitePiles.count}
              label="свай"
              extra={`${formatNumber(assignment.sitePiles.meters)} м.п.`}
            />
            <Metric
              value={assignment.siteDrilling.count}
              label="скважин"
              extra={`${formatNumber(assignment.siteDrilling.meters)} м.п.`}
            />
            <Metric value={formatHours(assignment.siteDowntimeHours)} label="простой" />
          </div>
        </CardBody>
      </Card>

      <Card title="Погода и условия">
        <CardBody>
          {weather ? (
            <div className="pairs">
              <Pair
                label="Температура"
                value={weather.temperatureC === null ? '—' : `${formatNumber(weather.temperatureC)} °C`}
              />
              <Pair
                label="Ветер"
                value={weather.windMs === null ? '—' : `${formatNumber(weather.windMs)} м/с`}
              />
              <Pair
                label="Осадки"
                value={weather.precipitationMmPerHour === null
                  ? '—'
                  : `${formatNumber(weather.precipitationMmPerHour)} мм/ч`}
              />
            </div>
          ) : (
            <Empty>Погода недоступна — координаты не переданы</Empty>
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
    </>
  );
}

/* ------------------------------------------------------------ чек-листы --- */

export function ChecklistsScreen({checklists}: {checklists: ChecklistView[]}) {
  if (checklists.length === 0) return <Empty>Чек-листы этой фазы не заданы</Empty>;
  return (
    <>
      {checklists.map((checklist) => (
        <Card key={checklist.stage} title={checklist.title}>
          <CardBody>
            <div className="pair">
              <span className="pl">{checklist.purpose}</span>
              <Chip tone={checklist.done ? 'ok' : 'warn'}>{checklist.done ? 'Сдан' : 'Не сдан'}</Chip>
            </div>
          </CardBody>
          {checklist.sections.map((section) => (
            <div className="sect" key={section.id}>
              <div className="sh">{section.title}</div>
              {section.items.map((item) => (
                <div className={`item ${item.severity === 'ALERT' ? 'alert' : ''}`} key={item.id}>
                  <span className="bul" />
                  <span>
                    <span className="it">{item.text}</span>
                    {item.hint ? <span className="ih">{item.hint}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}

/* --------------------------------------------------------------- работа --- */

const WARNING_TONE: Record<string, Tone> = {STOP: 'bad', ALERT: 'bad', NOTE: 'warn'};

export function WarningsBlock({warnings}: {warnings: WorkWarning[]}) {
  if (warnings.length === 0) return null;
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

const ENTRY_UNIT: Record<string, string> = {PILES: 'шт.', DRILLING: 'шт.', DOWNTIME: 'ч'};

export function WorkScreen({state}: {state: OperatorMobileState}) {
  const {production, entries} = state;
  return (
    <>
      <Card title="Выработка смены">
        <CardBody>
          <div className="metrics">
            <Metric
              value={production.piles.count}
              label="свай"
              extra={`${formatNumber(production.piles.meters)} м.п.`}
            />
            <Metric
              value={production.drilling.count}
              label="скважин"
              extra={`${formatNumber(production.drilling.meters)} м.п.`}
            />
            <Metric value={formatHours(production.downtimeHours)} label="простой" />
          </div>
        </CardBody>
      </Card>

      <Card title="Записи смены">
        {entries.length === 0
          ? <Empty>За смену записей ещё нет</Empty>
          : entries.map((entry) => (
            <Row
              key={entry.id}
              title={entry.label}
              note={[
                entry.meters === null ? null : `${formatNumber(entry.meters)} м.п.`,
                entry.corrections.length > 0
                  ? `поправок: ${entry.corrections.length}`
                  : null,
              ].filter(Boolean).join(' · ') || undefined}
              chip={(
                <Chip tone={entry.kind === 'DOWNTIME' ? 'warn' : 'info'}>
                  {formatNumber(entry.value)} {ENTRY_UNIT[entry.kind] ?? ''}
                </Chip>
              )}
            />
          ))}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- сдача --- */

export function ClosingScreen({state}: {state: OperatorMobileState}) {
  const {receipt, shift} = state;
  return (
    <>
      {receipt ? (
        <Card title="Квитанция смены">
          <CardBody>
            <div className="pairs">
              <Pair label="Отчёт" value={receipt.reportId} />
              <Pair label="Отправлен" value={formatRuDate(receipt.submittedAt) || '—'} />
              <Pair label="Закрыт" value={formatRuDate(receipt.closedAt) || '—'} />
              <Pair label="Часовой пояс" value={receipt.timezone} />
            </div>
          </CardBody>
        </Card>
      ) : (
        <Banner
          tone="info"
          title="Смена ещё не закрыта"
          note={shiftLine(shift)}
          action="Закрытие и отправка отчёта — на экране «Смена машиниста»"
        />
      )}
      <WorkScreen state={state} />
    </>
  );
}

/* --------------------------------------------------- техника и события --- */

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
            note={`${formatRuDate(incident.occurredAt)}${incident.photos > 0 ? ` · фото: ${incident.photos}` : ''}`}
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

export function ProfileScreen({state}: {state: OperatorMobileState}) {
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
      </Card>
      <IdentityScreen state={state} />
    </>
  );
}
