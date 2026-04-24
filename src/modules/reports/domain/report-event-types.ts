export const REPORT_DOMAIN_EVENT_TYPES = {
  REPORT_CREATED: 'ReportCreated',
  REPORT_UPDATED: 'ReportUpdated',
  REPORT_SUBMITTED: 'ReportSubmitted',
  REPORT_DELETED: 'ReportDeleted',
  REPORT_VERSION_CREATED: 'ReportVersionCreated',
  PILE_WORK_ADDED: 'PileWorkAdded',
  PILE_WORK_REMOVED: 'PileWorkRemoved',
  DRILLING_ADDED: 'DrillingAdded',
  DRILLING_REMOVED: 'DrillingRemoved',
  DOWNTIME_ADDED: 'DowntimeAdded',
  DOWNTIME_REMOVED: 'DowntimeRemoved',
} as const;

export type ReportDomainEventType =
  (typeof REPORT_DOMAIN_EVENT_TYPES)[keyof typeof REPORT_DOMAIN_EVENT_TYPES];

const REPORT_EVENT_TYPE_ALIASES: Record<string, ReportDomainEventType> = {
  'report.created': REPORT_DOMAIN_EVENT_TYPES.REPORT_CREATED,
  'report.updated': REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED,
  'report.submitted': REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
  'report.deleted': REPORT_DOMAIN_EVENT_TYPES.REPORT_DELETED,
  'report.version_created': REPORT_DOMAIN_EVENT_TYPES.REPORT_VERSION_CREATED,
  'pile_work.added': REPORT_DOMAIN_EVENT_TYPES.PILE_WORK_ADDED,
  'pile_work.removed': REPORT_DOMAIN_EVENT_TYPES.PILE_WORK_REMOVED,
  'drilling.added': REPORT_DOMAIN_EVENT_TYPES.DRILLING_ADDED,
  'drilling.removed': REPORT_DOMAIN_EVENT_TYPES.DRILLING_REMOVED,
  'downtime.added': REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_ADDED,
  'downtime.removed': REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_REMOVED,
};

const CANONICAL_REPORT_EVENT_TYPES = new Set<ReportDomainEventType>(
  Object.values(REPORT_DOMAIN_EVENT_TYPES)
);

export function normalizeReportDomainEventType(
  eventType: string | null | undefined
): ReportDomainEventType | null {
  if (!eventType) {
    return null;
  }

  if (CANONICAL_REPORT_EVENT_TYPES.has(eventType as ReportDomainEventType)) {
    return eventType as ReportDomainEventType;
  }

  return REPORT_EVENT_TYPE_ALIASES[eventType] || null;
}

export function isReportDomainEventType(
  eventType: string | null | undefined
): eventType is ReportDomainEventType {
  return normalizeReportDomainEventType(eventType) !== null;
}
