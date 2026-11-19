# Run details side panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "Run details" panel to the Product analysis page whose numbers follow the global date range, month picker and currency.

**Architecture:** `AppShell` already has a `rightPanel` slot. Add opt-in collapse support to that slot (title + toggle + persisted state), then add a `RunDetailsPanel` that derives everything from `useApp()` (`aggregatedProducts`, `normalizedProducts`, `allMonths`, `selectedMonths`) using the existing `computeAverages`, so it updates whenever the header controls change the data. Pure helpers live in `lib/run-details.ts`.

**Tech Stack:** Next.js (React, client components), TypeScript, Tailwind with the Adlytix tokens (`text-ink`, `bg-panel`, `border-line`, `rounded-card`, …).

**Spec:** `docs/superpowers/specs/2026-11-19-run-details-panel-design.md`

## Global Constraints

- No backend changes; no new dependencies.
- Sections, in order: Run details (Run ID, Products, Sources, Months, optional Range), Sources merged (Meta Ads, Shopify, Google Ads), Averages per product, Methodology. No "account total" blocks.
- Run ID format `pa_YYYY_MM_DD` from today's date; `—` when there is no merged data.
- Methodology text, verbatim: "ROI = Shopify Revenue ÷ Total Spend. Averages reflect selected months only. Multi-month data is summed per product ID before averaging."
- Money values use `inr()` from `lib/formatters.ts` (so the currency picker applies); ROI uses `roi()`; counts use `num()`.
- Collapse state persisted in `localStorage`, every access wrapped in try/catch, default open.
- The quadrant page's threshold panel must keep working unchanged (it does not pass the new prop).
- Repo has **no test runner**; adding one is out of scope. Verification is `npx tsc --noEmit`, `npm run lint`, and the manual checklist in Task 4. Do not run `npm run build` while the dev server is running (see `DEPLOYMENT.md`: use `npm run clean` when switching).

## Review Focus

- No data loaded: the page returns its empty state before the panel, so no panel (confirm, don't break).
- A source with zero rows (e.g. no Google upload): row shows `0 rows` with a grey dot, and Avg Google Spend shows `0`.
- `localStorage` unavailable or throwing: panel still renders, open.
- Currency changed in the header: averages re-format (panel must not memoize formatted strings).
- Viewport below `xl`: panel stacks under content; toggle still works and collapsed state shows header only.

---

### Task 1: Pure helpers

**Files:**
- Create: `lib/run-details.ts`

**Interfaces:**
- Produces:
  - `runIdFor(date: Date): string` → e.g. `pa_2026_11_19`
  - `interface SourceRowCounts { meta: number; shopify: number; google: number }`
  - `countSourceRows(rows: NormProduct[]): SourceRowCounts` — meta = rows with `metaSpend > 0`; google = rows with `googleCost > 0`; shopify = rows with `revenue > 0 || itemsSold > 0`
  - `monthsLabel(allMonths: string[], selected: Set<string>): string | null` → `null` if no months, `All N months`, or `X of N months`

- [ ] **Step 1:** Create `lib/run-details.ts` with the three functions and `SourceRowCounts` above (import `NormProduct` from `@/lib/context`). Zero-pad month and day.
- [ ] **Step 2:** Run `npx tsc --noEmit`. Expected: no errors.

### Task 2: Panel building blocks and collapse support in AppShell

**Files:**
- Create: `components/layout/right-panel.tsx`
- Modify: `components/layout/app-shell.tsx`

**Interfaces:**
- Produces (`right-panel.tsx`): `PanelSection({ title: string; children: ReactNode })`, `PanelRow({ label: string; value: ReactNode; mono?: boolean })`, `SourceItem({ name: string; rows: number; connected: boolean })` (green dot when connected, grey otherwise; shows `{num(rows)} rows`). Style with Adlytix tokens (`text-ink`, `text-ink-muted`, `text-ink-body`, `border-line-subtle`), section titles uppercase `text-[10.5px] tracking-widest text-ink-muted`.
- Produces (`app-shell.tsx`): new optional prop `rightPanelTitle?: string` on `AppShellProps`. When set, the `<aside>` renders a header row (title + chevron toggle button with `aria-label` "Collapse panel"/"Expand panel" and `aria-expanded`), then the `rightPanel` content only when expanded; collapsed width on `xl` is `xl:w-[44px]` with only the toggle visible, expanded stays `xl:w-[300px]`. When unset, behavior is exactly as today.
- Collapse state: a small hook `usePersistedFlag(key: string, initial: boolean): [boolean, (v: boolean) => void]` defined in `app-shell.tsx` (or `hooks/use-persisted-flag.ts` if you prefer), key `adlytix_right_panel_collapsed`. Read in a `useEffect` after mount (avoids SSR mismatch), write on change, all in try/catch.

- [ ] **Step 1:** Create `components/layout/right-panel.tsx` with the three components.
- [ ] **Step 2:** Add `usePersistedFlag` and the `rightPanelTitle` behavior to `app-shell.tsx`. Hooks must be called unconditionally in `AppShellFrame`.
- [ ] **Step 3:** Run `npx tsc --noEmit` and `npm run lint`. Expected: no errors; the quadrant page still type-checks without the new prop.

### Task 3: RunDetailsPanel

**Files:**
- Create: `components/products/run-details-panel.tsx`

**Interfaces:**
- Consumes: `useApp()` fields `mergedData`, `aggregatedProducts`, `normalizedProducts`, `allMonths`, `selectedMonths`; `computeAverages` from `@/lib/product-metrics`; Task 1 helpers; Task 2 components; `inr`, `roi`, `num` from `@/lib/formatters`.
- Produces: `RunDetailsPanel({ rangeLabel }: { rangeLabel: string | null })`. When `rangeLabel` is non-null, add a `Range` row to the first section.

- [ ] **Step 1:** Implement the panel. Source rows come from `normalizedProducts.filter(r => !r.month || selectedMonths.has(r.month))`, memoized with `useMemo` on `[normalizedProducts, selectedMonths]`, then `countSourceRows`. `Sources` row text: `"{n} connected"` where n = number of sources with rows > 0. Averages from `computeAverages(aggregatedProducts)`, computed during render (not memoized into formatted strings). Rows: Avg Meta Spend, Avg Google Spend, Avg Total Spend, Avg Revenue, Avg ROI, Avg Units/Product. Run ID from `runIdFor(new Date())` when `mergedData` is non-null, else `—`.
- [ ] **Step 2:** Run `npx tsc --noEmit`. Expected: no errors.

### Task 4: Wire into Product analysis and verify

**Files:**
- Modify: `app/product-analysis/page.tsx` (the main `<AppShell ...>` near line 211 only; leave the empty-state `AppShell` at line 179 alone)

**Interfaces:**
- Consumes: `RunDetailsPanel`, `RANGE_PRESETS` from `@/components/integrations/date-range-selector`, existing `intel` and `integrationRangeDays` in the page.

- [ ] **Step 1:** Pass `rightPanelTitle="Run details"` and `rightPanel={<RunDetailsPanel rangeLabel={...} />}` to the main `AppShell`. `rangeLabel` = the `RANGE_PRESETS` label matching `integrationRangeDays` when `intel` is non-null, otherwise `null`.
- [ ] **Step 2:** Run `npx tsc --noEmit` and `npm run lint`. Expected: no errors.
- [ ] **Step 3:** Start backend (`backend/venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 47823`) and frontend (`npm run dev`), sign in as the vinayak workspace user, open Product analysis, and check:
  - Panel shows all four sections; Google row present.
  - Click the toggle: panel collapses to a thin rail; reload the page: state is remembered; expand again.
  - Press "Last 90 days": Products, row counts and averages change.
  - Change the month picker: Months label and averages change.
  - Change currency: averages re-format.
  - Open `/quadrant-view`: its threshold panel is unchanged.
  - Narrow the window below `xl`: panel stacks under the content.
- [ ] **Step 4:** Commit (only after the user confirms): `git add lib/run-details.ts components/layout/right-panel.tsx components/layout/app-shell.tsx components/products/run-details-panel.tsx app/product-analysis/page.tsx docs/superpowers` then `git commit -m "Add collapsible Run details panel to Product analysis"`.
