/**
 * Tenant Billing & Subscription Service
 *
 * Manages:
 * - Tenant creation with trial period
 * - Subscription status tracking
 * - Invoice generation
 * - Plan limit enforcement
 * - Usage tracking
 */

import { randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

// ============================================================
// Plan Definitions
// ============================================================

export interface TenantPlan {
  id: string;
  name: string;
  monthlyFee: number;
  maxUsers: number;
  maxSites: number;
  maxStorageMB: number;
  features: string[];
}

export const PLANS: Record<string, TenantPlan> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyFee: 0,
    maxUsers: 3,
    maxSites: 1,
    maxStorageMB: 100,
    features: ['basic_reports', 'pdf_export'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    monthlyFee: 5000,
    maxUsers: 10,
    maxSites: 5,
    maxStorageMB: 1000,
    features: ['basic_reports', 'pdf_export', 'analytics', 'telegram_notifications'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyFee: 15000,
    maxUsers: 50,
    maxSites: 20,
    maxStorageMB: 5000,
    features: ['basic_reports', 'pdf_export', 'analytics', 'telegram_notifications', 'api_access', 'priority_support'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyFee: 50000,
    maxUsers: 999,
    maxSites: 999,
    maxStorageMB: 50000,
    features: ['basic_reports', 'pdf_export', 'analytics', 'telegram_notifications', 'api_access', 'priority_support', 'custom_integrations', 'sla'],
  },
};

// ============================================================
// Tenant Management
// ============================================================

export async function createTenant(params: {
  slug: string;
  name: string;
  billingEmail?: string;
  plan?: string;
  trialDays?: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
}): Promise<{ tenant: any }> {
  const plan = PLANS[params.plan || 'free'];
  const now = new Date();
  const trialEndsAt = params.trialDays
    ? new Date(now.getTime() + params.trialDays * 24 * 60 * 60 * 1000)
    : null;

  const tenant = await db.tenant.create({
    data: {
      slug: params.slug,
      name: params.name,
      billingEmail: params.billingEmail || null,
      plan: params.plan || 'free',
      monthlyFee: plan.monthlyFee,
      maxUsers: plan.maxUsers,
      subscriptionStatus: params.trialDays ? 'trial' : 'inactive',
      trialEndsAt,
    },
  });

  return { tenant };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
export async function getTenant(tenantId: string): Promise<any> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    include: { invoices: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });

  if (!tenant) {
    throw new ServiceError('Tenant not found', 404);
  }

  return tenant;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
export async function getTenantBySlug(slug: string): Promise<any> {
  const tenant = await db.tenant.findUnique({
    where: { slug },
  });

  if (!tenant) {
    throw new ServiceError('Tenant not found', 404);
  }

  return tenant;
}

// ============================================================
// Subscription Management
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
export async function activateSubscription(tenantId: string, planId: string): Promise<any> {
  const plan = PLANS[planId];
  if (!plan) {
    throw new ServiceError(`Plan ${planId} not found`, 400);
  }

  const tenant = await db.tenant.update({
    where: { id: tenantId },
    data: {
      plan: planId,
      monthlyFee: plan.monthlyFee,
      maxUsers: plan.maxUsers,
      subscriptionStatus: 'active',
      subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      lastBillingAt: new Date(),
    },
  });

  // Generate invoice
  await generateInvoice(tenantId, plan.monthlyFee);

  return tenant;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
export async function cancelSubscription(tenantId: string, _reason?: string): Promise<any> {
  const tenant = await db.tenant.update({
    where: { id: tenantId },
    data: {
      subscriptionStatus: 'canceled',
      subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // End of current period
    },
  });

  return tenant;
}

// ============================================================
// Invoice Management
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
async function generateInvoice(tenantId: string, amount: number): Promise<any> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const invoiceSuffix = randomBytes(4).toString('hex').toUpperCase();
  const invoiceNumber = `INV-${tenant.slug.toUpperCase()}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${invoiceSuffix}`;

  return await db.tenantInvoice.create({
    data: {
      tenantId,
      invoiceNumber,
      periodStart,
      periodEnd,
      amount,
      currency: tenant.currency,
      status: 'pending',
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
export async function markInvoicePaid(invoiceId: string): Promise<any> {
  return await db.tenantInvoice.update({
    where: { id: invoiceId },
    data: {
      status: 'paid',
      paidAt: new Date(),
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
export async function getTenantInvoices(tenantId: string): Promise<any[]> {
  return await db.tenantInvoice.findMany({
    where: { tenantId },
    orderBy: { periodStart: 'desc' },
  });
}

// ============================================================
// Plan Limit Enforcement
// ============================================================

export async function assertTenantCanAddUser(tenantId: string): Promise<void> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;

  const plan = PLANS[tenant.plan] || PLANS.free;
  const userCount = await db.user.count({ where: { tenantId } });

  if (userCount >= plan.maxUsers) {
    throw new ServiceError(
      `Tenant plan "${plan.name}" allows max ${plan.maxUsers} users. Upgrade to add more.`,
      403
    );
  }
}

export async function assertTenantCanAddSite(tenantId: string): Promise<void> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;

  const plan = PLANS[tenant.plan] || PLANS.free;
  const siteCount = await db.site.count({ where: { tenantId } });

  if (siteCount >= plan.maxSites) {
    throw new ServiceError(
      `Tenant plan "${plan.name}" allows max ${plan.maxSites} sites. Upgrade to add more.`,
      403
    );
  }
}

export async function assertTenantSubscriptionActive(tenantId: string): Promise<void> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;

  // Free plan is always active
  if (tenant.plan === 'free') return;

  // Check trial
  if (tenant.subscriptionStatus === 'trial') {
    if (tenant.trialEndsAt && new Date() > tenant.trialEndsAt) {
      throw new ServiceError('Trial period expired. Please activate a subscription.', 403);
    }
    return;
  }

  // Check active subscription
  if (tenant.subscriptionStatus === 'active') {
    if (tenant.subscriptionEndsAt && new Date() > tenant.subscriptionEndsAt) {
      // Auto-cancel expired subscription
      await db.tenant.update({
        where: { id: tenantId },
        data: { subscriptionStatus: 'past_due' },
      });
      throw new ServiceError('Subscription expired. Please renew.', 403);
    }
    return;
  }

  throw new ServiceError('No active subscription. Please activate a plan.', 403);
}

// ============================================================
// Usage Tracking
// ============================================================

export async function updateTenantUsage(tenantId: string): Promise<void> {
  const [userCount, siteCount] = await Promise.all([
    db.user.count({ where: { tenantId } }),
    db.site.count({ where: { tenantId } }),
  ]);

  await db.tenant.update({
    where: { id: tenantId },
    data: {
      currentUsers: userCount,
      currentSites: siteCount,
    },
  });
}

// ============================================================
// Tenant Dashboard Stats
// ============================================================

export async function getTenantDashboardStats(tenantId: string): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
  tenant: any;
  userCount: number;
  siteCount: number;
  reportCount: number;
  currentMonthReports: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parked billing module returns raw Prisma rows; typed when the domain is built out
  invoices: any[];
}> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [userCount, siteCount, reportCount, currentMonthReports, invoices] = await Promise.all([
    db.user.count({ where: { tenantId } }),
    db.site.count({ where: { tenantId } }),
    db.report.count({ where: { tenantId } }),
    db.report.count({ where: { tenantId, createdAt: { gte: monthStart } } }),
    db.tenantInvoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  return {
    tenant,
    userCount,
    siteCount,
    reportCount,
    currentMonthReports,
    invoices,
  };
}
