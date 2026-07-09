// The whole admin route tree — default-exported so AppRoutes.tsx can `React.lazy(() => import(...))`
// it into a SEPARATE chunk (keeps the admin out of the main bundle). Both role trees live here; the
// `role` prop (set by which splat route matched in AppRoutes) selects the tree. Child paths are
// relative to the consumed splat prefix (`/admin/*` or `/w/:wsId/admin/*`); `:wsId` inherits via
// the parent route so `useParams` inside the layout sees it.
import { Route, Routes } from 'react-router-dom';
import type { AdminRole } from './data/types';
import { AdminLayout } from './shell/AdminLayout';
// Platform views
import { Auditoria } from './views/platform/Auditoria';
import { ClienteDetalle } from './views/platform/ClienteDetalle';
import { Clientes } from './views/platform/Clientes';
import { Ingresos } from './views/platform/Ingresos';
import { Planes } from './views/platform/Planes';
import { Proyectos } from './views/platform/Proyectos';
import { ProyectoDetalle } from './views/platform/ProyectoDetalle';
import { Resumen } from './views/platform/Resumen';
import { Salud } from './views/platform/Salud';
import { Uso } from './views/platform/Uso';
import { Usuarios } from './views/platform/Usuarios';
// Workspace views
import { Ajustes as WsAjustes } from './views/workspace/Ajustes';
import { Facturacion as WsFacturacion } from './views/workspace/Facturacion';
import { Proyectos as WsProyectos } from './views/workspace/Proyectos';
import { Resumen as WsResumen } from './views/workspace/Resumen';
import { Uso as WsUso } from './views/workspace/Uso';
import { Usuarios as WsUsuarios } from './views/workspace/Usuarios';

function PlatformRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout role="platform" />}>
        <Route index element={<Resumen />} />
        <Route path="ingresos" element={<Ingresos />} />
        <Route path="clientes" element={<Clientes />} />
        <Route path="clientes/:id" element={<ClienteDetalle />} />
        <Route path="planes" element={<Planes />} />
        <Route path="proyectos" element={<Proyectos />} />
        <Route path="proyectos/:id" element={<ProyectoDetalle />} />
        <Route path="uso" element={<Uso />} />
        <Route path="salud" element={<Salud />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="auditoria" element={<Auditoria />} />
        <Route path="*" element={<Resumen />} />
      </Route>
    </Routes>
  );
}

function WorkspaceRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout role="workspace" />}>
        <Route index element={<WsResumen />} />
        <Route path="proyectos" element={<WsProyectos />} />
        <Route path="uso" element={<WsUso />} />
        <Route path="usuarios" element={<WsUsuarios />} />
        <Route path="facturacion" element={<WsFacturacion />} />
        <Route path="ajustes" element={<WsAjustes />} />
        <Route path="*" element={<WsResumen />} />
      </Route>
    </Routes>
  );
}

export default function AdminApp({ role }: { role: AdminRole }) {
  return role === 'platform' ? <PlatformRoutes /> : <WorkspaceRoutes />;
}
