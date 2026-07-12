# Slice 43 — Reports per-tool ("Tools") breakdown

## Summary

The Reports view (capture 08) landed read-only (`summarizeAcrossRuns` + `ReportsScreen`) but was
**missing the per-tool "Tools" card** because `RunResult` had no tool/discipline dimension. Keystone
**v0.7** (landed in series on `main` in Step 0 of programa v9) added nullable `tool`/`discipline` to
`RunResult`, and the `DeterministicKernel` now emits them deterministically. This slice consumes that
frozen contract to render the per-tool breakdown: for every run in a project, group the per-scenario
results **by `tool`** into per-tool pass/fail/skip counts + a 1-decimal pass-rate.

No new migration (Step 0 owns the schema). No new API route — the existing `GET /runs/:id` already
returns each run's `results`; this slice **additively widens** the per-result view so those rows carry
`tool`/`discipline`, and the Reports screen fetches per-run detail to build the breakdown.

## Owner decisions / posture

- **Honesty (v9 §honesty):** the "Tools" breakdown renders **`DeterministicKernel`-emitted (stub)**
  tool/discipline until the real TOM/chaos-proxy kernel lands — identical posture to every other
  kernel-backed number in the app. Stated here and reflected in the ReportsScreen copy/data path.
- **Data path = `getRun`-per-run (no list-read widening).** The Reports screen loads `listRuns`
  (summaries, unchanged) and then fetches each run's detail via the existing `getRun` to obtain the
  per-result `tool` — a single load window, degrading gracefully (a failed per-run detail contributes
  no tool rows, never blanks the health card). `ListRuns`/`RunSummaryView` are **not** widened (that
  would bloat every list payload); only the per-result `RunResultView`/`runView` (which flow through
  `GetRun`) gain the fields. Verified: the api `RunController` returns `RunView` **directly** — no read
  DTO strips the new fields, so widening the view is sufficient (no api DTO change).
- **No schema work** — Step 0 (v0.7) already migrated `run_results`. Domain `summarizeRun` /
  `summarizeAcrossRuns` are unchanged in shape (the new fields are optional); the grouping is a **new
  pure fold**.

## Behavior (acceptance criteria)

- **AC-REPORT-TOOL-01** — Per-scenario results **group by `tool`** into per-tool counts
  (passed/failed/skipped/total) and a **1-decimal** pass-rate (`passed / total`, where `total` includes
  skipped) — mirroring `summarizeAcrossRuns` rounding, not the integer `summarizeRun`.
- **AC-REPORT-TOOL-02** — A run whose scenarios exercise **different tools** splits correctly across the
  buckets (e.g. `playwright` / `k6` / `zap` / `vitest`), in a **deterministic order** (most-executed
  first, tool-name ascending as the stable tiebreak); a result with a **null/absent tool** falls into a
  deterministic `unknown` bucket.
- **AC-REPORT-TOOL-03** — A project with **zero runs** shows a period-less `EmptyState` (the shared
  `@gilgamesh/ui` `EmptyState`; titles are period-less) instead of a "Tools" card.
- **AC-REPORT-TOOL-04** — Tenant isolation: a **non-member** reading a project's runs gets `NOT_FOUND`
  (never 403) — inherited from the existing `requireProjectAccess` gate on `ListRuns`/`GetRun`; no new
  code, covered by the existing application-layer tenant-isolation test.

## Domain — the pure fold

`packages/domain/src/execution/summarize-by-tool.ts` (Clean Architecture — no framework imports):

```ts
export const UNKNOWN_TOOL = 'unknown';
export interface ToolSummaryInput { tool?: string | null; status: ResultStatus }
export interface ToolSummary { tool: string; passed: number; failed: number; skipped: number; total: number; ratePct: number }
export function summarizeByTool(results: readonly ToolSummaryInput[]): ToolSummary[]
```

- Groups by `tool`; a null/absent/blank tool → the `unknown` bucket.
- `ratePct = round(passed / total * 1000) / 10` (1-decimal, mirrors `summarizeAcrossRuns`; `0` when
  `total === 0`).
- Deterministic order: `total` descending, then `tool` ascending (stable tiebreak — never relies on
  input order or engine sort stability).
- Single source of the per-tool numbers — the UI duplicates none of the arithmetic.

## Application — widen the per-result view (no new use case)

`packages/application/src/use-cases/runs.ts`:
- `RunResultView` gains `tool?: string | null` and `discipline?: string | null`.
- `runView(run, results)` threads `r.tool ?? null` / `r.discipline ?? null` onto each mapped result
  (they were dropped before). Flows through `TriggerRun` **and** `GetRun` → `GET /runs/:id`.
- No change to `ListRuns` / `RunSummaryView`; no api DTO change (controller returns `RunView` verbatim).

## Web

`apps/web/src/lib/runs-client.ts` — `RunResultView` mirrors the widened server shape (`tool?`,
`discipline?`). `apps/web/src/screens/ReportsScreen.tsx` — one load window: `listRuns` then
`Promise.all(runs.map(getRun))` (per-run `.catch(() => [])`), flatten `results`, feed `summarizeByTool`,
render the "Tools" card (per-tool rows: tool name, passed/failed/skipped counts, 1-decimal pass-rate)
faithful to capture 08. Zero runs → the existing period-less `EmptyState`.

## Verification (Docker-free — Tier-0 shared infra)

- Domain: `summarize-by-tool.test.ts` (grouping, 1-decimal rounding, skip-in-denominator, order +
  tiebreak, `unknown` bucket, empty → `[]`).
- Application: `runs.test.ts` — a run with distinct-tool scenarios; `GetRun` results carry the widened
  `tool`/`discipline` (proves the widening flows end-to-end, not silently dropped). Tenant isolation
  already covered (AC-RUN-10/11).
- Web: `ReportsScreen.test.tsx` — a happy-path test where `getRun` returns results carrying real tools;
  assert the specific per-tool counts **and** the 1-decimal pass-rate render in the DOM (the only proof
  tool flows through the client to the card). Existing tests unchanged (graceful degradation keeps them
  green; the new test is what proves the feature).
- The `.feature` (AC-REPORT-TOOL-01..04) is the SDD artifact, tagged `@ui` (the breakdown is a
  domain-fold + UI-render concern; its executable proof is the Docker-free domain + web tests, exactly
  as UI-only behavior is represented) — excluded from the API BDD sweep, so the orchestrator's
  `test:bdd` gate is unaffected.
```
