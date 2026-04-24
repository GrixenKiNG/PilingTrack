-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxUsers" INTEGER NOT NULL DEFAULT 10,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "billingEmail" TEXT,
    "stripeCustomerId" TEXT,
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'inactive',
    "trialEndsAt" TIMESTAMP(3),
    "subscriptionEndsAt" TIMESTAMP(3),
    "lastBillingAt" TIMESTAMP(3),
    "monthlyFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "currentUsers" INTEGER NOT NULL DEFAULT 0,
    "currentSites" INTEGER NOT NULL DEFAULT 0,
    "storageUsedMB" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "stripeInvoiceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL DEFAULT '',
    "pin" TEXT,
    "pinLookup" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "qty" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceKey" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenantId" TEXT,
    "equipmentId" TEXT NOT NULL,
    "siteId" TEXT,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "plannedPiles" INTEGER NOT NULL DEFAULT 0,
    "plannedDrilling" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "completionDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePilePlan" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "pileGradeId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "metersPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePilePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDrillingPlan" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "diameter" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    "metersPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDrillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PileField" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PileField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Picket" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Picket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "operatorId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewAssistant" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewAssistant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSiteAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSiteAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "crewId" TEXT,
    "equipmentId" TEXT,
    "siteId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "shiftType" TEXT NOT NULL DEFAULT 'DAY',
    "shiftStart" TEXT,
    "shiftEnd" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "vectorClock" JSONB,
    "lastEditedById" TEXT,
    "lastEditedByName" TEXT,
    "lastEditedByRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportVersion" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAudit" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "beforeHash" TEXT,
    "afterHash" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryRecord" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "siteId" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "projected" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAnalytics" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalPiles" INTEGER NOT NULL DEFAULT 0,
    "totalDrilling" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDowntime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDailySummary" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "totalPiles" INTEGER NOT NULL DEFAULT 0,
    "totalDrilling" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDowntime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportStats" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "date" TEXT NOT NULL,
    "shiftType" TEXT NOT NULL,
    "totalPiles" INTEGER NOT NULL DEFAULT 0,
    "totalDrilling" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDowntime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downtimeCount" INTEGER NOT NULL DEFAULT 0,
    "pileGradeCount" INTEGER NOT NULL DEFAULT 0,
    "drillingCount" INTEGER NOT NULL DEFAULT 0,
    "pilesPerHour" DOUBLE PRECISION,
    "drillingPerHour" DOUBLE PRECISION,
    "topDowntimeReasonId" TEXT,
    "topDowntimeDuration" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorPerformance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "tenantId" TEXT,
    "date" TEXT NOT NULL,
    "totalPiles" INTEGER NOT NULL DEFAULT 0,
    "totalDrilling" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDowntime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "avgPilesPerReport" DOUBLE PRECISION,
    "avgDrillingPerReport" DOUBLE PRECISION,
    "avgDowntimePerReport" DOUBLE PRECISION,
    "downtimeRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DowntimeSummary" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "reasonName" TEXT NOT NULL,
    "tenantId" TEXT,
    "totalDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "affectedReports" INTEGER NOT NULL DEFAULT 0,
    "percentageOfTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DowntimeSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteWeeklyTrend" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT,
    "weekStart" TEXT NOT NULL,
    "weekEnd" TEXT NOT NULL,
    "dailyMetrics" JSONB NOT NULL,
    "totalPiles" INTEGER NOT NULL DEFAULT 0,
    "totalDrilling" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDowntime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "pilesTrend" TEXT,
    "drillingTrend" TEXT,
    "downtimeTrend" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteWeeklyTrend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PileWork" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "picketId" TEXT,
    "pileGradeId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PileWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderDrilling" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "picketId" TEXT,
    "typeId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "metersPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "meters" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderDrilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDowntime" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportDowntime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PileGrade" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PileGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillingType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrillingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DowntimeReason" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DowntimeReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramConfig" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackEvent" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "scope" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'OPERATIONS',
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "targetId" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackEventRead" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackEventRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "userId" TEXT,
    "userName" TEXT,
    "userRole" TEXT,
    "tenantId" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "result" JSONB,
    "error" TEXT,
    "statusCode" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceSyncState" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncStatus" TEXT NOT NULL DEFAULT 'idle',
    "lastError" TEXT,
    "changesSent" INTEGER NOT NULL DEFAULT 0,
    "changesRecv" INTEGER NOT NULL DEFAULT 0,
    "lastVectorClock" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "cdnUrl" TEXT,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "uploadStatus" TEXT NOT NULL DEFAULT 'pending',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictAudit" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "conflictType" TEXT NOT NULL,
    "resolutionStrategy" TEXT NOT NULL,
    "fieldsInConflict" JSONB NOT NULL,
    "resolutionDetails" JSONB NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "clientVersion" INTEGER,
    "serverVersion" INTEGER,
    "clientVectorClock" JSONB,
    "serverVectorClock" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportPhoto" (
    "id" TEXT NOT NULL,
    "reportId" TEXT,
    "siteId" TEXT NOT NULL,
    "tenantId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "description" TEXT,
    "photoType" TEXT NOT NULL DEFAULT 'work_evidence',
    "storagePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "mediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ReportPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadLetterQueue" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sourceOutboxId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadLetterQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_slug_idx" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_isActive_idx" ON "Tenant"("isActive");

-- CreateIndex
CREATE INDEX "Tenant_subscriptionStatus_idx" ON "Tenant"("subscriptionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "TenantInvoice_invoiceNumber_key" ON "TenantInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "TenantInvoice_tenantId_idx" ON "TenantInvoice"("tenantId");

-- CreateIndex
CREATE INDEX "TenantInvoice_status_idx" ON "TenantInvoice"("status");

-- CreateIndex
CREATE INDEX "TenantInvoice_periodStart_idx" ON "TenantInvoice"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_pin_key" ON "User"("pin");

-- CreateIndex
CREATE UNIQUE INDEX "User_pinLookup_key" ON "User"("pinLookup");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Equipment_isActive_idx" ON "Equipment"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceKey_keyHash_key" ON "DeviceKey"("keyHash");

-- CreateIndex
CREATE INDEX "DeviceKey_equipmentId_idx" ON "DeviceKey"("equipmentId");

-- CreateIndex
CREATE INDEX "DeviceKey_tenantId_idx" ON "DeviceKey"("tenantId");

-- CreateIndex
CREATE INDEX "DeviceKey_revoked_idx" ON "DeviceKey"("revoked");

-- CreateIndex
CREATE INDEX "Site_tenantId_idx" ON "Site"("tenantId");

-- CreateIndex
CREATE INDEX "Site_isActive_idx" ON "Site"("isActive");

-- CreateIndex
CREATE INDEX "Site_tenantId_isActive_idx" ON "Site"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "SitePilePlan_siteId_idx" ON "SitePilePlan"("siteId");

-- CreateIndex
CREATE INDEX "SiteDrillingPlan_siteId_idx" ON "SiteDrillingPlan"("siteId");

-- CreateIndex
CREATE INDEX "PileField_siteId_idx" ON "PileField"("siteId");

-- CreateIndex
CREATE INDEX "Cluster_fieldId_idx" ON "Cluster"("fieldId");

-- CreateIndex
CREATE INDEX "Picket_clusterId_idx" ON "Picket"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "Crew_operatorId_key" ON "Crew"("operatorId");

-- CreateIndex
CREATE INDEX "Crew_operatorId_idx" ON "Crew"("operatorId");

-- CreateIndex
CREATE INDEX "Crew_equipmentId_idx" ON "Crew"("equipmentId");

-- CreateIndex
CREATE INDEX "Crew_siteId_idx" ON "Crew"("siteId");

-- CreateIndex
CREATE INDEX "Crew_isActive_idx" ON "Crew"("isActive");

-- CreateIndex
CREATE INDEX "CrewAssistant_crewId_idx" ON "CrewAssistant"("crewId");

-- CreateIndex
CREATE INDEX "UserSiteAssignment_userId_idx" ON "UserSiteAssignment"("userId");

-- CreateIndex
CREATE INDEX "UserSiteAssignment_siteId_idx" ON "UserSiteAssignment"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSiteAssignment_userId_siteId_key" ON "UserSiteAssignment"("userId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reportId_key" ON "Report"("reportId");

-- CreateIndex
CREATE INDEX "Report_tenantId_idx" ON "Report"("tenantId");

-- CreateIndex
CREATE INDEX "Report_tenantId_updatedAt_idx" ON "Report"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "Report_userId_date_idx" ON "Report"("userId", "date");

-- CreateIndex
CREATE INDEX "Report_siteId_date_idx" ON "Report"("siteId", "date");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "Report_crewId_idx" ON "Report"("crewId");

-- CreateIndex
CREATE INDEX "Report_equipmentId_idx" ON "Report"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_userId_siteId_date_key" ON "Report"("userId", "siteId", "date");

-- CreateIndex
CREATE INDEX "ReportVersion_reportId_idx" ON "ReportVersion"("reportId");

-- CreateIndex
CREATE INDEX "ReportVersion_createdAt_idx" ON "ReportVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportVersion_reportId_version_key" ON "ReportVersion"("reportId", "version");

-- CreateIndex
CREATE INDEX "ReportAudit_reportId_idx" ON "ReportAudit"("reportId");

-- CreateIndex
CREATE INDEX "ReportAudit_actorId_createdAt_idx" ON "ReportAudit"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportAudit_createdAt_idx" ON "ReportAudit"("createdAt");

-- CreateIndex
CREATE INDEX "TelemetryRecord_equipmentId_timestamp_idx" ON "TelemetryRecord"("equipmentId", "timestamp");

-- CreateIndex
CREATE INDEX "TelemetryRecord_siteId_timestamp_idx" ON "TelemetryRecord"("siteId", "timestamp");

-- CreateIndex
CREATE INDEX "TelemetryRecord_type_timestamp_idx" ON "TelemetryRecord"("type", "timestamp");

-- CreateIndex
CREATE INDEX "OutboxEvent_published_nextRetryAt_idx" ON "OutboxEvent"("published", "nextRetryAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_published_createdAt_idx" ON "OutboxEvent"("published", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_projected_createdAt_idx" ON "OutboxEvent"("projected", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateId_aggregateType_idx" ON "OutboxEvent"("aggregateId", "aggregateType");

-- CreateIndex
CREATE UNIQUE INDEX "ReportAnalytics_reportId_key" ON "ReportAnalytics"("reportId");

-- CreateIndex
CREATE INDEX "ReportAnalytics_siteId_idx" ON "ReportAnalytics"("siteId");

-- CreateIndex
CREATE INDEX "ReportAnalytics_userId_idx" ON "ReportAnalytics"("userId");

-- CreateIndex
CREATE INDEX "ReportAnalytics_tenantId_idx" ON "ReportAnalytics"("tenantId");

-- CreateIndex
CREATE INDEX "ReportAnalytics_status_idx" ON "ReportAnalytics"("status");

-- CreateIndex
CREATE INDEX "SiteDailySummary_siteId_idx" ON "SiteDailySummary"("siteId");

-- CreateIndex
CREATE INDEX "SiteDailySummary_date_idx" ON "SiteDailySummary"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SiteDailySummary_siteId_date_key" ON "SiteDailySummary"("siteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReportStats_reportId_key" ON "ReportStats"("reportId");

-- CreateIndex
CREATE INDEX "ReportStats_siteId_date_idx" ON "ReportStats"("siteId", "date");

-- CreateIndex
CREATE INDEX "ReportStats_userId_date_idx" ON "ReportStats"("userId", "date");

-- CreateIndex
CREATE INDEX "ReportStats_tenantId_idx" ON "ReportStats"("tenantId");

-- CreateIndex
CREATE INDEX "ReportStats_date_idx" ON "ReportStats"("date");

-- CreateIndex
CREATE INDEX "OperatorPerformance_userId_date_idx" ON "OperatorPerformance"("userId", "date");

-- CreateIndex
CREATE INDEX "OperatorPerformance_siteId_date_idx" ON "OperatorPerformance"("siteId", "date");

-- CreateIndex
CREATE INDEX "OperatorPerformance_tenantId_idx" ON "OperatorPerformance"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorPerformance_userId_siteId_date_key" ON "OperatorPerformance"("userId", "siteId", "date");

-- CreateIndex
CREATE INDEX "DowntimeSummary_siteId_date_idx" ON "DowntimeSummary"("siteId", "date");

-- CreateIndex
CREATE INDEX "DowntimeSummary_reasonId_idx" ON "DowntimeSummary"("reasonId");

-- CreateIndex
CREATE INDEX "DowntimeSummary_tenantId_idx" ON "DowntimeSummary"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DowntimeSummary_siteId_date_reasonId_key" ON "DowntimeSummary"("siteId", "date", "reasonId");

-- CreateIndex
CREATE INDEX "SiteWeeklyTrend_siteId_weekStart_idx" ON "SiteWeeklyTrend"("siteId", "weekStart");

-- CreateIndex
CREATE INDEX "SiteWeeklyTrend_tenantId_idx" ON "SiteWeeklyTrend"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteWeeklyTrend_siteId_weekStart_key" ON "SiteWeeklyTrend"("siteId", "weekStart");

-- CreateIndex
CREATE INDEX "PileWork_reportId_idx" ON "PileWork"("reportId");

-- CreateIndex
CREATE INDEX "PileWork_picketId_idx" ON "PileWork"("picketId");

-- CreateIndex
CREATE INDEX "PileWork_pileGradeId_idx" ON "PileWork"("pileGradeId");

-- CreateIndex
CREATE INDEX "LeaderDrilling_reportId_idx" ON "LeaderDrilling"("reportId");

-- CreateIndex
CREATE INDEX "LeaderDrilling_picketId_idx" ON "LeaderDrilling"("picketId");

-- CreateIndex
CREATE INDEX "LeaderDrilling_typeId_idx" ON "LeaderDrilling"("typeId");

-- CreateIndex
CREATE INDEX "ReportDowntime_reportId_idx" ON "ReportDowntime"("reportId");

-- CreateIndex
CREATE INDEX "ReportDowntime_reasonId_idx" ON "ReportDowntime"("reasonId");

-- CreateIndex
CREATE INDEX "FeedbackEvent_createdAt_idx" ON "FeedbackEvent"("createdAt");

-- CreateIndex
CREATE INDEX "FeedbackEvent_scope_createdAt_idx" ON "FeedbackEvent"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackEvent_actorId_createdAt_idx" ON "FeedbackEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackEvent_audience_createdAt_idx" ON "FeedbackEvent"("audience", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackEvent_level_createdAt_idx" ON "FeedbackEvent"("level", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackEvent_priority_createdAt_idx" ON "FeedbackEvent"("priority", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackEventRead_userId_readAt_idx" ON "FeedbackEventRead"("userId", "readAt");

-- CreateIndex
CREATE INDEX "FeedbackEventRead_userId_acknowledgedAt_idx" ON "FeedbackEventRead"("userId", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackEventRead_eventId_userId_key" ON "FeedbackEventRead"("eventId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_timestamp_idx" ON "AuditLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_timestamp_idx" ON "AuditLog"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_action_timestamp_idx" ON "AuditLog"("action", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "IdempotencyKey_scope_key_idx" ON "IdempotencyKey"("scope", "key");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_status_createdAt_idx" ON "IdempotencyKey"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceSyncState_deviceId_key" ON "DeviceSyncState"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceSyncState_tenantId_idx" ON "DeviceSyncState"("tenantId");

-- CreateIndex
CREATE INDEX "DeviceSyncState_syncStatus_idx" ON "DeviceSyncState"("syncStatus");

-- CreateIndex
CREATE INDEX "DeviceSyncState_lastSyncAt_idx" ON "DeviceSyncState"("lastSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "Media_key_key" ON "Media"("key");

-- CreateIndex
CREATE INDEX "Media_tenantId_idx" ON "Media"("tenantId");

-- CreateIndex
CREATE INDEX "Media_userId_idx" ON "Media"("userId");

-- CreateIndex
CREATE INDEX "Media_entityType_entityId_idx" ON "Media"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Media_uploadStatus_idx" ON "Media"("uploadStatus");

-- CreateIndex
CREATE INDEX "Media_isDeleted_deletedAt_idx" ON "Media"("isDeleted", "deletedAt");

-- CreateIndex
CREATE INDEX "ConflictAudit_entityId_createdAt_idx" ON "ConflictAudit"("entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ConflictAudit_tenantId_createdAt_idx" ON "ConflictAudit"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ConflictAudit_deviceId_createdAt_idx" ON "ConflictAudit"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "ConflictAudit_resolutionStrategy_idx" ON "ConflictAudit"("resolutionStrategy");

-- CreateIndex
CREATE INDEX "ConflictAudit_conflictType_idx" ON "ConflictAudit"("conflictType");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_family_idx" ON "RefreshToken"("family");

-- CreateIndex
CREATE INDEX "RefreshToken_revoked_expiresAt_idx" ON "RefreshToken"("revoked", "expiresAt");

-- CreateIndex
CREATE INDEX "ReportPhoto_reportId_idx" ON "ReportPhoto"("reportId");

-- CreateIndex
CREATE INDEX "ReportPhoto_siteId_idx" ON "ReportPhoto"("siteId");

-- CreateIndex
CREATE INDEX "ReportPhoto_tenantId_idx" ON "ReportPhoto"("tenantId");

-- CreateIndex
CREATE INDEX "ReportPhoto_createdAt_idx" ON "ReportPhoto"("createdAt");

-- CreateIndex
CREATE INDEX "ReportPhoto_photoType_idx" ON "ReportPhoto"("photoType");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_status_createdAt_idx" ON "DeadLetterQueue"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_eventType_idx" ON "DeadLetterQueue"("eventType");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_aggregateId_idx" ON "DeadLetterQueue"("aggregateId");

-- AddForeignKey
ALTER TABLE "TenantInvoice" ADD CONSTRAINT "TenantInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceKey" ADD CONSTRAINT "DeviceKey_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePilePlan" ADD CONSTRAINT "SitePilePlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePilePlan" ADD CONSTRAINT "SitePilePlan_pileGradeId_fkey" FOREIGN KEY ("pileGradeId") REFERENCES "PileGrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDrillingPlan" ADD CONSTRAINT "SiteDrillingPlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PileField" ADD CONSTRAINT "PileField_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "PileField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Picket" ADD CONSTRAINT "Picket_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewAssistant" ADD CONSTRAINT "CrewAssistant_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteAssignment" ADD CONSTRAINT "UserSiteAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteAssignment" ADD CONSTRAINT "UserSiteAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PileWork" ADD CONSTRAINT "PileWork_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PileWork" ADD CONSTRAINT "PileWork_picketId_fkey" FOREIGN KEY ("picketId") REFERENCES "Picket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PileWork" ADD CONSTRAINT "PileWork_pileGradeId_fkey" FOREIGN KEY ("pileGradeId") REFERENCES "PileGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderDrilling" ADD CONSTRAINT "LeaderDrilling_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderDrilling" ADD CONSTRAINT "LeaderDrilling_picketId_fkey" FOREIGN KEY ("picketId") REFERENCES "Picket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderDrilling" ADD CONSTRAINT "LeaderDrilling_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "DrillingType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDowntime" ADD CONSTRAINT "ReportDowntime_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDowntime" ADD CONSTRAINT "ReportDowntime_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "DowntimeReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEventRead" ADD CONSTRAINT "FeedbackEventRead_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "FeedbackEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEventRead" ADD CONSTRAINT "FeedbackEventRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
