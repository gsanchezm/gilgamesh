import { type APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'Lab', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

test('Test Lab: author a slice, a feature (parsed), a test case, and generate drafts', async ({
  page,
  request,
}) => {
  const email = `e2e-lab-${Date.now()}@example.com`;
  await seedUser(request, email);

  // Login + onboard a project through the UI.
  await page.goto('/login');
  await page.getByPlaceholder('name@company.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Name your project')).toBeVisible();
  await page.getByPlaceholder('OmniPizza').fill('OmniPizza');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Agent room' })).toBeVisible();

  // Deep-link into the Test Lab (a reload that exercises the /auth/me session restore).
  const projectId = /\/projects\/([^/]+)\/agents/.exec(page.url())?.[1];
  expect(projectId).toBeTruthy();
  await page.goto(`/projects/${projectId}/lab`);
  await expect(page.getByRole('heading', { name: 'Test Lab' })).toBeVisible();

  // Create a slice (POST through the CSRF double-submit path).
  await page.getByLabel('Slice key').fill('regression');
  await page.getByLabel('Slice name').fill('Regression');
  await page.getByRole('button', { name: 'Add slice' }).click();
  await expect(page.getByText('Regression')).toBeVisible();

  // Author a feature; the server parses its scenarios.
  await page.getByLabel('Feature path').fill('checkout.feature');
  await page
    .getByLabel('Feature content')
    .fill('Feature: Checkout\n  Scenario: Pay\n    When I pay\n  Scenario: Refund\n    When I refund');
  await page.getByRole('button', { name: 'Add feature' }).click();
  await expect(page.getByText('Checkout · 2 scenarios')).toBeVisible();

  // Author a test case.
  await page.getByLabel('Test case title').fill('Pay with card');
  await page.getByRole('button', { name: 'Add test case' }).click();
  await expect(page.getByText(/Pay with card · HIGH|Pay with card · MEDIUM/)).toBeVisible();

  // Generate drafts.
  await page.getByLabel('Prompt').fill('a checkout flow');
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/Generated \d+ feature draft/)).toBeVisible();
});
