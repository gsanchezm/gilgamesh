import { type APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'Run', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

test('Test execution: author a feature, run it, and see aggregated results', async ({ page, request }) => {
  const email = `e2e-run-${Date.now()}@example.com`;
  await seedUser(request, email);

  await page.goto('/login');
  await page.getByPlaceholder('name@company.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Name your project')).toBeVisible();
  await page.getByPlaceholder('OmniPizza').fill('OmniPizza');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Agent room')).toBeVisible();

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

  // Run it (POST through the CSRF double-submit) and assert the aggregated result.
  await page.getByRole('button', { name: 'Run feature Checkout' }).click();
  await expect(page.getByText(/Run FAILED — 1\/3 passed/)).toBeVisible();
  await expect(page.getByText('Payment fails: FAIL')).toBeVisible();
});
