import { Outlet, useParams } from 'react-router-dom';
import type { AdminRole } from '../data/types';
import { AdminProvider } from '../AdminContext';
import { RoleGuard } from '../RoleGuard';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';
import { Toast } from './Toast';
import '../admin.css';

/**
 * Admin shell: sidebar + topbar + routed `<Outlet/>` + toast, all under an `AdminProvider` seeded
 * from the mounted route's `role` (and `:wsId` for the workspace tree). `admin.css` is imported HERE
 * (not index.css) so admin styles stay isolated and ride the lazy admin chunk.
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
        </div>
      </RoleGuard>
    </AdminProvider>
  );
}
