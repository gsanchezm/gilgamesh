import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

// Maps 1:1 to specs/slices/07-look-and-feel/knowledge.feature. Drives the re-skinned Knowledge base
// against the real stack: per-org document upload (real ingest) + the global shared search.
const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'KB', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

async function loginAndOnboard(page: Page, email: string) {
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
}

test('Knowledge: upload a document (demo) and search the shared KB', async ({ page, request }) => {
  const email = `e2e-kb-${Date.now()}@example.com`;
  await seedUser(request, email);
  await loginAndOnboard(page, email);

  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { name: 'Knowledge base', exact: true })).toBeVisible();
  // Slice 33 adopted the shared EmptyState primitive here; its titles carry no trailing period.
  await expect(page.getByText('No documents uploaded yet')).toBeVisible();

  // Ingest the bundled sample → it appears under Indexed documents with a chunk count.
  await page.getByRole('button', { name: '+ demo' }).click();
  await expect(page.getByText('demo-istqb.md')).toBeVisible();
  await expect(page.getByText(/\d+ chunks/).first()).toBeVisible();

  // The shared search still works and returns cited results.
  await page.getByLabel('Search query').fill('boundary value analysis partitions');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText(/of \d+ chunks/)).toBeVisible();
  await expect(page.locator('.gx-kb__result').first()).toBeVisible();
  await expect(page.locator('.gx-kb__citation cite').first()).toBeVisible();

  // The uploaded per-org doc is NOT surfaced by the global search (tenant isolation).
  await expect(page.locator('.gx-kb__citation cite', { hasText: 'demo-istqb.md' })).toHaveCount(0);
});
