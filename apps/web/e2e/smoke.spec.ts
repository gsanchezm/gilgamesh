import { type APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

// Registration has no UI in slice 1, so seed the account via the API, then drive the real UI login.
async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'Smoke', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

test('full flow: login → onboarding (CSRF POST) → agent room toggle + wake-all (CSRF)', async ({
  page,
  request,
}) => {
  const email = `e2e-${Date.now()}@example.com`;
  await seedUser(request, email);

  // 1) Real UI login through the same-origin proxy.
  await page.goto('/login');
  await page.getByPlaceholder('name@company.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: 'Enter' }).click();

  // 2) Onboarding wizard. "Create project" is a POST /projects that MUST carry X-CSRF-Token
  //    (double-submit) — if the client CSRF wiring were broken this 403s and we never advance.
  await expect(page.getByText('Name your project')).toBeVisible();

  // Login has resolved: the Secure/__Host- session cookie was actually stored by the browser
  // over http://localhost (and the readable csrf cookie that the double-submit depends on).
  const cookieNames = (await page.context().cookies()).map((c) => c.name);
  expect(cookieNames).toContain('__Host-gg_session');
  expect(cookieNames).toContain('csrf');
  await page.getByPlaceholder('OmniPizza').fill('OmniPizza');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();

  // 3) Agent room: the freshly-onboarded tenant has all 11 agents awake.
  await expect(page.getByRole('heading', { name: 'Agent room' })).toBeVisible();
  await expect(page.getByText(/11 agents · OmniPizza/)).toBeVisible();
  await expect(page.getByText('11 / 11')).toBeVisible();

  // 4) Toggle the first agent off (PATCH + CSRF) — awake drops to 10/11.
  await page.getByRole('switch').first().click();
  await expect(page.getByText('10 / 11')).toBeVisible();

  // 5) Awaken the whole team (POST + CSRF) — back to 11/11.
  await page.getByRole('button', { name: 'Awaken team' }).click();
  await expect(page.getByText('11 / 11')).toBeVisible();
});
