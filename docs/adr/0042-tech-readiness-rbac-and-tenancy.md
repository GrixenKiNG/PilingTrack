# ADR-0042: Tech Readiness RBAC and tenant isolation

- Status: Accepted
- Date: 2026-07-29
- Decision owners: Security and Tech Readiness backend

## Context

The current user role is stored as a string and existing permissions do not include a mechanic. Several legacy routes fall back to `DEFAULT_TENANT_ID`. Production Tech Readiness requires a dedicated `MECHANIC`, temporary `ADMIN`-as-mechanic behavior and non-disclosing cross-tenant failures.

## Decision

1. Add `MECHANIC` to the application role union and permission registry. Keep the database column as a string in the first additive migration to avoid a destructive PostgreSQL enum conversion.
2. Introduce explicit abilities: `readiness.read`, `readiness.shift.manage`, `readiness.handover.prepare`, `readiness.handover.decide`, `readiness.permit.edit`, `readiness.permit.approve_dispatcher`, `readiness.permit.approve_admin`, `readiness.rules.manage`, `readiness.audit.read`, and `readiness.audit.export`.
3. `ADMIN` receives mechanic execution abilities only through an explicit `actingAs=MECHANIC` command context. The actual role and acting role are both audited.
4. Tenant comes only from the verified session. Tech Readiness routes never accept or fall back to a body/query/environment tenant.
5. Every lookup is scoped by tenant before authorization of the entity state. Cross-tenant and missing identifiers both return `404`.
6. New foreign keys use `(tenantId, id)` composite references. Existing parents receive additive `@@unique([tenantId, id])` keys.
7. PostgreSQL RLS is defense in depth and must be fail-closed with `ENABLE` + `FORCE ROW LEVEL SECURITY`. Request transactions set `SET LOCAL app.current_tenant = <tenantId>`. Application/worker roles are non-owner without `BYPASSRLS`; migration owner is separate. An unset tenant is an error/denial, never access to all tenants, including on reused readiness source tables whose current policies are fail-open.
8. Workflow timezone comes only from `TenantSettings.timezone` (normalized to an IANA identifier, fallback `Europe/Moscow`); `User.timezone` is display-only. Client body/query timezone is rejected.

## Consequences

- Existing sessions remain valid because role storage is not converted to a database enum.
- `DEFAULT_TENANT_ID` is forbidden in this module.
- Deploying fail-closed RLS requires a verified tenant transaction wrapper for Prisma before enforcement is enabled.
- Assigning or removing `MECHANIC` increments `sessionVersion` so cached sessions cannot retain stale powers.
