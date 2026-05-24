/**
 * Environment Variables Validator
 *
 * Validates that all required environment variables are set before the app starts.
 * Fails fast with clear error messages instead of cryptic runtime errors.
 *
 * Usage:
 *   - Called automatically on server startup
 *   - Or manually: npx tsx scripts/validate-env.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

interface EnvVarConfig {
  required: boolean;
  description: string;
  validate?: (value: string) => string | null; // returns error message or null
}

const ENV_CONFIG: Record<string, EnvVarConfig> = {
  // Core — always required
  DATABASE_PROVIDER: {
    required: true,
    description: 'Database provider (sqlite | postgres)',
    validate: (v) => {
      if (!['sqlite', 'postgres'].includes(v)) {
        return `Must be "sqlite" or "postgres", got "${v}"`;
      }
      return null;
    },
  },
  SESSION_SECRET: {
    required: true,
    description: 'Secret key for signing JWT session tokens (min 32 chars)',
    validate: (v) => {
      if (v.length < 32) {
        return `Too short (${v.length} chars). Must be at least 32 characters.`;
      }
      if (v === 'dev-only-change-me' || v === 'replace-with-a-long-random-secret') {
        return 'Still using default placeholder. Generate a random secret.';
      }
      return null;
    },
  },
  DEVICE_KEY_LOOKUP_SECRET: {
    required: false, // required in production — checked conditionally below
    description: 'HMAC secret for hashing device API keys (min 32 chars). Required in production.',
    validate: (v) => {
      if (v.length < 32) return `Too short (${v.length} chars). Must be at least 32 characters.`;
      return null;
    },
  },
  PIN_LOOKUP_SECRET: {
    required: false, // required in production — checked conditionally below
    description: 'HMAC secret for PIN lookup hashing (min 32 chars). Required in production. Rotating invalidates all PIN logins.',
    validate: (v) => {
      if (v.length < 32) return `Too short (${v.length} chars). Must be at least 32 characters.`;
      return null;
    },
  },

  // Postgres — required when DATABASE_PROVIDER=postgres
  DATABASE_URL_POSTGRES: {
    required: false, // checked conditionally
    description: 'PostgreSQL connection string',
    validate: (v) => {
      if (!v.startsWith('postgresql://') && !v.startsWith('postgres://')) {
        return `Must start with "postgresql://" or "postgres://"`;
      }
      return null;
    },
  },
  POSTGRES_PASSWORD: {
    required: false,
    description: 'PostgreSQL password (for docker-compose)',
    validate: (v) => {
      if (v === 'replace-with-a-strong-password') {
        return 'Still using default placeholder. Set a strong password.';
      }
      return null;
    },
  },

  // Redis — required for production features
  REDIS_URL: {
    required: false, // optional but recommended
    description: 'Redis connection string (for rate limiting, WS pub/sub, caching)',
    validate: (v) => {
      if (!v.startsWith('redis://') && !v.startsWith('rediss://')) {
        return `Must start with "redis://" or "rediss://"`;
      }
      return null;
    },
  },

  // Sentry — optional
  SENTRY_ORG: { required: false, description: 'Sentry organization' },
  SENTRY_PROJECT: { required: false, description: 'Sentry project name' },
  SENTRY_AUTH_TOKEN: { required: false, description: 'Sentry auth token' },

  // Multi-tenant — optional
  MULTI_TENANT_MODE: {
    required: false,
    description: 'Multi-tenant mode (false | single | multi). Only "multi" (or legacy "true") enables multi-tenant enforcement.',
    validate: (v) => {
      if (!['false', 'single', 'multi', 'true'].includes(v)) {
        return `Must be "false", "single", "multi" (or legacy "true"), got "${v}"`;
      }
      return null;
    },
  },
  DEFAULT_TENANT_ID: { required: false, description: 'Default tenant ID' },

  // WebSocket — optional
  WS_URL: { required: false, description: 'WebSocket server URL' },
  NEXT_PUBLIC_WS_URL: { required: false, description: 'Public WebSocket URL (client-facing)' },

  // S3 — optional
  S3_ENDPOINT: { required: false, description: 'S3 endpoint (MinIO, R2, etc.)' },
  S3_ACCESS_KEY_ID: { required: false, description: 'S3 access key' },
  S3_SECRET_ACCESS_KEY: { required: false, description: 'S3 secret key' },
};

function validateEnv(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const provider = process.env.DATABASE_PROVIDER;

  for (const [key, config] of Object.entries(ENV_CONFIG)) {
    const value = process.env[key];

    // Check required
    if (config.required && (!value || value.trim() === '')) {
      errors.push(`Missing required variable: ${key} — ${config.description}`);
      continue;
    }

    // Conditional requirements
    if (provider === 'postgres' && key === 'DATABASE_URL_POSTGRES' && (!value || value.trim() === '')) {
      errors.push(`Missing required variable: ${key} — ${config.description} (required because DATABASE_PROVIDER=postgres)`);
      continue;
    }

    // Production-only required secrets — fail-fast on deploy instead of on first request
    if (
      process.env.NODE_ENV === 'production' &&
      (key === 'DEVICE_KEY_LOOKUP_SECRET' || key === 'PIN_LOOKUP_SECRET') &&
      (!value || value.trim() === '')
    ) {
      errors.push(`Missing required variable: ${key} — ${config.description} (required when NODE_ENV=production)`);
      continue;
    }

    // PIN_LOOKUP_SECRET must be distinct from SESSION_SECRET in production —
    // shared secret means rotating one breaks the other and JWT-key compromise
    // also breaks PIN-lookup integrity.
    if (
      process.env.NODE_ENV === 'production' &&
      key === 'PIN_LOOKUP_SECRET' &&
      value &&
      value === process.env.SESSION_SECRET
    ) {
      errors.push('PIN_LOOKUP_SECRET must be different from SESSION_SECRET in production.');
      continue;
    }

    // Skip if not set and not required
    if (!value || value.trim() === '') continue;

    // Validate
    if (config.validate) {
      const error = config.validate(value);
      if (error) {
        errors.push(`${key}: ${error}`);
      }
    }
  }

  // Warnings for recommended vars that are missing
  if (!process.env.REDIS_URL) {
    warnings.push('REDIS_URL not set — rate limiting falls back to in-memory (not distributed-safe)');
  }
  // Sentry plugin loads SENTRY_AUTH_TOKEN from .env.sentry-build-plugin
  // itself (separate from .env that dotenv loaded above). Suppress the
  // warning when that file exists with a token.
  if (!process.env.SENTRY_AUTH_TOKEN) {
    let tokenAvailable = false;
    try {
      const fs = require('node:fs');
      if (fs.existsSync('.env.sentry-build-plugin')) {
        tokenAvailable = /^SENTRY_AUTH_TOKEN=\S/m.test(
          fs.readFileSync('.env.sentry-build-plugin', 'utf8'),
        );
      }
    } catch { /* ignore */ }
    if (!tokenAvailable) {
      warnings.push('SENTRY_AUTH_TOKEN not set — Sentry source maps will not be uploaded');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function main() {
  console.log('🔍 Validating environment variables...\n');

  const { valid, errors, warnings } = validateEnv();

  if (warnings.length > 0) {
    console.log('⚠️  Warnings:');
    warnings.forEach((w) => console.log(`   • ${w}`));
    console.log();
  }

  if (valid) {
    console.log('✅ All environment variables are valid!\n');
    return;
  }

  console.error('❌ Environment validation failed:\n');
  errors.forEach((e) => console.error(`   • ${e}`));
  console.error('\n💡 Fix the issues above and restart the application.\n');
  process.exit(1);
}

// Export for programmatic use
export { validateEnv, ENV_CONFIG };

// Run if executed directly
if (require.main === module) {
  main();
}
