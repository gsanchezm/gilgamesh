# Reports view — project run-health aggregate (read-only)

_Design spec · 2026-07-01 · branch `feat/reports-view`_

## Goal

Ship the missing **Reports** view (design capture `08-reportes.png`) as a **read-only**
project-level run-health report, driven entirely by data that already exists in slice 3
(`Run` / `RunResult`). No new API surface, no route wiring yet (owner instruction).

## Scope decisions (owner, 2026-07-01)

1. **Shape = project aggregate.** The view folds **all** of a project's runs into one health
   summary via a pure `summarizeAcrossRuns` function. (Owner picked "Agregado del proyecto"
   over per-run-with-selector.)
2. **"Tools · 5 testing tools" breakdown is deferred and documented as blocked.** Slice-3
   `RunResult` is `{refId, name, status, log}` per scenario/test-case — it has **no
   tool/discipline dimension**, so the capture's per-tool drill-in has no backing data (same
   blocker as Session replay). The section is omitted from the UI; the view stays 100% real data.
3. **`ratePct` carried to 1 decimal** to match the capture's `82.2%` (unlike `summarizeRun`,
   which rounds to an integer).
4. **Out of scope (owner):** no route added to `App.tsx` / `AppRoutes.tsx`; no changes to the
   API, to `runs-client.ts`, or to the clients provider (`RunsClient` is already wired there).

## Architecture

Two layers only — domain (pure) + web (screen). Dependencies point inward (domain has zero
framework imports), per Clean Architecture.

### Domain — `packages/domain/src/execution/summarize-across-runs.ts`

Sits next to `summarize-run.ts`, same style/idiom.

```ts
export interface RunAggregateInput {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
  createdAt: string; // ISO-8601
}

export interface ProjectRunsSummary {
  runs: number;             // number of runs folded
  testsExecuted: number;    // Σ total
  passed: number;
  failed: number;
  skipped: number;
  ratePct: number;          // passed / testsExecuted * 100, rounded to 1 decimal
  failingRuns: number;      // count of runs with failed > 0
  totalDurationMs: number;  // Σ durationMs
  lastRunAt: string | null; // max(createdAt) by ISO string compare; null when empty
}

export function summarizeAcrossRuns(runs: readonly RunAggregateInput[]): ProjectRunsSummary;
```

- Pure and deterministic. `lastRunAt` is the maximum `createdAt` by lexical ISO-8601 string
  comparison (no `Date.now()` / `new Date()` — keeps the domain framework-free and deterministic).
- `ratePct` rounded to 1 decimal; `testsExecuted === 0` ⇒ `ratePct === 0` (mirrors `summarizeRun`).

**Edge cases (tests first, TDD):** empty list → all zeros, `ratePct 0`, `lastRunAt null`; runs with
`total 0`; all-pass; all-fail; 1-decimal rounding (e.g. 125/152 → 82.2); `lastRunAt` selection across
out-of-order `createdAt`; `failingRuns` counts runs (not results) with `failed > 0`.

### Web — `apps/web/src/screens/ReportsScreen.tsx`

Props `{ runsClient: RunsClient; projectId: string }` (mirrors `TestLabScreen`). Route-agnostic
component so it is testable with an injected fake client and needs no `App.tsx` wiring.

- On mount: `runsClient.listRuns(projectId)` → map each `RunSummaryView` to `RunAggregateInput`
  → `summarizeAcrossRuns(...)`.
- Renders (faithful to capture 08, top half):
  - **Header card** — project "test automation report" context.
  - **OVERALL RUN HEALTH card** — `ratePct%`, "X of Y tests passed", subtext reworded to
    **"Across N runs — F failures need triage, S skipped"**, plus the mini pass/fail/skip bar.
  - **Stat cards** — TESTS EXECUTED · PASSED · FAILED · SKIPPED.
  - **Recent runs list** — per run: label, status, rate, passed/failed/skipped, duration, date. Read-only.
- States: loading · error (existing screen pattern) · **empty** ("No runs yet").
- Styling: `@gilgamesh/ui` design system + `index.css` classes, matching the other re-skinned
  screens; dark-first.

## Testing / verification (SDD → TDD)

BDD acceptance (Cucumber over API+Postgres) adds nothing here — Reports introduces **no** API
behavior — so the contract is covered by:

- `pnpm --filter @gilgamesh/domain test` — `summarizeAcrossRuns` unit tests (red → green).
- `pnpm --filter @gilgamesh/web test` — `ReportsScreen` component test with a fake `RunsClient`
  (renders aggregated numbers, recent-runs list, empty state).
- `pnpm -r typecheck` — clean.

## Deferred / follow-up (tracked)

- **Per-tool ("testing tools") breakdown** — needs a tool/discipline dimension persisted on
  `RunResult`. Blocked alongside Session replay (per-action timeline). Record in
  `docs/research/feature-status.md` when this lands.
- **Route wiring** (`/projects/:id/reports`) — intentionally left out per owner instruction;
  a follow-up mounts the screen and updates capture-08 status on the board.
