import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../app/session';
import type { AdminRole } from './data/types';

/**
 * Access gate for the admin console. The console renders CLIENT-SIDE MOCK data (an `AdminService`
 * interface backed by `MockAdminService`; the real API is a future slice), so this guard is a
 * security/exposure control, not a data-authorization one: it keeps the (fabricated) HQ back-office
 * and per-workspace panels off the public internet.
 *
 * Both trees require an authenticated session. Then:
 *  - workspace tree (`/w/:wsId/admin`): only reachable for the workspace the user is ACTIVELY in
 *    (`wsId === activeOrgId`); a mismatch redirects to `/` (behaves like not-found — no 403 — so a
 *    workspace's existence is never leaked cross-tenant);
 *  - platform tree (`/admin`): there is NO staff/employee model in the app yet, so the all-customer
 *    back-office is gated behind the explicit build/config flag `VITE_ENABLE_PLATFORM_ADMIN` (OFF by
 *    default). A normal authenticated CUSTOMER therefore cannot reach it; setting the env var keeps
 *    the console demoable without exposing it by default.
 *
 * FOLLOW-UP (documented in the admin-console design DoD): replace the platform flag with a REAL
 * staff-permission-derived role check (internal staff → platform; account owner/admin → workspace).
 * The flag is a deliberate stopgap until that permission model exists; because the whole gate lives
 * in THIS file, that later change touches only here.
 */
export function RoleGuard({
  role,
  wsId,
  children,
}: {
  role: AdminRole;
  wsId?: string;
  children: ReactNode;
}) {
  const { authed, booting, activeOrgId } = useSession();

  // Wait out the session restore so we don't flash a redirect (same fallback as AppRoutes' guards).
  if (booting) return <div className="gx-booting">Loading…</div>;

  // Every admin route requires a session — a logged-out visitor is bounced to login.
  if (!authed) return <Navigate to="/login" replace />;

  if (role === 'platform') {
    // Read at render time (not a module const) so the value is undefined-by-default AND overridable
    // per-test via `vi.stubEnv`. Anything other than the exact string 'true' keeps the tree off.
    const platformEnabled = import.meta.env.VITE_ENABLE_PLATFORM_ADMIN === 'true';
    if (!platformEnabled) return <Navigate to="/" replace />;
  } else if (!wsId || wsId !== activeOrgId) {
    // Workspace tree: only the user's active org. Redirect like not-found (never 403).
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
