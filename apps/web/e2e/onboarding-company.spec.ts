import { expect, test } from '@playwright/test';

// Maps to specs/slices/01-auth-onboarding-agent-room/onboarding.feature @AC-ONB-14: the Company
// collected at register is carried via router state into the onboarding wizard (prefilled,
// editable on step 1) and names the Org — while the Project keeps its own name. The Org name is
// not surfaced in the app shell (the topbar shows the project), so the assertion goes through
// GET /auth/me (MeView.memberships[].org.name) with the browser context's real session cookie.
const PASSWORD = 'C0rrect-Horse!';
const COMPANY = 'Acme Inc.';
const PROJECT = 'Voyager QA';

test('registering with a Company names the Org from it after onboarding', async ({ page }) => {
  const email = `e2e-onbco-${Date.now()}@example.com`;

  // 1) Register with an explicit Company.
  await page.goto('/register');
  await page.getByLabel('First name', { exact: true }).fill('E2E');
  await page.getByLabel('Last name', { exact: true }).fill('Company');
  await page.getByLabel('Company', { exact: true }).fill(COMPANY);
  await page.getByLabel('Corporate email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  // 2) Onboarding step 1: the Company carried via router state prefills the (editable) field.
  await expect(page.getByText('Name your project')).toBeVisible();
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue(COMPANY);

  // 3) Complete the wizard with a project name DIFFERENT from the company.
  await page.getByLabel('Project name', { exact: true }).fill(PROJECT);
  await page.getByRole('button', { name: 'Continue' }).click(); // step 1 -> 2 (format: BDD default)
  await page.getByRole('button', { name: 'Continue' }).click(); // step 2 -> 3 (repo: skipped)
  await page.getByRole('button', { name: 'Create project' }).click();

  // 4) Land in the Agent room of the new project.
  await expect(page.getByRole('heading', { name: 'Agent room' })).toBeVisible();
  await expect(page.getByText(new RegExp(`11 agents · ${PROJECT}`))).toBeVisible();

  // 5) The Org was named from the Company, not the project (page.request shares the session cookie).
  const res = await page.request.get('/api/v1/auth/me');
  expect(res.ok(), `GET /auth/me -> ${res.status()}`).toBeTruthy();
  const me = (await res.json()) as { memberships: Array<{ org: { name: string } }> };
  expect(me.memberships).toHaveLength(1);
  expect(me.memberships[0].org.name).toBe(COMPANY);
});
