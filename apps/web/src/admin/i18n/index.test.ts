import { describe, expect, it } from 'vitest';
import { MODULES, T, translator } from './index';

describe('admin i18n — T(lang, key)', () => {
  it('resolves a known key differently per language', () => {
    expect(T('es', 'shell.nav_clientes')).toBe('Clientes');
    expect(T('en', 'shell.nav_clientes')).toBe('Clients');
  });

  it('resolves the Resumen exemplar copy in both languages', () => {
    expect(T('es', 'resumen.title')).toBe('Resumen');
    expect(T('en', 'resumen.title')).toBe('Overview');
  });

  it('falls back to the key itself when a key is unregistered (never throws)', () => {
    expect(T('es', 'does.not.exist')).toBe('does.not.exist');
    expect(T('en', 'does.not.exist')).toBe('does.not.exist');
  });

  it('pre-registers every Phase-2 stub module (title present in BOTH languages)', () => {
    const stubTitles = [
      'ingresos.title',
      'clientes.title',
      'cd.title',
      'planes.title',
      'proyectos.title',
      'pd.title',
      'uso.title',
      'salud.title',
      'usuarios.title',
      'auditoria.title',
      'wsr.title',
      'wsp.title',
      'wsu.title',
      'wsusr.title',
      'wsf.title',
      'wsa.title',
    ];
    for (const key of stubTitles) {
      expect(T('es', key), `es missing ${key}`).not.toBe(key);
      expect(T('en', key), `en missing ${key}`).not.toBe(key);
    }
  });

  it('translator() binds a language', () => {
    const t = translator('en');
    expect(t('shell.role_platform')).toBe('Platform');
  });

  // "All copy in both languages" (task requirement): every module must define the SAME key set in es
  // and en — otherwise an es-only key renders the raw dotted key in English (T falls back to the key
  // itself). Compares key SETS, not values (many values are legitimately identical across languages).
  // This also guards every Phase-2 group's future additions automatically.
  it('every module has identical es/en key sets (no untranslated key)', () => {
    for (const mod of MODULES) {
      const es = Object.keys(mod.es).sort();
      const en = Object.keys(mod.en).sort();
      expect(es).toEqual(en);
    }
  });
});
