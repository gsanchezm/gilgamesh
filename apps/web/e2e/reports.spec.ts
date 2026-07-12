import { type APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'Reports', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

test('Reports: after a run, the project report aggregates its results', async ({ page, request }) => {
  const email = `e2e-reports-${Date.now()}@example.com`;
  await seedUser(request, email);

  await page.goto('/login');
  await page.getByPlaceholder('name@company.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: 'Enter' }).click();

  await expect(page.getByText('Name your project')).toBeVisible();
  await page.getByPlaceholder('OmniPizza').fill('OmniPizza');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Agent room' })).toBeVisible();

  const projectId = /\/projects\/([^/]+)\/agents/.exec(page.url())?.[1];
  expect(projectId).toBeTruthy();
  await page.goto(`/projects/${projectId}/lab`);
  await expect(page.getByRole('heading', { name: 'Test Lab' })).toBeVisible();

  // Author a feature whose scenario names drive the deterministic kernel: pass / fail / skip.
  await page.getByLabel('Feature path').fill('checkout.feature');
  await page
    .getByLabel('Feature content')
    .fill(
      'Feature: Checkout\n  Scenario: Pay\n    When pay\n  Scenario: Payment fails\n    When pay\n  Scenario: Refund wip\n    When refund',
    );
  await page.getByRole('button', { name: 'Add feature' }).click();
  await expect(page.getByText('Checkout · 3 scenarios')).toBeVisible();

  // Run it, then open the project report.
  await page.getByRole('button', { name: 'Run feature Checkout' }).click();
  await expect(page.getByText(/Run FAILED — 1\/3 passed/)).toBeVisible();

  await page.goto(`/projects/${projectId}/reports`);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();

  // Overall run health aggregated across the single run (1 pass / 1 fail / 1 skip). Scoped to the
  // health-rate element: the slice-43 "Tools" card also renders "33.3%" (the playwright row), so the
  // bare getByText would hit two elements under Playwright strict mode.
  await expect(page.locator('.gx-report__healthRate')).toHaveText('33.3%');
  await expect(page.getByText('1 of 3 tests passed')).toBeVisible();
  await expect(page.getByText(/Across 1 runs — 1 failures need triage, 1 skipped/)).toBeVisible();

  // Stat cards reflect the aggregated counts.
  await expect(page.getByTestId('stat-executed')).toContainText('3');
  await expect(page.getByTestId('stat-passed')).toContainText('1');
  await expect(page.getByTestId('stat-failed')).toContainText('1');
  await expect(page.getByTestId('stat-skipped')).toContainText('1');

  // Slice 43 — the per-tool "Tools" card. The deterministic kernel tags all three scenarios
  // "playwright" (stub-emitted tool/discipline), so one row shows 1 passed / 1 failed / 1 skipped.
  const tool = page.getByTestId('tool-playwright');
  await expect(tool).toContainText('33.3%');
  await expect(tool).toContainText('1 passed');
  await expect(tool).toContainText('1 failed');
  await expect(tool).toContainText('1 skipped');

  // The run itself appears in the recent-runs list.
  await expect(page.getByText('FAILED', { exact: true })).toBeVisible();
});
