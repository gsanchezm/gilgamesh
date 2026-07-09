// usuarios view copy (Group C). Pre-registered in i18n/index.ts (prefix "usuarios."); no shared file
// needs editing. Role / 2FA labels are read from `common.ts` (roles.* / twofa.*), not duplicated here.
import type { ViewDict } from './dict';

const usuarios: ViewDict = {
  es: {
    'usuarios.title': 'Usuarios y roles',
    'usuarios.subtitle': 'Equipo de Gilgamesh y admins de workspaces.',
    'usuarios.eq_title': 'Equipo Gilgamesh',
    'usuarios.ws_title': 'Admins de workspaces',
    'usuarios.invite': 'Invitar usuario',
    'usuarios.invite_toast': 'Invitación enviada',
    'usuarios.col_usuario': 'Usuario',
    'usuarios.col_correo': 'Correo',
    'usuarios.col_rol': 'Rol',
    'usuarios.col_2fa': '2FA',
    'usuarios.col_actividad': 'Última actividad',
    'usuarios.col_workspace': 'Workspace',
  },
  en: {
    'usuarios.title': 'Users & roles',
    'usuarios.subtitle': 'Gilgamesh team and workspace admins.',
    'usuarios.eq_title': 'Gilgamesh team',
    'usuarios.ws_title': 'Workspace admins',
    'usuarios.invite': 'Invite user',
    'usuarios.invite_toast': 'Invitation sent',
    'usuarios.col_usuario': 'User',
    'usuarios.col_correo': 'Email',
    'usuarios.col_rol': 'Role',
    'usuarios.col_2fa': '2FA',
    'usuarios.col_actividad': 'Last activity',
    'usuarios.col_workspace': 'Workspace',
  },
};

export default usuarios;
