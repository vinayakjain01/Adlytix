# Run details side panel — design (short)

Status: awaiting approval. Not yet built.

## Intent
Port the "Run details" right-hand panel from ROASify (`components/product-analysis/right-panel.tsx`)
into Adlytix, so the user can see at a glance what data sits behind the page they are
looking at. It must open/close, and its numbers must change when the user changes the date range.

## What the user asked for (their words)
Sections: **Run ID, Products, Sources merged, Per-product averages, Methodology.**
Adlytix also merges Google data, so Google is included.

## Goals
- Panel with the five sections above, matching the ROASify look (adapted to Adlytix's dark theme).
- Collapsible: a toggle in the panel header; collapsed state leaves a thin rail with an expand button.
- Dynamic: every figure derives from `aggregatedProducts` / `allMonths` / `selectedMonths` /
  `integrationRangeDays` in `lib/context.tsx`, so the header date-range buttons and month picker
  update the panel with no extra fetching.

## Non-goals / anti-goals
- No backend changes.
- No "Google Ads — account total" / "Meta Ads — account total" blocks (not requested).
- No Google live sync (Google is upload-only in Adlytix today).
- The quadrant page's existing threshold panel is left as is.

## Approaches considered
1. **Extend the existing `rightPanel` slot in `AppShell` with collapse support, and add a
   `RunDetailsPanel` component (chosen).** The slot already exists and the quadrant page uses it;
   collapse is added once and any page can adopt it later.
2. Build the panel as a one-off inside the Product analysis page. Faster, but duplicates layout
   code and cannot be reused on other pages.
3. Floating overlay drawer. Does not match the screenshot (panel sits beside content) and covers the table.

## Design (my calls — please correct any)
- **Where:** Product analysis page only, as in the screenshot. Other pages can opt in later.
- **Run ID:** `pa_YYYY_MM_DD` from today's date, same as ROASify. Shows "—" before any merge.
- **Products:** `aggregatedProducts.length`.
- **Sources / rows:** a "connected" dot plus a row count per source (Meta, Shopify, Google).
  ROASify estimates rows as `file size / 40`, which is a guess. Instead I count merged rows that
  actually carry that source's data (Meta spend > 0, Google cost > 0, revenue/units > 0), so the
  counts are real and change with the date range.
- **Months/range:** "All N months" / "X of N months" in upload mode; "Last 30 days" etc. in integration mode.
- **Averages per product:** Avg Meta Spend, Avg Google Spend, Avg Total Spend, Avg Revenue, Avg ROI,
  Avg Units/Product, using the existing currency formatters so the currency picker applies.
- **Methodology:** same text as ROASify.
- **Collapse state:** remembered in `localStorage` (wrapped in try/catch; defaults to open).
  Below the `xl` breakpoint the panel stacks under the content, as the slot already does.

## Left to the builder
Exact class names/spacing, small helper components (`PanelSection`, `PanelRow`, `SourceItem`),
and the empty state when no data is loaded.
