import { type APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: 'Chat', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

test('Agent chat: talk to the pantheon and watch a chat-triggered run narrate back', async ({ page, request }) => {
  const email = `e2e-chat-${Date.now()}@example.com`;
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

  const projectId = /\/projects\/([^/]+)\/agents/.exec(page.url())?.[1];
  expect(projectId).toBeTruthy();

  // Author a feature the chat can run by name (deterministic kernel: no fail/skip keywords = PASS).
  await page.goto(`/projects/${projectId}/lab`);
  await page.getByLabel('Feature path').fill('checkout.feature');
  await page
    .getByLabel('Feature content')
    .fill('Feature: Checkout\n  Scenario: Checkout case 1\n    When step 1\n  Scenario: Checkout case 2\n    When step 2');
  await page.getByRole('button', { name: 'Add feature' }).click();
  await expect(page.getByText('Checkout · 2 scenarios')).toBeVisible();

  // A routed question reaches the perf specialist (Thor) — the router picks the slot, not the user.
  await page.goto(`/projects/${projectId}/chat`);
  await expect(page.getByRole('heading', { name: 'Agent chat' })).toBeVisible();
  await page.getByLabel('Message').fill('our checkout p95 latency explodes under load');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Thor here/)).toBeVisible();

  // A chat-triggered run rides the standard run path and narrates back into the conversation.
  await page.getByLabel('Message').fill('run the Checkout feature');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Enqueued a run of "Checkout"/)).toBeVisible();
  await expect(page.getByText(/PASS — Checkout case 1/)).toBeVisible();
});
