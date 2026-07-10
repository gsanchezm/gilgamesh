import { Outlet, useParams } from 'react-router-dom';
import type { AdminRole } from '../data/types';
import { AdminProvider, useAdmin } from '../AdminContext';
import { RoleGuard } from '../RoleGuard';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';
import { Toast } from './Toast';
import '../admin.css';

/**
 * A subtle-but-unmistakable indicator that everything on screen is CLIENT-SIDE MOCK data (there is no
 * real admin API yet). Rendered INSIDE the shell (so it only shows to users the guard let through) and
 * BELOW `AdminProvider` (so `useAdmin()` resolves — `AdminLayout` itself sits above the provider).
 */
function DemoBadge() {
  const { t } = useAdmin();
  return (
    <div className="gx-adm-demo-badge" role="status">
      {t('shell.demo')}
    </div>
  );
}

/**
 * Admin shell: sidebar + topbar + routed `<Outlet/>` + toast, all under an `AdminProvider` seeded
 * from the mounted route's `role` (and `:wsId` for the workspace tree). `admin.css` is imported HERE
 * (not index.css) so admin styles stay isolated and ride the lazy admin chunk. `RoleGuard` gates
 * access (auth + workspace membership + the platform flag) before any of it renders.
 */
export function AdminLayout({ role }: { role: AdminRole }) {
  const { wsId } = useParams();
  return (
    <AdminProvider role={role} wsId={wsId ?? ''}>
      <RoleGuard role={role} wsId={wsId}>
        <div className="gx-adm-shell">
          <AdminSidebar />
          <div className="gx-adm-main">
            <AdminTopbar />
            <main className="gx-adm-content">
              <Outlet />
            </main>
          </div>
          <Toast />
          <DemoBadge />
        </div>
      </RoleGuard>
    </AdminProvider>
  );
}
