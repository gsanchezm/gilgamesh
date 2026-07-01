import { expect, test } from '@playwright/test';

// Maps 1:1 to specs/slices/07-look-and-feel/pricing.feature. Public page — no auth. Drives the real
// PricingScreen fed by the domain PLAN_CATALOG (the owner's 4-tier, per-workspace model).
test.describe('Pricing (public marketing page)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pricing');
  });

  test('shows the four tiers and monthly prices', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Summon the pantheon/i })).toBeVisible();
    for (const name of ['Free', 'Starter', 'Growth', 'Scale']) {
      await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();
    }
    await expect(page.getByText(/most popular/i)).toBeVisible();
    for (const price of ['$0', '$29', '$99', '$499']) {
      await expect(page.getByText(price, { exact: true })).toBeVisible();
    }
  });

  test('switching to annual shows the per-month-equivalent billed annually', async ({ page }) => {
    await page.getByRole('button', { name: 'ANNUAL' }).click();
    await expect(page.getByText('$24', { exact: true })).toBeVisible(); // Starter $29 → $24
    await expect(page.getByText(/billed annually/i).first()).toBeVisible();
  });

  test('starting a plan enters the signup funnel', async ({ page }) => {
    await page.getByRole('button', { name: 'Get started' }).click(); // Free CTA (unique)
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
  });

  test('sign in from pricing goes to login', async ({ page }) => {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
