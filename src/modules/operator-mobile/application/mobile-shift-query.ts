import {db} from '@/lib/db';
import {checkOperatorDocuments, isIdentityValid} from '../domain/operator-admission';
import {OPERATOR_CHECKLISTS} from '../domain/checklist-catalog';
import type {ChecklistStage} from '../domain/checklist-types';
import {
  resolveShiftConditions, selectChecklistItems, type EquipmentCapabilities,
} from '../domain/shift-conditions';
import {
  completedPhases, derivePhase, PHASE_LABELS, PHASE_ORDER, type OperatorPhase,
} from '../domain/shift-phases';
import {collectBlockers, isWorkAllowed, type BlockerCode, type WorkBlocker} from '../domain/work-blockers';
import type {
  ChecklistView, OperatorMobileState, ReadWeather, WeatherView,
} from '../domain/view-contracts';

/**
 * Одно чтение — весь экран оператора.
 *
 * ПОЧЕМУ ОДИН ЗАПРОС, А НЕ ДЕСЯТЬ. Телефон на площадке сидит на одной палке
 * сети. Десять запросов — это десять шансов, что экран соберётся наполовину и
 * оператор увидит «работа разрешена» рядом с незагруженным списком препятствий.
 * Здесь состояние собирается целиком либо не собирается вовсе.
 */


function todayInTimezone(timezone: string): Date {
  // Производственные сутки считаем по часовому поясу пользователя, а не по UTC:
  // ночная смена в Сибири иначе уезжает во «вчера».
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${parts}T00:00:00.000Z`);
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

  // Часовой пояс берём из карточки пользователя, а не с телефона: от него
  // зависит, к каким производственным суткам отнести смену, и подставлять
  // сюда значение из браузера значит позволить телефону выбирать дату отчёта.
  const [profile, documentTypes, documents, crews] = await Promise.all([
    db.user.findFirst({where: {tenantId, id: operatorId}, select: {timezone: true}}),
    db.userDocumentType.findMany({
      where: {tenantId, isActive: true},
      select: {id: true, name: true, requiresExpiry: true, leadTimeDays: true, requiredForOperator: true},
      orderBy: [{requiredForOperator: 'desc'}, {name: 'asc'}],
    }),
    db.userDocument.findMany({
      where: {tenantId, userId: operatorId},
      select: {typeId: true, number: true, expiresAt: true},
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
          },
        },
        assistants: {select: {name: true}},
      },
      orderBy: {createdAt: 'asc'},
    }),
  ]);

  const checks = checkOperatorDocuments(documentTypes, documents, now);
  const identityValid = isIdentityValid(checks);

  const options = crews.map((crew) => ({
    crewId: crew.id,
    equipmentId: crew.equipment.id,
    equipmentName: crew.equipment.name,
    siteName: crew.site.name,
  }));

  const crew = input.equipmentId
    ? crews.find((candidate) => candidate.equipment.id === input.equipmentId)
    : crews[0];

  const emptyState = (blockers: WorkBlocker[]): OperatorMobileState => {
    const phase: OperatorPhase = identityValid ? 'ADMISSION' : 'IDENTITY';
    return {
      operator: {id: operatorId, name: input.operatorName},
      phase,
      progress: buildProgress(phase),
      identity: {documents: checks, valid: identityValid},
      options,
      assignment: null,
      weather: null,
      conditions: [],
      shift: null,
      checklists: [],
      blockers,
      workAllowed: false,
      production: {piles: 0, drillingMeters: 0, downtimeHours: 0},
    };
  };

  if (!crew) {
    return emptyState(collectBlockers({
      documents: checks,
      hasEquipmentAdmission: false,
      equipmentActive: true,
      equipmentName: 'Установка',
      criticalDefectTitles: [],
      blockingFaultTexts: [],
      windMs: null,
      waivedCodes: [],
    }));
  }

  const equipmentId = crew.equipment.id;
  const productionDate = todayInTimezone(profile?.timezone ?? 'Europe/Moscow');

  const [lastMeter, previousPiles, shift, criticalDefects] = await Promise.all([
    db.meterReading.findFirst({
      where: {tenantId, equipmentId},
      orderBy: {recordedAt: 'desc'},
      select: {engineHours: true, recordedAt: true},
    }),
    db.pileWork.aggregate({
      _sum: {count: true},
      where: {
        report: {tenantId, equipmentId, date: {lt: productionDate.toISOString().slice(0, 10)}},
      },
    }),
    // Сначала — открытая смена этой машины на любую дату. База допускает
    // только одну такую (Shift_one_active_per_equipment_key), и если она за
    // вчера, оператор обязан её увидеть и сдать: иначе он упрётся в отказ при
    // открытии сегодняшней и не поймёт почему.
    //
    // Открытой нет — берём сегодняшнюю в любом состоянии, кроме отменённой:
    // фильтр «только открытые» прятал бы смену, сданную полчаса назад, и экран
    // предлагал бы открыть вторую за день.
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
      where: {tenantId, equipmentId, severity: 'CRITICAL', status: {in: ['OPEN', 'IN_WORK']}},
      select: {title: true},
      take: 5,
    }),
  ]);

  const coordinates = input.latitude != null && input.longitude != null
    ? {latitude: input.latitude, longitude: input.longitude}
    : crew.site.latitude != null && crew.site.longitude != null
      ? {latitude: crew.site.latitude, longitude: crew.site.longitude}
      : null;

  const conditionsReading = coordinates && input.readWeather
    ? await input.readWeather(coordinates.latitude, coordinates.longitude)
    : null;

  const weather: WeatherView | null = conditionsReading
    ? {
      temperatureC: conditionsReading.temperatureC,
      windMs: conditionsReading.windMs,
      precipitationMmPerHour: conditionsReading.precipitationMmPerHour,
      isDay: conditionsReading.isDay,
      at: conditionsReading.at,
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

  const [executions, waiver, report] = shift
    ? await Promise.all([
      db.operatorChecklistExecution.findMany({
        where: {tenantId, shiftId: shift.id},
        select: {id: true, status: true, templateSnapshot: true, answers: {
          select: {itemId: true, result: true, itemSnapshot: true},
        }},
      }),
      db.shiftStartWaiver.findFirst({
        where: {tenantId, shiftId: shift.id},
        select: {blockerFingerprint: true},
      }),
      db.report.findFirst({
        where: {tenantId, shiftId: shift.id},
        select: {
          piles: {select: {count: true}},
          drillings: {select: {meters: true}},
          downtimes: {select: {duration: true, kind: true}},
        },
      }),
    ])
    : [[], null, null];

  const completedStages = executions
    .filter((execution) => execution.status === 'COMPLETED')
    .map((execution) => (execution.templateSnapshot as {stage?: ChecklistStage}).stage)
    .filter((stage): stage is ChecklistStage => Boolean(stage));

  const blockingFaultTexts = executions.flatMap((execution) => execution.answers
    .filter((answer) => answer.result === 'FAULT'
      && (answer.itemSnapshot as {blocking?: boolean}).blocking === true)
    .map((answer) => (answer.itemSnapshot as {text?: string}).text ?? answer.itemId));

  const waivedCodes = (waiver?.blockerFingerprint.split(',').filter(Boolean) ?? []) as BlockerCode[];

  const blockers = collectBlockers({
    documents: checks,
    hasEquipmentAdmission: true,
    equipmentActive: crew.equipment.isActive,
    equipmentName: crew.equipment.name,
    criticalDefectTitles: criticalDefects.map((defect) => defect.title),
    blockingFaultTexts,
    windMs: weather?.windMs ?? null,
    waivedCodes,
  });

  const phase = derivePhase({
    identityValid,
    admissionAccepted: Boolean(shift),
    completedStages,
    closingRequested: shift?.state === 'HANDOVER_PENDING',
    shiftClosed: shift?.state === 'CLOSED',
  });

  const checklists: ChecklistView[] = OPERATOR_CHECKLISTS.map((definition) => ({
    stage: definition.stage,
    title: definition.title,
    purpose: definition.purpose,
    version: definition.version,
    done: completedStages.includes(definition.stage),
    items: selectChecklistItems(definition, conditions, capabilities),
  }));

  return {
    operator: {id: operatorId, name: input.operatorName},
    phase,
    progress: buildProgress(phase),
    identity: {documents: checks, valid: identityValid},
    options,
    assignment: {
      crewId: crew.id,
      siteId: crew.site.id,
      siteName: crew.site.name,
      equipmentId,
      equipmentName: crew.equipment.name,
      equipmentModel: crew.equipment.model,
      hasHammer: capabilities.hasHammer,
      hasRotator: capabilities.hasRotator,
      assistants: crew.assistants.map((assistant) => assistant.name),
      lastEngineHours: lastMeter?.engineHours ?? crew.equipment.engineHoursTotal ?? null,
      lastEngineHoursAt: lastMeter?.recordedAt.toISOString() ?? null,
      previousShiftPiles: previousPiles._sum.count ?? 0,
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
    blockers,
    workAllowed: isWorkAllowed(blockers) && phase === 'WORK',
    production: {
      piles: report?.piles.reduce((sum, pile) => sum + pile.count, 0) ?? 0,
      drillingMeters: report?.drillings.reduce((sum, drilling) => sum + drilling.meters, 0) ?? 0,
      downtimeHours: report?.downtimes
        .filter((downtime) => downtime.kind !== 'BREAK')
        .reduce((sum, downtime) => sum + downtime.duration, 0) ?? 0,
    },
  };
}

function buildProgress(current: OperatorPhase) {
  const done = completedPhases(current);
  return PHASE_ORDER.filter((phase) => phase !== 'CLOSED').map((phase) => ({
    phase,
    label: PHASE_LABELS[phase],
    done: done.includes(phase),
    current: phase === current,
  }));
}
