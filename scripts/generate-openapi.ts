/**
 * OpenAPI Specification Generator
 *
 * Generates OpenAPI 3.0 spec from existing API routes.
 * Run: npx tsx scripts/generate-openapi.ts
 * Output: public/openapi.json
 *
 * Serves at: GET /api/openapi
 */

import * as fs from 'fs';
import * as path from 'path';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'PilingTrack API',
    description: 'Industrial pile driving management platform — REST API for operators, dispatchers, and administrators.',
    version: '2.0.0',
    contact: { name: 'PilingTrack', email: 'support@pilingtrack.local' },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Development' },
    { url: 'https://pilingtrack.example.com', description: 'Production' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'pt-session',
        description: 'Session cookie (set via /api/auth/login)',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Bearer token (alternative to cookie)',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' }, requestId: { type: 'string' } },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT'] },
          isActive: { type: 'boolean' },
        },
      },
      Site: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          isActive: { type: 'boolean' },
          plannedPiles: { type: 'integer' },
          plannedDrilling: { type: 'number' },
          status: { type: 'string' },
        },
      },
      Report: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reportId: { type: 'string' },
          siteId: { type: 'string' },
          userId: { type: 'string' },
          date: { type: 'string', format: 'date' },
          shiftType: { type: 'string', enum: ['DAY', 'NIGHT'] },
          status: { type: 'string', enum: ['draft', 'submitted'] },
          piles: { type: 'array', items: { $ref: '#/components/schemas/PileWork' } },
          drillings: { type: 'array', items: { $ref: '#/components/schemas/Drilling' } },
          downtimes: { type: 'array', items: { $ref: '#/components/schemas/Downtime' } },
        },
      },
      PileWork: {
        type: 'object',
        properties: {
          pileGradeId: { type: 'string' },
          count: { type: 'integer' },
        },
      },
      Drilling: {
        type: 'object',
        properties: {
          typeId: { type: 'string' },
          count: { type: 'integer' },
          metersPerUnit: { type: 'number' },
          meters: { type: 'number' },
        },
      },
      Downtime: {
        type: 'object',
        properties: {
          reasonId: { type: 'string' },
          duration: { type: 'number', description: 'Duration in minutes' },
          comment: { type: 'string' },
        },
      },
      HealthStatus: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded', 'unhealthy'] },
          uptime: { type: 'number' },
          checks: { type: 'object' },
        },
      },
    },
    parameters: {
      DateFrom: {
        name: 'dateFrom',
        in: 'query',
        required: true,
        schema: { type: 'string', format: 'date' },
      },
      DateTo: {
        name: 'dateTo',
        in: 'query',
        required: true,
        schema: { type: 'string', format: 'date' },
      },
      SiteId: {
        name: 'siteId',
        in: 'query',
        schema: { type: 'string' },
      },
    },
  },
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  paths: {
    // Auth
    '/api/auth/login': {
      post: {
        summary: 'Authenticate user',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
          401: { description: 'Invalid credentials' },
          429: { description: 'Rate limited' },
        },
      },
    },
    '/api/auth/logout': {
      post: { summary: 'Logout', tags: ['Auth'], responses: { 200: { description: 'Logged out' } } },
    },
    '/api/auth/me': {
      get: { summary: 'Get current user', tags: ['Auth'], responses: { 200: { description: 'User info' }, 401: { description: 'Not authenticated' } } },
    },
    '/api/auth/pin': {
      post: {
        summary: 'PIN-based authentication',
        tags: ['Auth'],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { pin: { type: 'string' } } } } } },
        responses: { 200: { description: 'Login successful' }, 401: { description: 'Invalid PIN' } },
      },
    },
    '/api/auth/refresh': {
      post: { summary: 'Refresh access token', tags: ['Auth'], responses: { 200: { description: 'New token pair' }, 401: { description: 'Invalid refresh token' } } },
      delete: { summary: 'Revoke refresh token', tags: ['Auth'], responses: { 200: { description: 'Token revoked' } } },
    },

    // Sites
    '/api/sites': {
      get: { summary: 'List accessible sites', tags: ['Sites'], responses: { 200: { description: 'List of sites' } } },
    },
    '/api/sites/all': {
      get: { summary: 'List all sites (admin)', tags: ['Sites'], responses: { 200: { description: 'All sites' } } },
    },

    // Reports
    '/api/reports/upsert': {
      post: {
        summary: 'Create or update a report',
        tags: ['Reports'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['siteId', 'date'],
                properties: {
                  reportId: { type: 'string' },
                  siteId: { type: 'string' },
                  date: { type: 'string', format: 'date' },
                  shiftType: { type: 'string', enum: ['DAY', 'NIGHT'] },
                  shiftStart: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
                  shiftEnd: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
                  piles: { type: 'array', items: { $ref: '#/components/schemas/PileWork' } },
                  drillings: { type: 'array', items: { $ref: '#/components/schemas/Drilling' } },
                  downtimes: { type: 'array', items: { $ref: '#/components/schemas/Downtime' } },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Report saved', content: { 'application/json': { schema: { type: 'object', properties: { report: { $ref: '#/components/schemas/Report' } } } } } },
          400: { description: 'Validation error' },
          403: { description: 'Edit window expired' },
        },
      },
    },
    '/api/reports/my': {
      get: { summary: 'List own reports', tags: ['Reports'], responses: { 200: { description: 'List of reports' } } },
    },
    '/api/reports/all': {
      get: { summary: 'List all reports (admin/dispatcher)', tags: ['Reports'], responses: { 200: { description: 'All reports' } } },
    },
    '/api/reports/period': {
      get: {
        summary: 'List reports by date range',
        tags: ['Reports'],
        parameters: [
          { $ref: '#/components/parameters/DateFrom' },
          { $ref: '#/components/parameters/DateTo' },
          { $ref: '#/components/parameters/SiteId' },
        ],
        responses: { 200: { description: 'Reports with summary' } },
      },
    },
    '/api/reports/edit': {
      get: { summary: 'Get editable report', tags: ['Reports'], parameters: [
        { name: 'userId', in: 'query', schema: { type: 'string' } },
        { name: 'siteId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
      ], responses: { 200: { description: 'Report data' } } },
    },
    '/api/reports/export': {
      get: { summary: 'Export reports as CSV', tags: ['Reports'], parameters: [
        { name: 'siteId', in: 'query', schema: { type: 'string' } },
        { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
        { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
      ], responses: { 200: { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } } } },
    },

    // Sync (Offline-First)
    '/api/sync': {
      post: {
        summary: 'Batch sync (push outbox)',
        tags: ['Sync'],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { operations: { type: 'array', items: { type: 'object' } } } } } },
        },
        responses: { 200: { description: 'Sync result', content: { 'application/json': { schema: { type: 'object', properties: { reports: { type: 'array' }, cursor: { type: 'integer' } } } } } } },
      },
    },
    '/api/sync/updates': {
      get: {
        summary: 'Pull updates from server',
        tags: ['Sync'],
        parameters: [{ name: 'since', in: 'query', required: true, schema: { type: 'integer' }, description: 'Last sync timestamp (ms)' }],
        responses: { 200: { description: 'Updates', content: { 'application/json': { schema: { type: 'object', properties: { reports: { type: 'array' }, events: { type: 'array' }, cursor: { type: 'integer' }, hasMore: { type: 'boolean' } } } } } } },
      },
    },

    // Dictionary
    '/api/dictionary/all': {
      get: { summary: 'Get all dictionaries', tags: ['Dictionary'], responses: { 200: { description: 'Pile grades, drilling types, downtime reasons' } } },
    },

    // Health
    '/api/health': {
      get: { summary: 'Health check', tags: ['Health'], responses: { 200: { description: 'Health status', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthStatus' } } } } } },
    },
    '/api/readiness': {
      get: { summary: 'Readiness probe', tags: ['Health'], responses: { 200: { description: 'Ready' }, 503: { description: 'Not ready' } } },
    },
    '/api/liveness': {
      get: { summary: 'Liveness probe', tags: ['Health'], responses: { 200: { description: 'Alive' } } },
    },
    '/api/metrics': {
      get: { summary: 'Prometheus metrics', tags: ['Health'], responses: { 200: { description: 'Metrics', content: { 'text/plain': { schema: { type: 'string' } } } } } },
    },

    // Notifications
    '/api/notifications/telegram/test': {
      post: { summary: 'Test Telegram connection', tags: ['Notifications'], responses: { 200: { description: 'Connection OK' }, 500: { description: 'Failed' } } },
    },

    // Feedback
    '/api/feedback/events': {
      get: { summary: 'List feedback events', tags: ['Feedback'], responses: { 200: { description: 'Events' } } },
    },
    '/api/feedback/stream': {
      get: { summary: 'SSE stream for real-time events', tags: ['Feedback'], responses: { 200: { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } } },
    },

    // Telemetry
    '/api/telemetry': {
      post: { summary: 'Batch ingest telemetry', tags: ['Telemetry'], requestBody: { content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } }, responses: { 200: { description: 'Ingested' } } },
      get: { summary: 'Query telemetry', tags: ['Telemetry'], responses: { 200: { description: 'Telemetry data' } } },
    },
  },
};

// Write to public/openapi.json
const outputPath = path.join(process.cwd(), 'public', 'openapi.json');
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.log(`OpenAPI spec written to: ${outputPath}`);

export default spec;
