# Admin Command Center Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current administrator dashboard with a dense PilingTrack command center matching the approved visual reference while displaying only real, tenant-scoped operational data.

**Architecture:** Keep `AdminDashboard` as the data-loading boundary, add one dashboard snapshot API for chart-ready aggregates, and split the visual surface into focused components. Existing analytics, fleet, maintenance, and report sources remain authoritative; new derived series and comparisons are computed server-side so the browser does not reconstruct business data.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Recharts 3, Prisma/PostgreSQL, Vitest, Playwright.

## Global Constraints

- Match the approved reference's information density, graphite navigation, light working canvas, compact typography, strong status colors, and 4-6 px radii.
- Do not copy invented values from the reference; every number must come from an existing tenant-scoped source or display an explicit unavailable state.
- Preserve the current period, site, and rig filters and existing destination routes.
- Use minutes as the internal downtime unit and format hours only at the presentation boundary.
- No new map or chart dependency: use the installed `recharts` package and a lightweight coordinate plot for sites.
- Desktop is the primary command-center viewport; tablet stacks panels; mobile preserves actions and summaries without horizontal page overflow.
- Meet keyboard navigation, visible focus, reduced-motion, contrast, loading, partial-data, empty, and error requirements.

---

### Task 1: Dashboard snapshot contract and pure aggregation

**Files:**
- Create: `src/modules/analytics/application/queries/admin-dashboard-snapshot.ts`
- Create: `src/app/api/analytics/admin-dashboard/route.ts`
- Create: `src/modules/analytics/application/queries/__tests__/admin-dashboard-snapshot.test.ts`
- Modify: `src/modules/analytics/index.ts`

**Interfaces:**
- Produces: `getAdminDashboardSnapshot(user, filters): Promise<AdminDashboardSnapshot>`.
- Produces: `AdminDashboardSnapshot` with `summary`, `shiftSeries`, `downtimeReasons`, `sites`, `equipmentLoad`, `reportProgress`, `maintenanceRisks`, `timeline`, and `comparisons`.
- Consumes: existing report, analytics, fleet, maintenance, site, and tenant scoping repositories.

- [ ] **Step 1: Write failing aggregation tests**

```ts
it('returns cumulative shift series ordered by time', async () => {
  const result = await buildAdminDashboardSnapshot(fixture);
  expect(result.shiftSeries.map((point) => point.time)).toEqual(['08:00', '10:00', '12:00']);
  expect(result.shiftSeries.at(-1)).toMatchObject({ piles: 42, drillingMeters: 108, downtimeMinutes: 90 });
});

it('never mixes another tenant into site or equipment totals', async () => {
  const result = await buildAdminDashboardSnapshot(fixture, { tenantId: 'tenant-a' });
  expect(result.sites.every((site) => site.tenantId === 'tenant-a')).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run src/modules/analytics/application/queries/__tests__/admin-dashboard-snapshot.test.ts`

Expected: FAIL because the snapshot builder does not exist.

- [ ] **Step 3: Implement typed, tenant-scoped aggregation**

```ts
export interface AdminDashboardSnapshot {
  generatedAt: string;
  summary: {
    planPercent: number | null;
    actualPiles: number;
    plannedPiles: number;
    actualPileMeters: number;
    actualDrillingMeters: number;
    plannedDrillingMeters: number;
    downtimeMinutes: number;
    reportsDone: number;
    reportsExpected: number;
    rigsWorking: number;
    rigsTotal: number;
  };
  shiftSeries: Array<{ time: string; piles: number; drillingMeters: number; downtimeMinutes: number }>;
  downtimeReasons: Array<{ id: string; name: string; minutes: number; share: number }>;
  sites: Array<{ id: string; tenantId: string; name: string; latitude: number | null; longitude: number | null; progress: number | null; status: 'ok' | 'warning' | 'critical' }>;
  equipmentLoad: Array<{ id: string; name: string; utilizationPercent: number | null; status: 'working' | 'idle' | 'expected' }>;
  reportProgress: { done: number; expected: number; overdue: number };
  maintenanceRisks: Array<{ equipmentId: string; name: string; severity: 'warning' | 'critical'; hint: string }>;
  timeline: Array<{ id: string; occurredAt: string; kind: 'report' | 'downtime' | 'maintenance'; title: string; href: string }>;
  comparisons: Array<{ key: 'piles' | 'drilling' | 'downtime' | 'productivity'; current: number; planDeltaPercent: number | null; previousShiftDeltaPercent: number | null }>;
}
```

- [ ] **Step 4: Add authenticated route parsing current filters**

```ts
export const GET = withApiAuth(async (request, user) => {
  const filters = adminDashboardFilterSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  return NextResponse.json(await getAdminDashboardSnapshot(user, filters));
}, { roles: ['ADMIN', 'DISPATCHER'] });
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/modules/analytics/application/queries/__tests__/admin-dashboard-snapshot.test.ts`

Expected: PASS with tenant isolation, unit conversion, sorting, empty-state, and comparison cases covered.

### Task 2: Visualization primitives

**Files:**
- Create: `src/components/piling/admin-command-center/dashboard-types.ts`
- Create: `src/components/piling/admin-command-center/plan-gauge.tsx`
- Create: `src/components/piling/admin-command-center/shift-dynamics-chart.tsx`
- Create: `src/components/piling/admin-command-center/downtime-donut.tsx`
- Create: `src/components/piling/admin-command-center/site-coordinate-plot.tsx`
- Create: `src/components/piling/admin-command-center/equipment-load-chart.tsx`
- Create: `src/components/piling/admin-command-center/report-progress.tsx`
- Create: `src/components/piling/admin-command-center/__tests__/visualizations.test.tsx`

**Interfaces:**
- Consumes only fields from `AdminDashboardSnapshot`.
- Produces accessible chart components with textual fallback values and no business aggregation.

- [ ] **Step 1: Write failing component tests**

```tsx
render(<PlanGauge value={87} actual={1088} planned={1250} />);
expect(screen.getByText('87%')).toBeVisible();
expect(screen.getByLabelText('Выполнение плана: 87%')).toBeVisible();

render(<SiteCoordinatePlot sites={[siteWithoutCoordinates]} />);
expect(screen.getByText('Координаты не заданы')).toBeVisible();
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/components/piling/admin-command-center/__tests__/visualizations.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement chart primitives with Recharts**

Use `ResponsiveContainer`, `LineChart`, `Area`, `PieChart`, and `BarChart`; render legends in Russian and expose the same values as text for screen readers. The site panel normalizes real latitude/longitude into a bounded coordinate plot and lists sites without coordinates below it.

- [ ] **Step 4: Verify component tests**

Run: `npx vitest run src/components/piling/admin-command-center/__tests__/visualizations.test.tsx`

Expected: PASS, including null values, zero totals, long labels, and unavailable coordinates.

### Task 3: Command-center composition and actions

**Files:**
- Create: `src/components/piling/admin-command-center/admin-command-center.tsx`
- Create: `src/components/piling/admin-command-center/decision-queue.tsx`
- Create: `src/components/piling/admin-command-center/maintenance-risk-list.tsx`
- Create: `src/components/piling/admin-command-center/shift-timeline.tsx`
- Create: `src/components/piling/admin-command-center/comparison-table.tsx`
- Create: `src/components/piling/admin-command-center/__tests__/admin-command-center.test.tsx`

**Interfaces:**
- Consumes: `snapshot: AdminDashboardSnapshot`, filter values, loading/stale state, and navigation callbacks.
- Produces: complete command-center surface without data fetching.

- [ ] **Step 1: Write failing interaction tests**

```tsx
render(<AdminCommandCenter snapshot={snapshot} onOpenEquipment={openEquipment} />);
await user.click(screen.getByRole('button', { name: /У-04.*высокий риск/i }));
expect(openEquipment).toHaveBeenCalledWith('equipment-04');
expect(screen.getByRole('heading', { name: 'Требуют решения' })).toBeVisible();
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/components/piling/admin-command-center/__tests__/admin-command-center.test.tsx`

Expected: FAIL because the composition does not exist.

- [ ] **Step 3: Implement the approved layout**

Desktop grid:

```text
[ plan gauge ][ shift dynamics                    ][ sites ][ decisions ]
[ equipment ][ downtime ][ reports ][ maintenance ][ decisions          ]
[ shift timeline                                      ][ comparisons      ]
```

The decision queue is derived from overdue reports, downtime, idle equipment, and maintenance risk. Every row links to the existing owning module; informational rows without a supported action are not rendered as buttons.

- [ ] **Step 4: Add loading, partial-data, empty, and keyboard states**

Use stable panel dimensions, `aria-live="polite"` for refresh status, visible focus rings, `prefers-reduced-motion`, and panel-local unavailable messages so one failed source does not blank the whole dashboard.

- [ ] **Step 5: Verify interaction tests**

Run: `npx vitest run src/components/piling/admin-command-center/__tests__/admin-command-center.test.tsx`

Expected: PASS.

### Task 4: Replace the current administrator dashboard surface

**Files:**
- Modify: `src/components/piling/admin-dashboard.tsx`
- Modify: `src/components/piling/__tests__/dashboard-kpis.test.ts`
- Delete only after replacement is verified: obsolete local display helpers inside `src/components/piling/admin-dashboard.tsx`

**Interfaces:**
- Consumes: `GET /api/analytics/admin-dashboard`.
- Preserves: period, site, rig filters, refresh, stale-source feedback, and existing routes.

- [ ] **Step 1: Add a failing integration-style component test**

```tsx
expect(await screen.findByText('Выполнение плана на смену')).toBeVisible();
expect(screen.getByText('Динамика за смену')).toBeVisible();
expect(screen.queryByText('Оперативная сводка производства')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/components/piling/__tests__/dashboard-kpis.test.ts src/components/piling/admin-command-center/__tests__/admin-command-center.test.tsx`

Expected: FAIL on the old dashboard surface.

- [ ] **Step 3: Replace presentation while preserving filter state**

Fetch the snapshot with the existing filter query, pass route callbacks into `AdminCommandCenter`, and keep `QueryErrorBanner` plus partial-source warnings. Remove `KpiTile`, `PlanTile`, and duplicated display-only aggregation only after the new tests pass.

- [ ] **Step 4: Verify focused tests and lint**

Run: `npx vitest run src/components/piling/__tests__/dashboard-kpis.test.ts src/components/piling/admin-command-center/__tests__/*.test.tsx`

Expected: PASS.

Run: `npm run lint`

Expected: 0 errors; existing unrelated warnings may remain.

### Task 5: Browser verification and release evidence

**Files:**
- Create: `e2e/admin-command-center.spec.ts`
- Create: `docs/release-evidence/admin-command-center.md`

**Interfaces:**
- Verifies the complete admin workflow against seeded data.

- [ ] **Step 1: Add Playwright coverage**

```ts
test('administrator can scan and act from the command center', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByText('Выполнение плана на смену')).toBeVisible();
  await expect(page.getByText('Динамика за смену')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Требуют решения' })).toBeVisible();
});
```

- [ ] **Step 2: Run desktop and mobile screenshots**

Run: `npx playwright test e2e/admin-command-center.spec.ts --project=chromium --workers=1`

Expected: PASS at 1440x900, 1920x1080, 1024x768, and 390x844 with no overlap or horizontal page overflow.

- [ ] **Step 3: Run release checks**

Run: `npm run lint`

Run: `npm run test:unit`

Run: `npm run build`

Expected: lint and build pass; unit tests pass when the configured PostgreSQL service is available. Record infrastructure-only failures separately without masking them.

- [ ] **Step 4: Run GitNexus change verification**

Run `gitnexus_detect_changes()` and confirm only the dashboard, analytics snapshot route, related tests, and intended execution flows are affected.

- [ ] **Step 5: Record evidence**

Document screenshots, viewport checks, command results, known data-source limitations, and the exact commit SHA in `docs/release-evidence/admin-command-center.md`.
