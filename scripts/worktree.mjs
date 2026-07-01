#!/usr/bin/env node
/**
 * Tier-0 git-worktree helper for parallel-branch work (owner decision 2026-07-01).
 *
 * Creates an isolated worktree under `.worktrees/<branch>` and wires it for immediate use
 * (`pnpm install` + Prisma client generate). Each worktree has its OWN node_modules, so the
 * two branches never fight over the Prisma query-engine DLL (the Windows EPERM we hit).
 *
 * Tier 0 = shared infra is NOT isolated: Postgres, Redis and the dev-server ports are the same
 * single instances. Docker-free unit tests run safely in parallel; `test:int` / `test:bdd`
 * truncate shared tables, so run them in ONE worktree at a time.
 *
 * Usage:
 *   pnpm wt <branch> [--from <base>]   create/attach a worktree at .worktrees/<branch>
 *   pnpm wt --list                     list worktrees
 *   pnpm wt --remove <branch>          remove .worktrees/<branch> (keeps the branch)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WT_DIR = join(ROOT, '.worktrees');
const slug = (b) => b.replace(/[/\\]/g, '-');

function run(cmd, cwd = ROOT) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd });
}
function branchExists(branch) {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branch}`, { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

const HELP = `Parallel-branch worktrees (Tier 0)

  pnpm wt <branch> [--from <base>]   create/attach a worktree at .worktrees/<branch>
  pnpm wt --list                     list worktrees
  pnpm wt --remove <branch>          remove .worktrees/<branch> (keeps the branch)

Shared Postgres/Redis/ports are NOT isolated — run test:int / test:bdd in one worktree at a time.`;

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === '-h' || cmd === '--help') {
  console.log(HELP);
  process.exit(0);
}

if (cmd === '--list') {
  run('git worktree list');
  process.exit(0);
}

if (cmd === '--remove') {
  const branch = args[1];
  if (!branch) {
    console.error('Usage: pnpm wt --remove <branch>');
    process.exit(1);
  }
  run(`git worktree remove "${join(WT_DIR, slug(branch))}"`);
  console.log(`Removed the worktree (branch "${branch}" itself is kept).`);
  process.exit(0);
}

// create / attach
const branch = cmd;
const fromIdx = args.indexOf('--from');
const base = fromIdx >= 0 ? args[fromIdx + 1] : '';
const path = join(WT_DIR, slug(branch));

if (existsSync(path)) {
  console.error(`A worktree already exists at ${path}. Use \`pnpm wt --remove ${branch}\` first.`);
  process.exit(1);
}
if (!existsSync(WT_DIR)) mkdirSync(WT_DIR, { recursive: true });

if (branchExists(branch)) {
  run(`git worktree add "${path}" ${branch}`);
} else {
  run(`git worktree add "${path}" -b ${branch} ${base}`.trim());
}

console.log('\n→ Installing deps + generating the Prisma client in the worktree…');
run('pnpm install --prefer-offline', path);
run('pnpm --filter @gilgamesh/api prisma:generate', path);

console.log(`
✔ Worktree ready: ${path}   (branch: ${branch})

Next:
  cd ${path}
  pnpm -r typecheck && pnpm lint && pnpm -r test        # Docker-free — safe in parallel
  # test:int / test:bdd share Postgres+Redis -> run them in ONE worktree at a time (Tier 0).
  # To run a dev server here without clashing with :3001/:5173, override the ports:
  #   PORT=3002 pnpm --filter @gilgamesh/api start:dev
  #   pnpm --filter @gilgamesh/web dev -- --port 5174

Remove when done:  pnpm wt --remove ${branch}
`);
