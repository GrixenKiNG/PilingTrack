import {db} from '@/lib/db';
import {checkMaintenanceDue} from '@/lib/maintenance-due';
import {pileLengthMeters} from '@/lib/pile-length';
import {checkOperatorDocuments} from '../domain/operator-admission';
import {OPERATOR_CHECKLISTS} from '../domain/checklist-catalog';
import type {ChecklistStage, ShiftCondition} from '../domain/checklist-types';
import {
  BRIEFING_DOCUMENT_TYPE, briefingUpToDate, KNOWLEDGE_DOCUMENT_TYPE, knowledgeValid,
} from '../domain/operator-credentials';
import {SAFETY_BRIEFING} from '../domain/safety-briefing';
import {
  resolveShiftConditions, selectChecklistSections, type EquipmentCapabilities,
} from '../domain/shift-conditions';
import {
  admissionAccepted, completedPhases, derivePhase, PHASE_LABELS, PHASE_ORDER,
  type OperatorPhase,
} from '../domain/shift-phases';
import {toDefectViews} from './defect-views';
import {collectWarnings, isWorkAllowed} from '../domain/work-warnings';
import {isIncidentOpen} from '../domain/incidents';
import type {
  ChecklistView, IncidentView, OperatorMobileState, ProductionEntryView, ReadWeather,
  WeatherView, WorkVolume,
} from '../domain/view-contracts';

/**
 * Одно чтение — весь экран оператора.
 *
 * ПОЧЕМУ ОДИН ЗАПРОС, А НЕ ДЕСЯТЬ. Телефон на площадке сидит на одной палке
 * сети. Десять запросов — это десять шансов, что экран соберётся наполовину и
 * оператор увидит «работа разрешена» рядом с незагруженным списком нарушений.
 * Здесь состояние собирается целиком либо не собирается вовсе.
 */

const DAY_MS = 86_400_000;

function todayInTimezone(timezone: string, now: Date): Date {
  // Производственные сутки считаем по часовому поясу пользователя, а не по UTC:
  // ночная смена в Сибири иначе уезжает во «вчера».
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

/** Ненулевой простой без перерывов: перерыв — не потеря времени объекта. */
const DOWNTIME_ONLY = {OR: [{kind: null}, {kind: {not: 'BREAK'}}]};

type ReportRows = {
  piles: {id: string; count: number; pileGradeId: string; occurredAt: Date | null; correctsId: string | null; correctionNote: string | null}[];
  drillings: {id: string; count: number; meters: number; typeId: string; occurredAt: Date | null; correctsId: string | null; correctionNote: string | null}[];
  downtimes: {id: string; duration: number; kind: string | null; reasonId: string | null; occurredAt: Date | null; correctsId: string | null; correctionNote: string | null}[];
} | null;

/**
 * Записи смены с итогом после поправок.
 *
 * Исходная строка и поправки к ней — разные строки в базе; экрану нужна одна
 * строка с итогом и видимым следом правок. Свернуть их молча нельзя: журнал
 * без следа правок ничем не отличается от журнала, который подчистили.
 */
function buildEntries(
  report: ReportRows,
  dictionaries: {
    pileGrades: {id: string; name: string; lengthMm: number | null}[];
    drillingTypes: {id: string; name: string}[];
    downtimeReasons: {id: string; name: string}[];
  },
  gradeLength: Map<string, number | null>,
): ProductionEntryView[] {
  if (!report) return [];

  const gradeName = new Map(dictionaries.pileGrades.map((g) => [g.id, g.name]));
  const typeName = new Map(dictionaries.drillingTypes.map((t) => [t.id, t.name]));
  const reasonName = new Map(dictionaries.downtimeReasons.map((r) => [r.id, r.name]));
  const moment = (value: Date | null) => (value ?? new Date(0)).toISOString();

  const collect = <T extends {id: string; correctsId: string | null; correctionNote: string | null; occurredAt: Date | null}>(
    rows: T[],
    kind: ProductionEntryView['kind'],
    label: (row: T) => string,
    value: (row: T) => number,
    meters: (row: T) => number | null,
  ): ProductionEntryView[] => {
    const originals = rows.filter((row) => !row.correctsId);
    const byTarget = new Map<string, T[]>();
    for (const row of rows) {
      if (!row.correctsId) continue;
      byTarget.set(row.correctsId, [...(byTarget.get(row.correctsId) ?? []), row]);
    }
    return originals.map((row) => {
      const patches = byTarget.get(row.id) ?? [];
      const total = value(row) + patches.reduce((sum, patch) => sum + value(patch), 0);
      const totalMeters = meters(row) === null ? null
        : (meters(row) ?? 0) + patches.reduce((sum, patch) => sum + (meters(patch) ?? 0), 0);
      return {
        id: row.id,
        kind,
        label: label(row),
        value: Math.round(total * 100) / 100,
        meters: totalMeters === null ? null : Math.round(totalMeters * 10) / 10,
        occurredAt: moment(row.occurredAt),
        corrections: patches
          .map((patch) => ({
            delta: Math.round(value(patch) * 100) / 100,
            note: patch.correctionNote ?? '',
            at: moment(patch.occurredAt),
          }))
          .sort((a, b) => b.at.localeCompare(a.at)),
      };
    });
  };

  return [
    ...collect(
      report.piles, 'PILES',
      (row) => gradeName.get(row.pileGradeId) ?? 'Свая',
      (row) => row.count,
      (row) => row.count * pileLengthMeters({gradeLengthMm: gradeLength.get(row.pileGradeId) ?? null}),
    ),
    ...collect(
      report.drillings, 'DRILLING',
      (row) => typeName.get(row.typeId) ?? 'Бурение',
      (row) => row.count,
      (row) => row.meters,
    ),
    ...collect(
      report.downtimes.filter((row) => row.kind === 'DOWNTIME'), 'DOWNTIME',
      (row) => (row.reasonId ? reasonName.get(row.reasonId) ?? 'Простой' : 'Простой'),
      (row) => row.duration,
      () => null,
    ),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export async function queryOperatorMobileState(input: {
  tenantId: string;
  operatorId: string;
  operatorName: string;
  /** Координаты телефона. Нет — берём координаты объекта. */
  latitude?: number;
  longitude?: number;
  /** Выбранная установка, если за оператором закреплено несколько. */
  equipmentId?: string;
  /** Порт погоды. Не передан — экран работает без неё. */
  readWeather?: ReadWeather;
  now?: Date;
}): Promise<OperatorMobileState> {
  const now = input.now ?? new Date();
  const {tenantId, operatorId} = input;

  const [profile, documentTypes, documents, crews, dictionaries] = await Promise.all([
    db.user.findFirst({where: {tenantId, id: operatorId}, select: {timezone: true}}),
    db.userDocumentType.findMany({
      where: {tenantId, isActive: true},
      select: {id: true, name: true, requiresExpiry: true, leadTimeDays: true, requiredForOperator: true},
      orderBy: [{requiredForOperator: 'desc'}, {name: 'asc'}],
    }),
    db.userDocument.findMany({
      where: {tenantId, userId: operatorId},
      select: {typeId: true, number: true, expiresAt: true, type: {select: {name: true}}},
      orderBy: {createdAt: 'desc'},
    }),
    db.crew.findMany({
      where: {operatorId, isActive: true, equipment: {tenantId}},
      select: {
        id: true,
        site: {select: {id: true, name: true, latitude: true, longitude: true}},
        equipment: {
          select: {
            id: true, name: true, model: true, isActive: true,
            hammerKind: true, isCombined: true, engineHoursTotal: true,
            nextMaintenanceDate: true, nextMaintenanceAtHours: true,
          },
        },
        assistants: {select: {name: true}},
      },
      orderBy: {createdAt: 'asc'},
    }),
    loadDictionaries(tenantId),
  ]);

  // Инструктаж и проверка знаний — документы работника, а не отдельная сущность.
  const briefingDoc = documents.find((d) => d.type.name === BRIEFING_DOCUMENT_TYPE);
  const knowledgeDoc = documents.find((d) => d.type.name === KNOWLEDGE_DOCUMENT_TYPE);
  const briefingOk = briefingUpToDate(briefingDoc?.number ?? null, SAFETY_BRIEFING.version);
  const knowledgeOk = knowledgeValid(knowledgeDoc?.expiresAt ?? null, now);

  // Служебные виды документов не показываем в списке допусков: они и так
  // отдельными карточками выше, а дублирование удлиняет экран вдвое.
  const visibleTypes = documentTypes.filter(
    (type) => type.name !== BRIEFING_DOCUMENT_TYPE && type.name !== KNOWLEDGE_DOCUMENT_TYPE,
  );
  const checks = checkOperatorDocuments(visibleTypes, documents, now);

  const identity = {
    documents: checks,
    briefing: {
      code: SAFETY_BRIEFING.code,
      title: SAFETY_BRIEFING.title,
      version: SAFETY_BRIEFING.version,
      acknowledgedVersion: briefingDoc?.number ?? null,
      ok: briefingOk,
    },
    knowledge: {
      validUntil: knowledgeDoc?.expiresAt?.toISOString() ?? null,
      lastResult: knowledgeDoc?.number ?? null,
      ok: knowledgeOk,
    },
  };

  const options = crews.map((crew) => ({
    crewId: crew.id,
    equipmentId: crew.equipment.id,
    equipmentName: crew.equipment.name,
    siteName: crew.site.name,
  }));

  const crew = input.equipmentId
    ? crews.find((candidate) => candidate.equipment.id === input.equipmentId)
    : crews[0];

  const buildProgress = (current: OperatorPhase) => {
    const done = completedPhases(current);
    return PHASE_ORDER.filter((phase) => phase !== 'CLOSED').map((phase) => ({
      phase,
      label: PHASE_LABELS[phase],
      done: done.includes(phase),
      current: phase === current,
    }));
  };

  if (!crew) {
    const phase: OperatorPhase = briefingOk && knowledgeOk ? 'ADMISSION' : 'IDENTITY';
    return {
      operator: {id: operatorId, name: input.operatorName},
      phase,
      progress: buildProgress(phase),
      identity,
      options,
      assignment: null,
      weather: null,
      conditions: [],
      shift: null,
      checklists: [],
      warnings: collectWarnings({
        documents: checks,
        hasEquipmentAssignment: false,
        equipmentActive: true,
        equipmentName: 'Установка',
        openDefects: [],
        openIncidents: [],
        windMs: null,
        temperatureC: null,
        maintenance: {overdue: false, soon: false, daysLeft: null},
      }),
      workAllowed: true,
      production: {piles: {count: 0, meters: 0}, drilling: {count: 0, meters: 0}, downtimeHours: 0},
      entries: [],
      incidents: [],
      defects: [],
      dictionaries,
    };
  }

  const equipmentId = crew.equipment.id;
  const siteId = crew.site.id;
  const productionDate = todayInTimezone(profile?.timezone ?? 'Europe/Moscow', now);

  const [sitePiles, siteDrilling, siteDowntime, lastFuel, lastMeter, shift, openDefects] = await Promise.all([
    sitePileVolume(tenantId, siteId, dictionaries.pileGrades),
    db.leaderDrilling.aggregate({
      _sum: {count: true, meters: true},
      where: {report: {tenantId, siteId}},
    }),
    db.reportDowntime.aggregate({
      _sum: {duration: true},
      where: {report: {tenantId, siteId}, ...DOWNTIME_ONLY},
    }),
    db.report.findFirst({
      where: {tenantId, equipmentId, endingFuelPercent: {not: null}},
      orderBy: {date: 'desc'},
      select: {endingFuelPercent: true},
    }),
    // Последнее показание счётчика. Берём из журнала наработки, а не из
    // поля карточки техники: журнал — источник истины, поле — его кэш, и
    // расхождение между ними уже случалось.
    db.meterReading.findFirst({
      where: {tenantId, equipmentId},
      orderBy: {recordedAt: 'desc'},
      select: {engineHours: true, recordedAt: true},
    }),
    // Сначала — открытая смена этой машины на любую дату. База допускает
    // только одну такую (Shift_one_active_per_equipment_key), и если она за
    // вчера, оператор обязан её увидеть и сдать. Открытой нет — берём
    // сегодняшнюю в любом состоянии, кроме отменённой.
    db.shift.findFirst({
      where: {
        tenantId,
        equipmentId,
        OR: [
          {state: {in: ['STARTED', 'HANDOVER_PENDING']}},
          {productionDate, state: {notIn: ['CANCELLED']}},
        ],
      },
      orderBy: [{startedAt: {sort: 'desc', nulls: 'last'}}, {updatedAt: 'desc'}],
      select: {id: true, state: true, startedAt: true, productionDate: true},
    }),
    db.equipmentDefect.findMany({
      where: {tenantId, equipmentId, status: {in: ['OPEN', 'IN_WORK']}},
      select: {
        id: true, title: true, severity: true, status: true,
        reportedAt: true, reportedById: true,
      },
      orderBy: [{severity: 'desc'}, {reportedAt: 'desc'}],
      take: 10,
    }),
  ]);

  const coordinates = input.latitude != null && input.longitude != null
    ? {latitude: input.latitude, longitude: input.longitude}
    : crew.site.latitude != null && crew.site.longitude != null
      ? {latitude: crew.site.latitude, longitude: crew.site.longitude}
      : null;

  const reading = coordinates && input.readWeather
    ? await input.readWeather(coordinates.latitude, coordinates.longitude)
    : null;

  const weather: WeatherView | null = reading
    ? {
      temperatureC: reading.temperatureC,
      windMs: reading.windMs,
      precipitationMmPerHour: reading.precipitationMmPerHour,
      isDay: reading.isDay,
      at: reading.at,
    }
    : null;

  const conditions = resolveShiftConditions({
    temperatureC: weather?.temperatureC ?? null,
    windMs: weather?.windMs ?? null,
    precipitationMmPerHour: weather?.precipitationMmPerHour ?? null,
    daylight: weather?.isDay ?? null,
  });

  const capabilities: EquipmentCapabilities = {
    hasHammer: crew.equipment.hammerKind !== 'NONE',
    hasRotator: crew.equipment.isCombined,
  };

  const [executions, report, startup, incidents] = shift
    ? await Promise.all([
      db.operatorChecklistExecution.findMany({
        where: {tenantId, shiftId: shift.id},
        select: {status: true, templateSnapshot: true},
      }),
      db.report.findFirst({
        where: {tenantId, shiftId: shift.id},
        select: {
          piles: {
            select: {
              id: true, count: true, pileGradeId: true, occurredAt: true,
              correctsId: true, correctionNote: true,
            },
          },
          drillings: {
            select: {
              id: true, count: true, meters: true, typeId: true, occurredAt: true,
              correctsId: true, correctionNote: true,
            },
          },
          downtimes: {
            select: {
              id: true, duration: true, kind: true, reasonId: true, occurredAt: true,
              correctsId: true, correctionNote: true,
            },
          },
        },
      }),
      db.operatorShiftEvidence.findFirst({
        where: {tenantId, shiftId: shift.id, kind: 'STARTUP_READING'},
        orderBy: {occurredAt: 'asc'},
        select: {payload: true},
      }),
      db.safetyIncident.findMany({
        where: {tenantId, shiftId: shift.id},
        orderBy: {occurredAt: 'desc'},
        select: {
          id: true, category: true, severity: true, state: true, description: true,
          observedSigns: true, injured: true, stopRequired: true, occurredAt: true,
          evidenceMediaIds: true, reviewedAt: true,
        },
        take: 20,
      }),
    ])
    : [[], null, null, []];

  const incidentViews: IncidentView[] = incidents.map((incident) => ({
    id: incident.id,
    category: incident.category as IncidentView['category'],
    severity: incident.severity as IncidentView['severity'],
    state: incident.state,
    description: incident.description,
    signs: Array.isArray(incident.observedSigns)
      ? (incident.observedSigns as IncidentView['signs'])
      : [],
    injured: incident.injured,
    stopRequired: incident.stopRequired,
    occurredAt: incident.occurredAt.toISOString(),
    photos: Array.isArray(incident.evidenceMediaIds) ? incident.evidenceMediaIds.length : 0,
    reviewedAt: incident.reviewedAt?.toISOString() ?? null,
  }));

  // Красное гаснет только после разбора диспетчером, а не после того, как
  // работу возобновили: это две разные вещи и по времени они расходятся.
  const openIncidents = incidentViews.filter((incident) => isIncidentOpen(incident.reviewedAt));


  // У открытой смены состав осмотра берётся из снимка условий, сделанного при
  // её открытии, а не из погоды на момент чтения экрана. Иначе список пунктов
  // менялся бы под руками оператора: утром зимний пункт есть, к обеду
  // потеплело — и его нет. Сервер при приёме осмотра читает тот же снимок,
  // поэтому экран и проверка всегда согласны между собой.
  const storedPayload = startup?.payload as {conditions?: unknown} | null;
  const shiftConditions: ShiftCondition[] | null = Array.isArray(storedPayload?.conditions)
    ? storedPayload.conditions.filter((value): value is ShiftCondition => typeof value === 'string')
    : null;
  const checklistConditions = shiftConditions ?? conditions;

  const completedStages = executions
    .filter((execution) => execution.status === 'COMPLETED')
    .map((execution) => (execution.templateSnapshot as {stage?: ChecklistStage}).stage)
    .filter((stage): stage is ChecklistStage => Boolean(stage));

  const maintenanceDue = checkMaintenanceDue({
    nextMaintenanceDate: crew.equipment.nextMaintenanceDate?.toISOString() ?? null,
    nextMaintenanceAtHours: crew.equipment.nextMaintenanceAtHours,
    engineHoursTotal: crew.equipment.engineHoursTotal,
  }, now);
  const maintenanceDaysLeft = crew.equipment.nextMaintenanceDate
    ? Math.round((crew.equipment.nextMaintenanceDate.getTime() - now.getTime()) / DAY_MS)
    : null;
  const maintenance = {
    overdue: maintenanceDue.overdue,
    soon: maintenanceDue.soon,
    daysLeft: maintenanceDaysLeft,
  };

  const defectViews = await toDefectViews({
    tenantId, viewerId: operatorId, defects: openDefects,
  });

  const warnings = collectWarnings({
    documents: checks,
    hasEquipmentAssignment: true,
    equipmentActive: crew.equipment.isActive,
    equipmentName: crew.equipment.name,
    openDefects,
    openIncidents: openIncidents.map((incident) => ({
      description: incident.description,
      severity: incident.severity,
      stopRequired: incident.stopRequired,
    })),
    windMs: weather?.windMs ?? null,
    temperatureC: weather?.temperatureC ?? null,
    maintenance,
  });

  const phase = derivePhase({
    briefingAcknowledged: briefingOk,
    knowledgeValid: knowledgeOk,
    // Выборка выше берёт сегодняшнюю смену в любом состоянии, кроме отменённой,
    // — запланированную диспетчером надо показать тому, кто на неё выходит. Но
    // «найдена» не значит «принята»: правило и его цена — в `admissionAccepted`.
    admissionAccepted: admissionAccepted(shift?.state),
    completedStages,
    workFinished: shift?.state === 'HANDOVER_PENDING',
    shiftClosed: shift?.state === 'CLOSED',
  });

  const checklists: ChecklistView[] = OPERATOR_CHECKLISTS.map((definition) => ({
    stage: definition.stage,
    title: definition.title,
    purpose: definition.purpose,
    version: definition.version,
    done: completedStages.includes(definition.stage),
    sections: selectChecklistSections(definition, checklistConditions, capabilities),
  }));

  const gradeLength = new Map(dictionaries.pileGrades.map((g) => [g.id, g.lengthMm]));
  const entries = buildEntries(report, dictionaries, gradeLength);

  return {
    operator: {id: operatorId, name: input.operatorName},
    phase,
    progress: buildProgress(phase),
    identity,
    options,
    assignment: {
      crewId: crew.id,
      siteId,
      siteName: crew.site.name,
      equipmentId,
      equipmentName: crew.equipment.name,
      equipmentModel: crew.equipment.model,
      hasHammer: capabilities.hasHammer,
      hasRotator: capabilities.hasRotator,
      assistants: crew.assistants.map((assistant) => assistant.name),
      sitePiles,
      siteDrilling: {
        count: siteDrilling._sum.count ?? 0,
        meters: round1(siteDrilling._sum.meters ?? 0),
      },
      siteDowntimeHours: round1(siteDowntime._sum.duration ?? 0),
      fuelPercent: lastFuel?.endingFuelPercent ?? null,
      lastMeter: lastMeter
        ? {engineHours: lastMeter.engineHours, recordedAt: lastMeter.recordedAt.toISOString()}
        : null,
      maintenance,
    },
    weather,
    conditions: checklistConditions,
    shift: shift
      ? {
        id: shift.id,
        productionDate: shift.productionDate.toISOString().slice(0, 10),
        startedAt: shift.startedAt?.toISOString() ?? null,
        state: shift.state,
      }
      : null,
    checklists,
    warnings,
    workAllowed: isWorkAllowed(warnings),
    entries,
    incidents: incidentViews,
    defects: defectViews,
    production: {
      piles: {
        count: report?.piles.reduce((sum, pile) => sum + pile.count, 0) ?? 0,
        meters: round1(report?.piles.reduce(
          (sum, pile) => sum + pile.count * pileLengthMeters({gradeLengthMm: gradeLength.get(pile.pileGradeId) ?? null}),
          0,
        ) ?? 0),
      },
      drilling: {
        count: report?.drillings.reduce((sum, drill) => sum + drill.count, 0) ?? 0,
        meters: round1(report?.drillings.reduce((sum, drill) => sum + drill.meters, 0) ?? 0),
      },
      downtimeHours: round1(report?.downtimes
        .filter((downtime) => downtime.kind !== 'BREAK')
        .reduce((sum, downtime) => sum + downtime.duration, 0) ?? 0),
    },
    dictionaries,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Забито на объекте за всё время: штуки и метры погонные.
 *
 * Считаем группировкой по марке, а не выборкой всех строк: на объекте, где
 * забито десять тысяч свай, второе означало бы десять тысяч строк в память
 * ради одной суммы. Метры разворачиваются из длины марки — единственного
 * источника длины в продукте.
 */
async function sitePileVolume(
  tenantId: string,
  siteId: string,
  grades: {id: string; lengthMm: number | null}[],
): Promise<WorkVolume> {
  const groups = await db.pileWork.groupBy({
    by: ['pileGradeId'],
    _sum: {count: true},
    where: {report: {tenantId, siteId}},
  });
  const length = new Map(grades.map((grade) => [grade.id, grade.lengthMm]));

  let count = 0;
  let meters = 0;
  for (const group of groups) {
    const piles = group._sum.count ?? 0;
    count += piles;
    meters += piles * pileLengthMeters({gradeLengthMm: length.get(group.pileGradeId) ?? null});
  }
  return {count, meters: round1(meters)};
}

/**
 * Справочники приезжают вместе с состоянием, а не отдельным запросом: экран
 * учёта выработки без них бесполезен, а второй запрос — второй шанс не доехать.
 */
async function loadDictionaries(tenantId: string) {
  const [pileGrades, drillingTypes, downtimeReasons] = await Promise.all([
    db.pileGrade.findMany({
      where: {tenantId, isActive: true},
      select: {id: true, name: true, lengthMm: true},
      orderBy: {name: 'asc'},
    }),
    db.drillingType.findMany({
      where: {tenantId, isActive: true},
      select: {id: true, name: true},
      orderBy: {name: 'asc'},
    }),
    db.downtimeReason.findMany({
      where: {tenantId, isActive: true},
      select: {id: true, name: true},
      orderBy: {name: 'asc'},
    }),
  ]);
  return {pileGrades, drillingTypes, downtimeReasons};
}
