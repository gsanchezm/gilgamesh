// Bundle-size CI gate for the web app. Runs AFTER `vite build` and fails the build when the
// gzipped JS+CSS in apps/web/dist/assets/ grows past the committed budget (apps/web/bundle-budget.json).
// This closes the long-standing slice-1 follow-up ("Remaining gates: bundle-size, ...") now that the
// SPA is served to real users on staging — a silent bundle regression should turn CI red.
//
//   pnpm --filter @gilgamesh/web build            # emit apps/web/dist/
//   node apps/web/scripts/check-bundle-size.mjs    # (or `pnpm --filter @gilgamesh/web bundle-size:check`)
//
// Or in one shot: `pnpm --filter @gilgamesh/web bundle-size` (build + check).
//
// What it measures: only *.js and *.css under dist/assets/ (the code bundle). The many static
// images vite copies into dist/assets/ (agents/*.png, brand/*.png, browsers/*.png, ...) are a
// SEPARATE concern (Bloque 3 "optimize heavy assets") and are deliberately excluded here.
//
// Gzip: node's zlib default level (6), which is exactly what `vite build` reports in its own gzip
// column — so the numbers you see in the build log and in this table agree. Dependency-free by
// design (node:fs / node:zlib / node:path only): NO new npm dependency.
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'dist', 'assets');
const budgetPath = join(here, '..', 'bundle-budget.json');

/** Recursively collect every file under `dir` (images live in subdirs; extension filtering happens later). */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** js | css | null — the bundle categories we gate on (source maps and everything else are ignored). */
function categoryOf(file) {
  if (file.endsWith('.js')) return 'js';
  if (file.endsWith('.css')) return 'css';
  return null;
}

const KB = (bytes) => (bytes / 1000).toFixed(2).padStart(8) + ' kB';

function fail(message) {
  console.error(`\n✖ bundle-size: ${message}`);
  process.exit(1);
}

if (!existsSync(assetsDir)) {
  fail(`no build found at ${relative(process.cwd(), assetsDir)} — run \`pnpm --filter @gilgamesh/web build\` first.`);
}

const budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
const limits = budget.budgets; // { js: {maxGzipBytes}, css: {...}, total: {...} }

// Measure: gzip each JS/CSS asset, tally per category.
const rows = [];
const totals = { js: 0, css: 0 };
for (const file of walk(assetsDir)) {
  const category = categoryOf(file);
  if (!category) continue; // skip images / maps / other
  const gzipBytes = gzipSync(readFileSync(file)).length;
  totals[category] += gzipBytes;
  rows.push({ name: relative(assetsDir, file).replace(/\\/g, '/'), category, gzipBytes });
}

// Guard: an empty/partial build (zero JS AND zero CSS) must FAIL — a budget check over nothing
// would otherwise report 0 ≤ budget and greenlight a broken build.
if (rows.length === 0) {
  fail(`no .js/.css assets under ${relative(process.cwd(), assetsDir)} — the build produced no bundle (partial or failed build?).`);
}

const totalGzip = totals.js + totals.css;

// ---- Report -------------------------------------------------------------------------------------
rows.sort((a, b) => b.gzipBytes - a.gzipBytes);
console.log('\nBundle size (gzipped JS+CSS in apps/web/dist/assets/)\n');
console.log('  asset                                    gzip');
console.log('  ' + '-'.repeat(52));
for (const r of rows) {
  console.log(`  ${r.name.padEnd(38)} ${KB(r.gzipBytes)}`);
}
console.log('  ' + '-'.repeat(52));

const checks = [
  ['js   ', totals.js, limits.js.maxGzipBytes],
  ['css  ', totals.css, limits.css.maxGzipBytes],
  ['TOTAL', totalGzip, limits.total.maxGzipBytes],
];
console.log('\n  category      actual        budget      headroom   status');
console.log('  ' + '-'.repeat(58));
let overBudget = false;
for (const [label, actual, max] of checks) {
  const over = actual > max;
  if (over) overBudget = true;
  const headroom = max - actual;
  const pct = ((headroom / max) * 100).toFixed(1);
  const status = over ? 'OVER ✖' : 'ok';
  console.log(
    `  ${label}   ${KB(actual)}   ${KB(max)}   ${(headroom / 1000).toFixed(2).padStart(7)} kB (${pct.padStart(5)}%)   ${status}`,
  );
}
console.log('  ' + '-'.repeat(58));

if (overBudget) {
  console.error(
    '\n✖ bundle-size: over budget. Either trim the bundle, or — if this growth is intended —\n' +
      `  bump the limit in apps/web/bundle-budget.json (a reviewable diff) and note why.\n`,
  );
  process.exit(1);
}
console.log('\n✔ bundle-size: within budget.\n');
