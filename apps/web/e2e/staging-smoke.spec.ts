import { expect, test } from '@playwright/test';

// Container smoke for the STAGING IMAGE (spec staging-deploy §4/§6): one browser session against
// baseURL (the docker-compose.staging.yml container, or a deployed staging URL via
// STAGING_BASE_URL) proves the single-origin topology of owner decision SD-3 — the API process
// serves the SPA (/, deep links) while /api/v1 stays JSON, and the real session cookie + CSRF
// double-submit work on that origin. Deterministic and offline: the container has no provider
// keys, so every port degrades to its stub; the flow below touches none of them.
// Selectors are reused verbatim from register.spec.ts / onboarding-company.spec.ts / smoke.spec.ts
// / knowledge.spec.ts (the source of truth for the register → onboarding → agent-room flow).
const PASSWORD = 'C0rrect-Horse!';
const COMPANY = 'Acme Inc.';
const PROJECT = 'OmniPizza';

test('staging container: SPA + API + same-origin session on one origin', async ({
  page,
  request,
}) => {
  // (a) GET / is served by the API container and renders the SPA login (helix hero + brand).
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('GILGAMESH')).toBeVisible();
  await expect(page.locator('canvas.gx-auth__helix')).toBeVisible();

  // (b) Register a fresh unique user through the real UI, then complete onboarding.
  const email = `smoke-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('First name', { exact: true }).fill('Staging');
  await page.getByLabel('Last name', { exact: true }).fill('Smoke');
  await page.getByLabel('Company', { exact: true }).fill(COMPANY);
  await page.getByLabel('Corporate email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Register auto-signed-in: the session + csrf cookies actually landed on THIS origin.
  await expect(page.getByText('Name your project')).toBeVisible();
  const cookieNames = (await page.context().cookies()).map((c) => c.name);
  expect(cookieNames).toContain('__Host-gg_session');
  expect(cookieNames).toContain('csrf');

  await page.getByLabel('Project name', { exact: true }).fill(PROJECT);
  await page.getByRole('button', { name: 'Continue' }).click(); // step 1 -> 2 (format: default)
  await page.getByRole('button', { name: 'Continue' }).click(); // step 2 -> 3 (repo: skipped)
  await page.getByRole('button', { name: 'Create project' }).click();

  // Landed in the agent room of the freshly onboarded tenant.
  await expect(page.getByRole('heading', { name: 'Agent room' })).toBeVisible();
  await expect(page.getByText('11 / 11')).toBeVisible();

  // (c) One authenticated same-origin API round-trip (PATCH + the CSRF double-submit): toggling
  // an agent must drop the awake count — if cookies/CSRF broke on this origin, this 403s.
  await page.getByRole('switch').first().click();
  await expect(page.getByText('10 / 11')).toBeVisible();

  // (d) The SPA fallback never swallows the API: an unknown API path stays a JSON 404, not HTML.
  const res = await request.get('/api/v1/definitely-not-a-route');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type'] ?? '').toContain('json');

  // (e) A deep client route as a fresh document request is served by the SPA fallback (not a
  // 404) and the session survives the full-page load (/auth/me restore).
  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { name: 'Knowledge base', exact: true })).toBeVisible();

  // (f) Knowledge search (§7) over the seeded shared KB — proves the pgvector cosine search reaches
  // the centralus Postgres and returns cited results (deterministic lexical embedding, no Voyage key).
  await page.getByLabel('Search query').fill('boundary value analysis partitions');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText(/of \d+ chunks/)).toBeVisible();
  await expect(page.locator('.gx-kb__result').first()).toBeVisible();
});

// Covers the §7 smoke flows the auth test above does not — lab (author) → chat (SSE stream) → run
// (chat-triggered, narrated back). Chat streaming is the one flow whose behavior genuinely changes
// on ACA vs local compose (spec §9: "ACA ingress idle timeout vs chat SSE — verify in smoke"), so
// asserting the streamed deity response + run narration ARRIVE through the real ingress is the point.
// Deterministic + offline: the stub brain (no ANTHROPIC_API_KEY) routes to Thor and the deterministic
// kernel passes a keyword-free feature. Flow/selectors mirror chat.spec.ts, but registers via the UI
// (relative to baseURL) so it runs against STAGING_BASE_URL, unlike chat.spec.ts's localhost seed.
test('staging container: lab → chat SSE stream → chat-triggered run narrates back', async ({ page }) => {
  const email = `smoke-chat-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('First name', { exact: true }).fill('Staging');
  await page.getByLabel('Last name', { exact: true }).fill('Chat');
  await page.getByLabel('Company', { exact: true }).fill(COMPANY);
  await page.getByLabel('Corporate email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('Name your project')).toBeVisible();
  await page.getByLabel('Project name', { exact: true }).fill(PROJECT);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Agent room' })).toBeVisible();

  const projectId = /\/projects\/([^/]+)\/agents/.exec(page.url())?.[1];
  expect(projectId).toBeTruthy();

  // Author a keyword-free feature the chat can run by name (deterministic kernel → all PASS).
  await page.goto(`/projects/${projectId}/lab`);
  await page.getByLabel('Feature path').fill('checkout.feature');
  await page
    .getByLabel('Feature content')
    .fill('Feature: Checkout\n  Scenario: Checkout case 1\n    When step 1\n  Scenario: Checkout case 2\n    When step 2');
  await page.getByRole('button', { name: 'Add feature' }).click();
  await expect(page.getByText('Checkout · 2 scenarios')).toBeVisible();

  // The streamed router+chat response must arrive through the ACA ingress (Thor = perf slot).
  await page.goto(`/projects/${projectId}/chat`);
  await expect(page.getByRole('heading', { name: 'Agent chat' })).toBeVisible();
  await page.getByLabel('Message').fill('our checkout p95 latency explodes under load');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Thor here/)).toBeVisible();

  // A chat-triggered run rides the standard run path and narrates PASS back into the conversation.
  await page.getByLabel('Message').fill('run the Checkout feature');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Enqueued a run of "Checkout"/)).toBeVisible();
  await expect(page.getByText(/PASS — Checkout case 1/)).toBeVisible();
});
