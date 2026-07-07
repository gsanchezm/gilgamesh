# Slice 26 — Web bundle-size CI gate

Closes the long-standing **slice-1 follow-up**: _"Remaining gates: bundle-size, k6 perf, contract
tests."_ (see CLAUDE.md, Slice 1 status). This slice ships the **bundle-size** gate. The web app is
now served to real users (staging — the API serves the SPA), so a silent JavaScript/CSS regression
should turn CI red instead of shipping quietly.

> Slice number: 24 (`request-id`) and 25 (`web-http-resilience`) were taken by sibling parallel
> streams; **26** is the next free number.

## What it gates

After `vite build`, a dependency-light Node checker sums the **gzipped** size of the code bundle —
only `*.js` and `*.css` under `apps/web/dist/assets/` — and fails (exit 1) if it exceeds a committed
budget. Static images vite copies into `dist/assets/` (`agents/*.png`, `brand/*.png`, `browsers/*.png`,
…) are a **separate** concern (Bloque 3 "optimize heavy assets") and are excluded.

- **Checker:** `apps/web/scripts/check-bundle-size.mjs` — plain Node, `node:fs` / `node:zlib` /
  `node:path` only. **No new npm dependency.** Gzip uses node's zlib default level (6), which is
  exactly what `vite build` prints in its own gzip column, so the build log and this gate agree.
- **Budget (a reviewable JSON diff):** `apps/web/bundle-budget.json` — per-category (`js`, `css`) and
  `total` limits in gzipped bytes.
- **Empty-build guard:** if `dist/assets/` is missing, or contains zero JS/CSS, the checker **fails**
  (a budget check over nothing would otherwise falsely pass a broken/partial build).

## Scripts (`apps/web/package.json`)

- `pnpm --filter @gilgamesh/web bundle-size` — `vite build && node scripts/check-bundle-size.mjs`
  (build + check; used in CI, single build).
- `pnpm --filter @gilgamesh/web bundle-size:check` — check only (assumes `dist/` already built;
  handy locally right after a `build`).

## Measured baseline (2026-07-07, commit `56b8d9b`)

Gzipped (`vite build` output on this repo, node zlib level 6 — identical to vite's report):

| asset                | raw       | gzip       |
| -------------------- | --------- | ---------- |
| `assets/index-*.js`  | 322808 B  | **99148 B** (99.15 kB) |
| `assets/index-*.css` | 51379 B   | **9851 B** (9.85 kB)   |
| **total (js+css)**   |           | **108999 B** (109.00 kB) |

## Budget = baseline × ~1.15 (rounded)

| category | baseline gzip | budget (`maxGzipBytes`) | headroom over baseline |
| -------- | ------------- | ----------------------- | ---------------------- |
| js       | 99148 B       | **114000 B**            | +15.0%                 |
| css      | 9851 B        | **11500 B**             | +16.7%                 |
| total    | 108999 B      | **126000 B**            | +15.6%                 |

The ~15% headroom absorbs normal churn (and any marginal `zlib` byte drift between the local Node
that set the baseline and CI's Node 22) without flapping, while still catching a real regression
(e.g. an accidental heavy dependency, or losing tree-shaking).

## How to bump the budget

When a change **legitimately** grows the bundle (a real new feature/dependency), bumping is a
deliberate, reviewable act — not a silent one:

1. `pnpm --filter @gilgamesh/web build` and read the printed `actual` gzip numbers.
2. Set the new `maxGzipBytes` in `apps/web/bundle-budget.json` with ~15% headroom over the new actual.
3. Update the `baseline` block (numbers + `commit`) and **say why in the commit message**.

Keep it a small diff — the whole point is that a budget change shows up in review.

## CI wiring

A dedicated job **`bundle` ("Bundle size (web)")** in `.github/workflows/ci.yml`: checkout →
pnpm/setup-node (Node 22, all actions SHA-pinned like the rest) → `pnpm install --frozen-lockfile` →
`pnpm --filter @gilgamesh/web bundle-size`.

It is its own job for an isolated signal. CI otherwise **never builds the web** — the `e2e` job
serves it through the vite **dev** server — so this is a single `vite build`, **not** a duplicate.
The web build resolves only `@gilgamesh/domain` + `@gilgamesh/ui` via the vite aliases, touching no
Prisma client or database, so (unlike the other jobs) this one needs no `prisma:generate` or DB
services.

## Local proof (this slice)

- Passes at the committed budget: total 109.00 kB ≤ 126.00 kB (js 99.15 ≤ 114.00, css 9.85 ≤ 11.50).
- Fails when the budget is lowered below the actual size (e.g. total → 100000 B → exit 1, `OVER`),
  reverted after.

## Not in scope (unchanged follow-ups)

The other two slice-1 gates — **k6 perf** and **contract tests** — remain follow-ups. No keystone,
no app-source, no schema change here: this is build tooling only (checker + budget + one CI job).
