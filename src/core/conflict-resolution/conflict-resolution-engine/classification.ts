/**
 * Field classification for report domain — drives intelligent merging.
 */
export const REPORT_FIELD_CLASSIFICATION = {
  // Server-authoritative — never override from client
  serverAuthoritative: new Set([
    'tenantId',
    'version',
    'createdAt',
    'updatedAt',
    'id',
    'reportId',
  ]),

  // Business-critical — server wins but log conflict
  businessCritical: new Set([
    'status',
    'date',
    'siteId',
    'userId',
    'crewId',
  ]),

  // Temporal — latest timestamp wins (but validate)
  temporal: new Set([
    'shiftStart',
    'shiftEnd',
    'lastEditedById',
    'lastEditedByName',
    'lastEditedByRole',
  ]),

  // Collections — semantic merge by ID
  collections: new Set([
    'piles',
    'drillings',
    'downtimes',
  ]),

  // Numeric — additive (sum both sides)
  // No purely numeric fields in report root, but nested collections have numeric fields.
  numeric: new Set<string>([]),

  // Default — client wins (more recent user input)
  default: 'client_wins',
} as const;

export type FieldClassification =
  | 'serverAuthoritative'
  | 'businessCritical'
  | 'temporal'
  | 'collections'
  | 'numeric'
  | 'default';

export function classifyField(key: string): FieldClassification {
  if (REPORT_FIELD_CLASSIFICATION.serverAuthoritative.has(key)) {
    return 'serverAuthoritative';
  }
  if (REPORT_FIELD_CLASSIFICATION.businessCritical.has(key)) {
    return 'businessCritical';
  }
  if (REPORT_FIELD_CLASSIFICATION.temporal.has(key)) {
    return 'temporal';
  }
  if (REPORT_FIELD_CLASSIFICATION.collections.has(key)) {
    return 'collections';
  }
  if (REPORT_FIELD_CLASSIFICATION.numeric.has(key)) {
    return 'numeric';
  }
  return 'default';
}
