import { type APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'KB', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

test('Knowledge: search the shared KB and see results with source citations', async ({ page, request }) => {
  const email = `e2e-kb-${Date.now()}@example.com`;
  await seedUser(request, email);

  await page.goto('/login');
  await page.getByPlaceholder('name@company.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Onboard so we land authenticated, then jump to the (org-agnostic) knowledge base.
  await expect(page.getByText('Name your project')).toBeVisible();
  await page.getByPlaceholder('OmniPizza').fill('OmniPizza');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Agent room')).toBeVisible();

  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { name: 'Knowledge base' })).toBeVisible();

  await page.getByLabel('Search query').fill('boundary value analysis partitions');
  await page.getByRole('button', { name: 'Search' }).click();

  // The shared KB (seeded sample or full corpus) returns ranked results, each with a source citation.
  await expect(page.getByText(/of \d+ chunks/)).toBeVisible();
  await expect(page.locator('.gx-knowledge__result').first()).toBeVisible();
  await expect(page.locator('.gx-knowledge__citation cite').first()).toBeVisible();
});
