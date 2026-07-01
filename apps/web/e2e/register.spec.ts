import { expect, test } from '@playwright/test';

// Maps 1:1 to specs/slices/07-look-and-feel/register.feature. Drives the REAL register UI against
// the real stack: POST /auth/register creates a User + auto-signs-in (Secure/__Host- session
// cookie), then the SPA routes into onboarding. A valid password must be ≥ 12 (API @MinLength).
const PASSWORD = 'C0rrect-Horse!';

test.describe('Create account (registration screen)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('the register screen mirrors the login hero and copy', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
    await expect(page.getByText('Start your workspace with your corporate email.')).toBeVisible();
    await expect(page.getByText('GILGAMESH')).toBeVisible();
  });

  test('client-side validation blocks a password shorter than 12 characters', async ({ page }) => {
    await page.getByLabel('First name', { exact: true }).fill('E2E');
    await page.getByLabel('Last name', { exact: true }).fill('Tester');
    await page.getByLabel('Company', { exact: true }).fill('Acme Inc.');
    await page.getByLabel('Corporate email', { exact: true }).fill(`e2e-${Date.now()}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('alert')).toContainText('12');
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
  });

  test('registering a new account signs me in and continues into onboarding', async ({ page }) => {
    const email = `e2e-reg-${Date.now()}@example.com`;
    await page.getByLabel('First name', { exact: true }).fill('E2E');
    await page.getByLabel('Middle name', { exact: true }).fill('de Pruebas');
    await page.getByLabel('Last name', { exact: true }).fill('Tester');
    await page.getByLabel('Company', { exact: true }).fill('Acme Inc.');
    await page.getByLabel('Corporate email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Name your project')).toBeVisible();
    const cookieNames = (await page.context().cookies()).map((c) => c.name);
    expect(cookieNames).toContain('__Host-gg_session');
    expect(cookieNames).toContain('csrf');
  });

  test('I can return to the sign-in screen', async ({ page }) => {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
