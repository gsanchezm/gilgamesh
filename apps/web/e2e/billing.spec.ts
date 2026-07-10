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
  await page.getByRole('button', { name: 'Enter' }).click();

  await expect(page.getByText('Name your project')).toBeVisible();
  await page.getByPlaceholder('OmniPizza').fill('OmniPizza');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Agent room' })).toBeVisible();

  // Billing is active-org scoped via the restored session.
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(page.getByText(/Free · TRIALING/)).toBeVisible();
  await expect(page.getByText('0 / 500 used')).toBeVisible();
  // Slice 14: the AI token allowance meter (FREE seeds 100k/mo).
  await expect(page.getByText('0 / 100,000 AI tokens used')).toBeVisible();

  // Change plan -> Growth (quota remaps).
  await page.getByRole('combobox', { name: 'Plan' }).selectOption('GROWTH');
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByText(/Growth · TRIALING/)).toBeVisible();

  // Mock checkout -> confirm activates.
  await page.getByRole('button', { name: 'Checkout' }).click();
  await expect(page.getByText(/Growth · ACTIVE/)).toBeVisible();

  // Slice 13: the confirm records a deterministic PAID invoice, listed in-app with its hosted link.
  await expect(page.getByText('PAID', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View invoice' })).toBeVisible();

  // Slice 40: with a billing account, selecting a different plan shows the proration preview line and
  // the opt-in refund checkbox appears. (Amounts run under the real clock — assert the sign, not cents.)
  await page.getByRole('combobox', { name: 'Plan' }).selectOption('SCALE');
  await expect(page.getByTestId('proration-preview')).toContainText(/Changing to Scale: \+\$\d+ now/);

  // Opt into the prorated refund and cancel — the subscription ends CANCELED. Name the checkbox so a
  // theme/nav toggle in the shell can't make the role selector ambiguous (Playwright strict mode).
  await page.getByRole('checkbox', { name: /Refund the unused portion/ }).check();
  await page.getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(page.getByText(/· CANCELED/)).toBeVisible();
});
