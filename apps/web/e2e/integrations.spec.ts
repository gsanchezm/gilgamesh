import { type APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'Int', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

test('Integrations: connect a source repo (CSRF) and see it connected', async ({ page, request }) => {
  const email = `e2e-int-${Date.now()}@example.com`;
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

  await page.goto('/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

  const githubRow = page.getByRole('listitem', { name: 'GitHub' });
  await expect(githubRow.getByText('Not connected')).toBeVisible();
  await githubRow.getByLabel('Token for GitHub').fill('ghp_e2e_token_value');
  await githubRow.getByRole('button', { name: 'Connect' }).click();

  // The double-submit CSRF mutation succeeds and the row flips to Connected.
  await expect(githubRow.getByText('Connected')).toBeVisible();
});
