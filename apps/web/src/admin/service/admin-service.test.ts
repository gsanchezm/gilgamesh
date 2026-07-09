import { describe, expect, it } from 'vitest';
import { MockAdminService } from './admin-service';

const svc = new MockAdminService();

// Internal Gilgamesh costs (README-admin §1) that the WORKSPACE role must never receive. The
// workspace's OWN plan price (`precioMensualUsd`) and its OWN invoice amounts (`montoUsd`) are its
// billing, not an internal cost — deliberately NOT in this set.
const FORBIDDEN_COST_KEYS = ['costo30d', 'costoUsd', 'costoEst30d', 'costoTotal', 'costos', 'margenPct', 'margen'];

/** Collect every key that appears anywhere in a (possibly nested) payload. */
function allKeys(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

describe('MockAdminService — workspace role is structurally cost-free', () => {
  const workspacePayloads: Record<string, unknown> = {
    getWorkspaceList: svc.getWorkspaceList(),
    getWorkspaceMeta: svc.getWorkspaceMeta('omnipizza'),
    getWorkspaceResumen: svc.getWorkspaceResumen('omnipizza'),
    getWorkspaceProyectos: svc.getWorkspaceProyectos('omnipizza'),
    getWorkspaceUso: svc.getWorkspaceUso('omnipizza'),
    getWorkspaceUsuarios: svc.getWorkspaceUsuarios('omnipizza'),
    getWorkspaceFacturacion: svc.getWorkspaceFacturacion('omnipizza'),
    getWorkspaceAjustes: svc.getWorkspaceAjustes('omnipizza'),
  };

  for (const [method, payload] of Object.entries(workspacePayloads)) {
    it(`${method} exposes no internal cost key`, () => {
      const keys = allKeys(payload);
      for (const forbidden of FORBIDDEN_COST_KEYS) {
        expect(keys.has(forbidden), `${method} leaked "${forbidden}"`).toBe(false);
      }
    });
  }

  it('workspace project rows hide both cost AND the tenant/client identity', () => {
    const rows = svc.getWorkspaceProyectos('omnipizza');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const keys = Object.keys(r);
      expect(keys).not.toContain('costo30d');
      expect(keys).not.toContain('clienteId');
      expect(keys).not.toContain('clienteNombre');
    }
  });

  it('workspace token usage carries tokens but not their cost', () => {
    const { tokensPorAgente } = svc.getWorkspaceUso('omnipizza');
    expect(tokensPorAgente.length).toBeGreaterThan(0);
    for (const row of tokensPorAgente) {
      expect(row).toHaveProperty('tokens30d');
      expect(Object.keys(row)).not.toContain('costoUsd');
    }
  });
});

describe('MockAdminService — platform role DOES expose internal costs', () => {
  it('platform projects carry per-project cost', () => {
    const rows = svc.getProyectos();
    expect(rows[0]?.costo30d).toBeGreaterThan(0);
  });

  it('platform usage carries token cost, and revenue carries infra costs', () => {
    expect(svc.getUso().costoTotal).toBeGreaterThan(0);
    expect(svc.getIngresos().costos).toBeGreaterThan(0);
  });

  it('client detail carries the client margin', () => {
    const detalle = svc.getCliente('vectorbank');
    expect(detalle?.margenPct).toBeGreaterThan(0);
  });
});
