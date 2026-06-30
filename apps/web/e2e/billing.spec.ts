import { type APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'Bill', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

test('Billing: view plan + usage, change plan, mock checkout to ACTIVE', async ({ page, request }) => {
  const email = `e2e-bill-${Date.now()}@example.com`;
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
  await expect(page.getByRole('heading', { name: 'Agent room' })).toBeVisible();

  // Billing is active-org scoped via the restored session.
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(page.getByText(/TEAM · TRIALING/)).toBeVisible();
  await expect(page.getByText('0 / 1000 minutes used')).toBeVisible();

  // Change plan -> PRO (quota remaps).
  await page.getByRole('combobox', { name: 'Plan' }).selectOption('PRO');
  await page.getByRole('button', { name: 'Change plan' }).click();
  await expect(page.getByText(/PRO · TRIALING/)).toBeVisible();

  // Mock checkout -> confirm activates.
  await page.getByRole('button', { name: 'Checkout' }).click();
  await expect(page.getByText(/PRO · ACTIVE/)).toBeVisible();
});
