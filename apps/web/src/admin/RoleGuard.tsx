import type { ReactNode } from 'react';
import type { AdminRole } from './data/types';

/**
 * Permission seam for the admin console. In PRODUCTION the role is DERIVED from the authenticated
 * user's permissions (internal staff → platform; account owner/admin → workspace) and this guard
 * would (a) verify the session, (b) confirm the derived role matches the requested tree, and (c)
 * for the workspace tree, confirm membership of `wsId`. Phase 1 ships the demo role SWITCH, so the
 * guard PERMITS for now — but the signature is the real one, so wiring `resolveRole(session)` and a
 * redirect later touches only this file.
 *
 * Follow-up (documented in the design spec DoD): real staff/owner permission-derived role guard.
 */
export function RoleGuard({
  role: _role,
  wsId: _wsId,
  children,
}: {
  role: AdminRole;
  wsId?: string;
  children: ReactNode;
}) {
  // TODO(admin-auth): const { session } = useSession(); if (!permits(session, _role, _wsId)) return <Navigate .../>;
  return <>{children}</>;
}
