# Slice 34 — Stripe billing portal (portal-only)

## Summary

Add a **Stripe Customer Portal** self-service flow. An OWNER/ADMIN opens Stripe's hosted billing
portal, where plan change / proration / payment-method update / cancel are all handled by Stripe's
own UI. **Portal-only**: this slice adds NO programmatic refund/proration/portal-configuration APIs —
the single new capability is "mint a one-time portal link and send the admin to it".

This extends the frozen keystone §5 `PaymentProvider` port **additively** (owner decision S34, the
S13 precedent: `listInvoices`/`handleWebhook` were added the same way — NO keystone amendment). It
runs offline-deterministically under `PAYMENTS_MODE=offline` (the mock), exactly like every other
payments surface.

## Owner decisions

- **S34-A — additive port method, no keystone change.** `createPortalSession(orgId)` joins
  `PaymentProvider` the way `listInvoices`/`handleWebhook` did in slice 13. `foundation-vocabulary.md`
  is untouched.
- **S34-B — portal-only.** No refund/proration endpoints; Stripe's hosted portal owns those flows.
- **S34-C — route path.** `POST /orgs/{orgId}/billing/portal` (a dedicated `BillingPortalController`
  mounted at `orgs/:orgId/billing`, alongside the existing `billing/webhooks/:provider` controller;
  the subscription controller is left untouched).
- **S34-D — no-billing-account signal = `VALIDATION` (422).** An org that has never completed a
  checkout has `providerCustomerId = null`. Opening the portal in that state returns `VALIDATION`,
  matching the existing precedent in `StripePaymentProvider.confirmCheckout` ("checkout has not
  completed yet"). It never 500s.
- **S34-E — return URL config.** `STRIPE_PORTAL_RETURN_URL` (falls back to `STRIPE_SUCCESS_URL`, then
  to the `/billing` default), following the existing `stripeOptionsFromEnv` config conventions.

## Behavior (acceptance criteria)

- **AC-PORTAL-01** — An OWNER/ADMIN of an org that has completed a checkout (has a provider customer)
  opens the portal and receives a `{ portalUrl }`. The action is audited (`subscription.portal_opened`).
- **AC-PORTAL-02** — A member without the OWNER/ADMIN role gets `403 FORBIDDEN`.
- **AC-PORTAL-03** — A non-member gets `404 NOT_FOUND` (org existence is never leaked across tenants).
- **AC-PORTAL-04** — An org with no billing account (never checked out → `providerCustomerId = null`)
  gets `422 VALIDATION`, never a 500.
- **AC-PORTAL-05** — Opening the portal requires authentication (401 unauthenticated) and the CSRF
  double-submit on the POST (403 without the token), like every other billing mutation.
- **AC-PORTAL-06** — Offline/mock: the portal URL is deterministic and derived from the orgId; no
  network call is ever made.
- **AC-PORTAL-08 (security)** — The Stripe secret key never appears in a log line, a thrown error
  message, an audit-log row, or the HTTP response. Only the hosted `portalUrl` is returned.

## Ports / adapters

- **Port** (`packages/application/src/ports/payment.ts`): add
  `createPortalSession(orgId: string): Promise<{ portalUrl: string }>`.
- **Mock** (`packages/application/src/payment/mock-payment-provider.ts`): returns
  `https://mock.pay/portal/<orgId>` — deterministic, offline.
- **Stripe adapter** (`apps/api/src/infra/stripe-payment-provider.ts`): resolves the org's
  subscription → `providerCustomerId`; calls `stripe.billingPortal.sessions.create({ customer,
  return_url })`; returns `{ portalUrl: session.url }`. `portalReturnUrl` added to
  `StripeProviderOptions`/`stripeOptionsFromEnv`.

## Use case

`StartBillingPortal` (`packages/application/src/use-cases/subscription.ts`), sharing the subscription
deps bundle:

1. `requireOrgAdmin` (OWNER/ADMIN; non-member → `NOT_FOUND`; member → `FORBIDDEN`).
2. Resolve the subscription (`requireSub`); if `providerCustomerId` is null → `VALIDATION`
   ("No billing account yet — complete a checkout first.").
3. `audit('subscription.portal_opened')`.
4. `payment.createPortalSession(orgId)` → `{ portalUrl }`.

## API

- New `BillingPortalController` at `@Controller('orgs/:orgId/billing')`, `POST portal` (`@HttpCode(200)`),
  `SessionAuthGuard` + the global CSRF guard, returns `{ portalUrl }`.
- Wired into `BillingModule` via the existing `subProvider(StartBillingPortal)` factory.

## Web

- `billing-client.ts`: `openPortal(orgId): Promise<{ portalUrl }>` via `sendJson('POST',
  '/orgs/:orgId/billing/portal', {})` (CSRF double-submit).
- `BillingScreen.tsx`: a "Manage billing" button that calls `openPortal` and, on success, navigates
  the browser to the returned `portalUrl` (`window.location.href = portalUrl`); load/error handling
  follows the screen's existing `busy`/error pattern.

## Out of scope / deferred

- Programmatic refunds, proration previews, and portal-configuration management (Stripe hosts these).
- A "return from portal" webhook reconciliation beyond the existing invoice/subscription webhooks.
