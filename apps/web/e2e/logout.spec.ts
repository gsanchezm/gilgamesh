import { type APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'Out', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

test('Logout: sidebar Log out revokes the session, clears cookies and locks the app (AC-OUT-01..03)', async ({
  page,
  request,
}) => {
  const email = `e2e-out-${Date.now()}@example.com`;
  await seedUser(request, email);

  // Real UI login → onboarding → agent room (the authenticated shell with the sidebar).
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

  // Keep the pre-logout session cookie so we can prove server-side revocation (not just clearing).
  const sessionCookie = (await page.context().cookies()).find((c) => c.name === '__Host-gg_session');
  expect(sessionCookie?.value).toBeTruthy();

  // AC-OUT-02: Log out from the sidebar → the SPA drops its session and lands on /login.
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  // AC-OUT-01: the server cleared the __Host- session cookie in the browser…
  const cookieNames = (await page.context().cookies()).map((c) => c.name);
  expect(cookieNames).not.toContain('__Host-gg_session');

  // …and revoked the Session row itself: replaying the captured pre-logout cookie is rejected
  // (the `request` fixture has its own empty cookie jar, so only the replayed header counts).
  const replay = await request.get(`${API}/auth/me`, {
    headers: { cookie: `__Host-gg_session=${sessionCookie!.value}` },
  });
  expect(replay.status()).toBe(401);

  // AC-OUT-03: a protected route now bounces to /login (a full reload, so this exercises the
  // real /auth/me session-restore path returning 401, not just SPA state).
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
