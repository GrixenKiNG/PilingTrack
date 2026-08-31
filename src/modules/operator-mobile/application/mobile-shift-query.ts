import {db} from '@/lib/db';
import {checkMaintenanceDue} from '@/lib/maintenance-due';
import {pileLengthMeters} from '@/lib/pile-length';
import {checkOperatorDocuments} from '../domain/operator-admission';
import {OPERATOR_CHECKLISTS} from '../domain/checklist-catalog';
import type {ChecklistStage} from '../domain/checklist-types';
import {
  BRIEFING_DOCUMENT_TYPE, briefingUpToDate, KNOWLEDGE_DOCUMENT_TYPE, knowledgeValid,
} from '../domain/operator-credentials';
import {SAFETY_BRIEFING} from '../domain/safety-briefing';
import {
  resolveShiftConditions, selectChecklistSections, type EquipmentCapabilities,
} from '../domain/shift-conditions';
import {
  completedPhases, derivePhase, PHASE_LABELS, PHASE_ORDER, type OperatorPhase,
} from '../domain/shift-phases';
import {collectWarnings, isWorkAllowed} from '../domain/work-warnings';
import type {
  ChecklistView, OperatorMobileState, ReadWeather, WeatherView, WorkVolume,
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
        windMs: null,
        temperatureC: null,
        maintenance: {overdue: false, soon: false, daysLeft: null},
      }),
      workAllowed: true,
      production: {piles: {count: 0, meters: 0}, drilling: {count: 0, meters: 0}, downtimeHours: 0},
      dictionaries,
    };
  }

  const equipmentId = crew.equipment.id;
  const siteId = crew.site.id;
  const productionDate = todayInTimezone(profile?.timezone ?? 'Europe/Moscow', now);

  const [sitePiles, siteDrilling, siteDowntime, lastFuel, shift, openDefects] = await Promise.all([
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
      select: {title: true, severity: true},
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

  const [executions, report] = shift
    ? await Promise.all([
      db.operatorChecklistExecution.findMany({
        where: {tenantId, shiftId: shift.id},
        select: {status: true, templateSnapshot: true},
      }),
      db.report.findFirst({
        where: {tenantId, shiftId: shift.id},
        select: {
          piles: {select: {count: true, pileGradeId: true}},
          drillings: {select: {count: true, meters: true}},
          downtimes: {select: {duration: true, kind: true}},
        },
      }),
    ])
    : [[], null];

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

  const warnings = collectWarnings({
    documents: checks,
    hasEquipmentAssignment: true,
    equipmentActive: crew.equipment.isActive,
    equipmentName: crew.equipment.name,
    openDefects,
    windMs: weather?.windMs ?? null,
    temperatureC: weather?.temperatureC ?? null,
    maintenance,
  });

  const phase = derivePhase({
    briefingAcknowledged: briefingOk,
    knowledgeValid: knowledgeOk,
    admissionAccepted: Boolean(shift),
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
    sections: selectChecklistSections(definition, conditions, capabilities),
  }));

  const gradeLength = new Map(dictionaries.pileGrades.map((g) => [g.id, g.lengthMm]));

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
      maintenance,
    },
    weather,
    conditions,
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
