# E2 IDOR inventory

Inventory generated from route source; guard names are evidence pointers, not proof of every callee. Shared withApi tenant/RLS context and non-BYPASS app role are checked separately. ADMIN/DISPATCHER platform scope is unchanged. Runtime coverage is listed below; "static" means no route-specific live test and must not be read as passed.

| Route | Method | Route guard / ability | IDs | Test |
|---|---|---|---|---|
| /api/admin/analytics/overview | GET | requireAuth; analytics.read | siteId | static; src/app/api/admin/analytics/overview/route.ts |
| /api/admin/analytics/site-weekly-trend | GET | requireAuth; analytics.read | siteId | static; src/app/api/admin/analytics/site-weekly-trend/route.ts |
| /api/admin/incidents | GET | requireAuth; incidents.read | id | static; src/app/api/admin/incidents/route.ts |
| /api/admin/incidents | POST | requireAuth; incidents.review | id | static; src/app/api/admin/incidents/route.ts |
| /api/analytics/sites | GET | requireAuth, requireTenantId; sites.read_all | siteId | static; src/app/api/analytics/sites/route.ts |
| /api/audit | GET | requireAuth; system.read | targetId | static; src/app/api/audit/route.ts |
| /api/auth/me | GET | requireAuth, resolveAccessibleUserId, ensureTenantAccess;  | userId | static; src/app/api/auth/me/route.ts |
| /api/briefings/[id]/sign | POST | requireAuth, requireTenantId;  | path  | static; src/app/api/briefings/[id]/sign/route.ts |
| /api/checklist-templates/[id] | GET | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/checklist-templates/[id]/route.ts |
| /api/checklist-templates/[id] | PUT | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/checklist-templates/[id]/route.ts |
| /api/checklist-templates/[id] | DELETE | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/checklist-templates/[id]/route.ts |
| /api/crews/my | GET | requireAuth, ensureTenantAccess;  | operatorId | static; src/app/api/crews/my/route.ts |
| /api/crews | GET | requireAuth, requireTenantId; crews.read | siteId, operatorId, equipmentId | static; src/app/api/crews/route.ts |
| /api/crews | POST | requireAuth; crews.manage | siteId, operatorId, equipmentId | static; src/app/api/crews/route.ts |
| /api/crews/[id] | GET | requireAuth, ensureTenantAccess; crews.read | path operatorId, equipmentId, siteId | static; src/app/api/crews/[id]/route.ts |
| /api/crews/[id] | PUT | requireAuth, requireTenantId; crews.manage | path operatorId, equipmentId, siteId | static; src/app/api/crews/[id]/route.ts |
| /api/crews/[id] | DELETE | requireAuth, requireTenantId; crews.manage | path operatorId, equipmentId, siteId | static; src/app/api/crews/[id]/route.ts |
| /api/dictionary/manage | GET | requireAuth; dictionary.manage | id | static; src/app/api/dictionary/manage/route.ts |
| /api/dictionary/manage | POST | requireAuth; dictionary.manage | id | static; src/app/api/dictionary/manage/route.ts |
| /api/dictionary/manage | PATCH | requireAuth; dictionary.manage | id | static; src/app/api/dictionary/manage/route.ts |
| /api/dictionary/manage | DELETE | requireAuth; dictionary.manage | id | static; src/app/api/dictionary/manage/route.ts |
| /api/equipment | GET | requireAuth, requireTenantId;  | siteId | static; src/app/api/equipment/route.ts |
| /api/equipment | POST | requireAuth, requireTenantId; equipment.manage | siteId | static; src/app/api/equipment/route.ts |
| /api/equipment/[id]/details | GET | requireAuth, requireTenantId; equipment.read | path  | static; src/app/api/equipment/[id]/details/route.ts |
| /api/equipment/[id]/device-keys | POST | requireAuth, requireTenantId; equipment.manage | path siteId, keyId | static; src/app/api/equipment/[id]/device-keys/route.ts |
| /api/equipment/[id]/device-keys | GET | requireAuth; equipment.manage | path siteId, keyId | static; src/app/api/equipment/[id]/device-keys/route.ts |
| /api/equipment/[id]/device-keys | DELETE | requireAuth; equipment.manage | path siteId, keyId | static; src/app/api/equipment/[id]/device-keys/route.ts |
| /api/equipment/[id]/documents | POST | requireAuth, requireTenantId; equipment.manage | path  | static; src/app/api/equipment/[id]/documents/route.ts |
| /api/equipment/[id]/documents/[docId] | PUT | requireAuth, requireTenantId; equipment.manage | path  | static; src/app/api/equipment/[id]/documents/[docId]/route.ts |
| /api/equipment/[id]/documents/[docId] | DELETE | requireAuth, requireTenantId; equipment.manage | path  | static; src/app/api/equipment/[id]/documents/[docId]/route.ts |
| /api/equipment/[id]/fuel | GET | requireAuth, requireTenantId; meter.record | path  | static; src/app/api/equipment/[id]/fuel/route.ts |
| /api/equipment/[id]/fuel | POST | requireAuth, requireTenantId; meter.record | path  | static; src/app/api/equipment/[id]/fuel/route.ts |
| /api/equipment/[id]/fuel/[entryId] | DELETE | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/equipment/[id]/fuel/[entryId]/route.ts |
| /api/equipment/[id]/maintenance | GET | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/equipment/[id]/maintenance/route.ts |
| /api/equipment/[id]/maintenance | POST | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/equipment/[id]/maintenance/route.ts |
| /api/equipment/[id]/maintenance/[recordId] | PUT | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/equipment/[id]/maintenance/[recordId]/route.ts |
| /api/equipment/[id]/maintenance/[recordId] | DELETE | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/equipment/[id]/maintenance/[recordId]/route.ts |
| /api/equipment/[id]/meter-readings | GET | requireAuth, requireTenantId; meter.record | path  | static; src/app/api/equipment/[id]/meter-readings/route.ts |
| /api/equipment/[id]/meter-readings | POST | requireAuth, requireTenantId; meter.record | path  | static; src/app/api/equipment/[id]/meter-readings/route.ts |
| /api/equipment/[id]/meter-readings/[readingId] | DELETE | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/equipment/[id]/meter-readings/[readingId]/route.ts |
| /api/equipment/[id] | GET | requireAuth, requireTenantId;  | path  | static; src/app/api/equipment/[id]/route.ts |
| /api/equipment/[id] | PUT | requireAuth, requireTenantId; equipment.manage | path  | static; src/app/api/equipment/[id]/route.ts |
| /api/equipment/[id] | DELETE | requireAuth, requireTenantId; equipment.manage | path  | static; src/app/api/equipment/[id]/route.ts |
| /api/feedback/events | GET | requireAuth;  | eventId, targetId | static; src/app/api/feedback/events/route.ts |
| /api/feedback/events | POST | requireAuth;  | eventId, targetId | static; src/app/api/feedback/events/route.ts |
| /api/feedback/events | PATCH | ;  | eventId, targetId | static; src/app/api/feedback/events/route.ts |
| /api/inspections | GET | requireAuth, requireTenantId; inspection.perform | equipmentId | static; src/app/api/inspections/route.ts |
| /api/inspections | POST | requireAuth, requireTenantId; inspection.perform | equipmentId | static; src/app/api/inspections/route.ts |
| /api/inspections/[id]/complete | POST | requireAuth, requireTenantId; inspection.perform | path  | static; src/app/api/inspections/[id]/complete/route.ts |
| /api/inspections/[id] | GET | requireAuth, requireTenantId; inspection.perform | path  | static; src/app/api/inspections/[id]/route.ts |
| /api/inspections/[id] | PUT | requireAuth, requireTenantId; inspection.perform | path  | static; src/app/api/inspections/[id]/route.ts |
| /api/layout/[surfaceId] | GET | requireAuth;  | path entityId | static; src/app/api/layout/[surfaceId]/route.ts |
| /api/layout/[surfaceId] | PUT | requireAuth;  | path entityId | static; src/app/api/layout/[surfaceId]/route.ts |
| /api/layout/[surfaceId] | DELETE | requireAuth;  | path entityId | static; src/app/api/layout/[surfaceId]/route.ts |
| /api/maintenance/[id]/accept | POST | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/maintenance/[id]/accept/route.ts |
| /api/maintenance/[id] | GET | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/maintenance/[id]/route.ts |
| /api/maintenance-plans | GET | requireAuth, requireTenantId; maintenance.manage | equipmentId | static; src/app/api/maintenance-plans/route.ts |
| /api/maintenance-plans | POST | requireAuth, requireTenantId; maintenance.manage | equipmentId | static; src/app/api/maintenance-plans/route.ts |
| /api/maintenance-plans/[id] | PATCH | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/maintenance-plans/[id]/route.ts |
| /api/maintenance-plans/[id] | DELETE | requireAuth, requireTenantId; maintenance.manage | path  | static; src/app/api/maintenance-plans/[id]/route.ts |
| /api/media | POST | requireAuth, assertCanAccessMediaEntity, requireTenantId;  | entityId | static; src/app/api/media/route.ts |
| /api/media | GET | requireAuth, assertCanAccessMediaEntity, requireTenantId;  | entityId | static; src/app/api/media/route.ts |
| /api/media/[id]/confirm | POST | requireAuth, assertCanAccessMedia;  | path  | static; src/app/api/media/[id]/confirm/route.ts |
| /api/media/[id]/download | GET | requireAuth, assertCanAccessMedia;  | path  | static; src/app/api/media/[id]/download/route.ts |
| /api/media/[id] | DELETE | requireAuth, assertCanAccessMedia;  | path  | static; src/app/api/media/[id]/route.ts |
| /api/operator/mobile/command | POST | requireAuth;  | shiftId, clientCommandId | static; src/app/api/operator/mobile/command/route.ts |
| /api/pile-passports/[id]/decide | POST | requireAuth, requireTenantId; piles.manage | path  | static; src/app/api/pile-passports/[id]/decide/route.ts |
| /api/readiness/current | GET | ;  | equipmentId | static; src/app/api/readiness/current/route.ts |
| /api/readiness/defects | POST | ;  | equipmentId | static; src/app/api/readiness/defects/route.ts |
| /api/readiness/defects | GET | ;  | equipmentId | static; src/app/api/readiness/defects/route.ts |
| /api/readiness/defects/[id]/reject | POST | ;  | path  | static; src/app/api/readiness/defects/[id]/reject/route.ts |
| /api/readiness/defects/[id]/resolve | POST | ;  | path  | static; src/app/api/readiness/defects/[id]/resolve/route.ts |
| /api/readiness/defects/[id]/triage | POST | ;  | path  | static; src/app/api/readiness/defects/[id]/triage/route.ts |
| /api/readiness/handovers/[id]/accept | POST | ;  | path  | static; src/app/api/readiness/handovers/[id]/accept/route.ts |
| /api/readiness/handovers/[id]/rework | POST | ;  | path  | static; src/app/api/readiness/handovers/[id]/rework/route.ts |
| /api/readiness/handovers/[id] | GET | ;  | path  | static; src/app/api/readiness/handovers/[id]/route.ts |
| /api/readiness/place-presets | POST | ;  | id | static; src/app/api/readiness/place-presets/route.ts |
| /api/readiness/place-presets | DELETE | ;  | id | static; src/app/api/readiness/place-presets/route.ts |
| /api/readiness/shifts/[id]/cancel | POST | ;  | path  | static; src/app/api/readiness/shifts/[id]/cancel/route.ts |
| /api/readiness/shifts/[id]/decline | POST | ;  | path  | static; src/app/api/readiness/shifts/[id]/decline/route.ts |
| /api/readiness/shifts/[id]/handover | POST | ;  | path  | static; src/app/api/readiness/shifts/[id]/handover/route.ts |
| /api/readiness/shifts/[id]/request-acceptance | POST | ;  | path  | static; src/app/api/readiness/shifts/[id]/request-acceptance/route.ts |
| /api/readiness/shifts/[id] | PATCH | ;  | path  | static; src/app/api/readiness/shifts/[id]/route.ts |
| /api/readiness/shifts/[id] | GET | ;  | path  | static; src/app/api/readiness/shifts/[id]/route.ts |
| /api/readiness/shifts/[id]/start | POST | ;  | path  | static; src/app/api/readiness/shifts/[id]/start/route.ts |
| /api/readiness/shifts/[id]/waiver | POST | ;  | path  | static; src/app/api/readiness/shifts/[id]/waiver/route.ts |
| /api/readiness/work-permits/[id]/approve | POST | ;  | path  | static; src/app/api/readiness/work-permits/[id]/approve/route.ts |
| /api/readiness/work-permits/[id]/revoke | POST | ;  | path  | static; src/app/api/readiness/work-permits/[id]/revoke/route.ts |
| /api/readiness/work-permits/[id] | PATCH | ;  | path  | static; src/app/api/readiness/work-permits/[id]/route.ts |
| /api/readiness/work-permits/[id] | GET | ;  | path  | static; src/app/api/readiness/work-permits/[id]/route.ts |
| /api/readiness/work-permits/[id]/submit | POST | ;  | path  | static; src/app/api/readiness/work-permits/[id]/submit/route.ts |
| /api/reports/all | GET | requireAuth; reports.read_all | siteId, userId | static; src/app/api/reports/all/route.ts |
| /api/reports/delete | DELETE | requireAuth, requireTenantId; reports.manage_all | reportId | static; src/app/api/reports/delete/route.ts |
| /api/reports/edit | GET | requireAuth;  | userId, siteId | static; src/app/api/reports/edit/route.ts |
| /api/reports/export | GET | requireAuth, requireTenantId; reports.export | siteId, userId, equipmentId | static; src/app/api/reports/export/route.ts |
| /api/reports/my | GET | requireAuth;  | userId | static; src/app/api/reports/my/route.ts |
| /api/reports/pdf | POST | requireAuth; reports.read_all | jobId, siteId, userId, equipmentId | static; src/app/api/reports/pdf/route.ts |
| /api/reports/pdf | GET | requireAuth; reports.read_all, reports.read_all | jobId, siteId, userId, equipmentId | static; src/app/api/reports/pdf/route.ts |
| /api/reports/period | GET | requireAuth; reports.read_all | siteId, userId | static; src/app/api/reports/period/route.ts |
| /api/reports/single-pdf | POST | requireAuth, ensureTenantAccess, assertCanAccessReportOwner;  | reportId, jobId | static; src/app/api/reports/single-pdf/route.ts |
| /api/reports/single-pdf | GET | requireAuth, assertCanAccessReportOwner, ensureTenantAccess; reports.read_cross_user | reportId, jobId | static; src/app/api/reports/single-pdf/route.ts |
| /api/reports/[id]/history | GET | requireAuth; reports.read_all | path  | static; src/app/api/reports/[id]/history/route.ts |
| /api/safety/equipment-permits | GET | requireAuth, requireTenantId;  | userId | static; src/app/api/safety/equipment-permits/route.ts |
| /api/safety/equipment-permits | POST | requireAuth, requireTenantId;  | userId | static; src/app/api/safety/equipment-permits/route.ts |
| /api/safety/equipment-permits/[id] | DELETE | requireAuth, requireTenantId;  | path  | static; src/app/api/safety/equipment-permits/[id]/route.ts |
| /api/sites | GET | requireAuth, requireTenantId;  | userId | static; src/app/api/sites/route.ts |
| /api/sites/[id]/assign | POST | requireAuth, requireTenantId; sites.assign_users | path userId | static; src/app/api/sites/[id]/assign/route.ts |
| /api/sites/[id]/assign | DELETE | requireAuth, requireTenantId; sites.assign_users | path userId | static; src/app/api/sites/[id]/assign/route.ts |
| /api/sites/[id]/hierarchy | POST | requireAuth, requireTenantId; sites.manage_hierarchy | path parentId, itemId | static; src/app/api/sites/[id]/hierarchy/route.ts |
| /api/sites/[id]/hierarchy | DELETE | requireAuth, requireTenantId; sites.manage_hierarchy | path parentId, itemId | static; src/app/api/sites/[id]/hierarchy/route.ts |
| /api/sites/[id] | GET | requireAuth, requireTenantId;  | path  | static; src/app/api/sites/[id]/route.ts |
| /api/sites/[id] | PUT | requireAuth, requireTenantId; sites.manage | path  | static; src/app/api/sites/[id]/route.ts |
| /api/sites/[id] | DELETE | requireAuth, requireTenantId; sites.manage | path  | static; src/app/api/sites/[id]/route.ts |
| /api/telegram/configs | GET | requireAuth, requireTenantId; telegram.manage | id | static; src/app/api/telegram/configs/route.ts |
| /api/telegram/configs | POST | requireAuth, requireTenantId; telegram.manage | id | static; src/app/api/telegram/configs/route.ts |
| /api/telegram/configs | PUT | requireAuth, requireTenantId; telegram.manage | id | static; src/app/api/telegram/configs/route.ts |
| /api/telegram/configs | DELETE | requireAuth, requireTenantId; telegram.manage | id | static; src/app/api/telegram/configs/route.ts |
| /api/telemetry | POST | requireAuth, requireTenantId;  | equipmentId, siteId | static; src/app/api/telemetry/route.ts |
| /api/telemetry | GET | requireAuth, requireTenantId; analytics.read, analytics.read | equipmentId, siteId | static; src/app/api/telemetry/route.ts |
| /api/to/journal | GET | requireAuth, requireTenantId; maintenance.manage | equipmentId | static; src/app/api/to/journal/route.ts |
| /api/user-document-types/[id] | PATCH | requireAuth, requireTenantId;  | path  | static; src/app/api/user-document-types/[id]/route.ts |
| /api/user-document-types/[id] | DELETE | requireAuth, requireTenantId;  | path  | static; src/app/api/user-document-types/[id]/route.ts |
| /api/users | GET | requireAuth; users.read | id | static; src/app/api/users/route.ts |
| /api/users | POST | requireAuth; users.manage | id | static; src/app/api/users/route.ts |
| /api/users | PUT | requireAuth; users.manage | id | static; src/app/api/users/route.ts |
| /api/users | DELETE | requireAuth; users.manage | id | static; src/app/api/users/route.ts |
| /api/users/[id]/documents | GET | requireAuth;  | path  | static; src/app/api/users/[id]/documents/route.ts |
| /api/users/[id]/documents | POST | requireAuth;  | path  | static; src/app/api/users/[id]/documents/route.ts |
| /api/users/[id]/documents/[docId] | PUT | requireAuth;  | path  | static; src/app/api/users/[id]/documents/[docId]/route.ts |
| /api/users/[id]/documents/[docId] | DELETE | requireAuth;  | path  | static; src/app/api/users/[id]/documents/[docId]/route.ts |
