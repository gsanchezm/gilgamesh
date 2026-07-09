// Audit action phrases (data rows). Phase-1-OWNED (shared by Resumen "recent activity" + the Group-C
// Auditoría view) so both surfaces read the same strings without touching each other's module.
import type { ViewDict } from './dict';

const audit: ViewDict = {
  es: {
    'audit.price_change': 'Cambio de precio de plan',
    'audit.charge_retry': 'Reintento de cobro fallido',
    'audit.api_suspend': 'Suspensión de acceso API',
    'audit.user_invite': 'Invitación de usuario',
    'audit.pool_scale': 'Escalado de pool de runners',
    'audit.sso_config': 'Configuración de SSO',
    'audit.login': 'Inicio de sesión',
    'audit.plan_change': 'Cambio de plan',
    'audit.ws_suspend': 'Workspace suspendido',
    'audit.key_rotate': 'Rotación de clave de API',
    'audit.run_trigger': 'Ejecución disparada',
    'audit.invoice_paid': 'Factura pagada',
  },
  en: {
    'audit.price_change': 'Plan price change',
    'audit.charge_retry': 'Failed charge retry',
    'audit.api_suspend': 'API access suspended',
    'audit.user_invite': 'User invited',
    'audit.pool_scale': 'Runner pool scaled',
    'audit.sso_config': 'SSO configured',
    'audit.login': 'Sign in',
    'audit.plan_change': 'Plan changed',
    'audit.ws_suspend': 'Workspace suspended',
    'audit.key_rotate': 'API key rotated',
    'audit.run_trigger': 'Run triggered',
    'audit.invoice_paid': 'Invoice paid',
  },
};

export default audit;
