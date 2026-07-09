import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { Usuarios } from './Usuarios';

function renderUsuarios() {
  return render(
    <AdminProvider role="platform" wsId="omnipizza">
      <Usuarios />
    </AdminProvider>,
  );
}

describe('platform · Usuarios', () => {
  it('renders both roster sections with their headings', () => {
    renderUsuarios();
    // es default (no localStorage) → Spanish headings.
    expect(screen.getByText('Equipo Gilgamesh')).toBeTruthy();
    expect(screen.getByText('Admins de workspaces')).toBeTruthy();
  });

  it('lists the Gilgamesh team members with email, role and 2FA state', () => {
    renderUsuarios();
    expect(screen.getByText('Gabriel Sánchez')).toBeTruthy();
    expect(screen.getByText('Daniela Ortega')).toBeTruthy();
    expect(screen.getByText('Marco Peralta')).toBeTruthy();
    expect(screen.getByText('Lucía Fernández')).toBeTruthy();
    expect(screen.getByText('gabriel@gilgamesh.io')).toBeTruthy();
    // Owner (Gabriel) + workspace owners → multiple Owner chips exist.
    expect(screen.getAllByText('Owner').length).toBeGreaterThanOrEqual(1);
    // 2FA labels resolve from common.ts (activa/pendiente).
    expect(screen.getAllByText('Activa').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Pendiente')).toBeTruthy();
  });

  it('renders the workspace admins with the account name', () => {
    renderUsuarios();
    expect(screen.getByText('Sofía Ramírez')).toBeTruthy();
    expect(screen.getByText('OmniPizza Inc')).toBeTruthy();
    expect(screen.getByText('Vector Bank')).toBeTruthy();
  });

  it('exposes an invite-user action', () => {
    renderUsuarios();
    expect(screen.getByRole('button', { name: /invitar usuario/i })).toBeTruthy();
  });
});
