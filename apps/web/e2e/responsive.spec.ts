import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

/**
 * Mobile (iPhone 390×844) responsive smoke: the authenticated shell + screens must NOT scroll
 * horizontally, and the off-canvas drawers (shell nav + chat sessions rail) open/close. Runs against
 * the same real stack as the other e2e specs. The hard invariant here is
 * `document.scrollingElement.scrollWidth <= clientWidth` AND the same on the `.gx-shell__content`
 * clip box (which reports true child extent even though it clips) — a squished pre-fix layout fails
 * the content check even when the clipped document passes.
 */
const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'C0rrect-Horse!';
const MOBILE = { width: 390, height: 844 };

async function seedUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { firstName: 'Resp', lastName: 'Smoke', email, password: PASSWORD },
  });
  expect(res.ok(), `register ${email} -> ${res.status()}`).toBeTruthy();
}

/** Assert no horizontal overflow on the document scroller AND the content clip box (±1px). */
async function expectNoOverflow(page: Page, where: string) {
  const m = await page.evaluate(() => {
    const se = document.scrollingElement as HTMLElement;
    const c = document.querySelector('.gx-shell__content') as HTMLElement | null;
    return {
      doc: [se.scrollWidth, se.clientWidth] as [number, number],
      content: c ? ([c.scrollWidth, c.clientWidth] as [number, number]) : [0, 0],
    };
  });
  expect(m.doc[0], `${where}: document overflow`).toBeLessThanOrEqual(m.doc[1] + 1);
  expect(m.content[0], `${where}: content overflow`).toBeLessThanOrEqual(m.content[1] + 1);
}

test('mobile @390: shell + screens do not scroll horizontally and the drawers work', async ({ page, request }) => {
  const email = `resp-smoke-${Date.now()}@example.com`;
  await seedUser(request, email);

  await page.setViewportSize(MOBILE);

  // Login → onboarding → agent room.
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
  const pid = /\/projects\/([^/]+)\//.exec(page.url())?.[1] ?? '';
  expect(pid).not.toBe('');

  // Agent room: no overflow.
  await expectNoOverflow(page, 'agent room');

  // Shell drawer: closed by default, the hamburger opens it (backdrop appears), a nav item both
  // navigates and closes the drawer.
  const shell = page.locator('.gx-shell');
  await expect(shell).toHaveAttribute('data-mobileopen', 'false');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(shell).toHaveAttribute('data-mobileopen', 'true');
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${pid}/reports$`));
  await expect(shell).toHaveAttribute('data-mobileopen', 'false');
  await expectNoOverflow(page, 'reports');

  // Chat: single pane + a "Conversations" drawer that opens and closes via its backdrop.
  await page.goto(`/projects/${pid}/chat`);
  await page.waitForSelector('.gx-chat');
  await expectNoOverflow(page, 'chat');
  const rail = page.locator('.gx-chat__rail');
  await expect(rail).toHaveAttribute('data-open', 'false');
  await page.getByRole('button', { name: 'Show conversations' }).click();
  await expect(rail).toHaveAttribute('data-open', 'true');
  await page.getByRole('button', { name: 'Close conversations' }).click();
  await expect(rail).toHaveAttribute('data-open', 'false');

  // The remaining authenticated screens: no horizontal overflow at 390px.
  for (const path of [`/projects/${pid}/lab`, '/knowledge', '/integrations', '/billing']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoOverflow(page, path);
  }
});

test('mobile @390: pre-auth screens hide the decorative hero and do not scroll horizontally', async ({ page }) => {
  await page.setViewportSize(MOBILE);

  // Every pre-auth screen shares the .gx-auth two-column layout + the aria-hidden helix hero.
  // On a phone the hero is hidden and the auth card takes the full width — no horizontal overflow.
  for (const path of ['/login', '/register', '/forgot-password', '/reset-password?token=demo']) {
    await page.goto(path);
    await page.waitForSelector('.gx-auth');
    await expect(page.locator('.gx-auth__hero'), `${path}: hero hidden on mobile`).toBeHidden();
    await expectNoOverflow(page, `pre-auth ${path}`);
  }
});
