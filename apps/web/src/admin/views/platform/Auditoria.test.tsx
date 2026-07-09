import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminProvider } from '../../AdminContext';
import { Auditoria } from './Auditoria';

function renderAuditoria() {
  return render(
    <AdminProvider role="platform" wsId="omnipizza">
      <Auditoria />
    </AdminProvider>,
  );
}

// Language-neutral `objetivo` anchors (independent of the active lang):
const BILL_TARGET = 'Business $479 → $499'; // price_change → categoria 'bill'
const SEC_TARGET = 'Vector Bank · Okta'; //   sso_config   → categoria 'sec'

describe('platform · Auditoría', () => {
  it('renders the full log unfiltered, with category chips', () => {
    renderAuditoria();
    expect(screen.getByText(BILL_TARGET)).toBeTruthy();
    expect(screen.getByText(SEC_TARGET)).toBeTruthy();
    expect(screen.getByText('189.145.7.2')).toBeTruthy(); // IP column (Sofía login)
  });

  it('narrows the rows to a category in-memory (no reload) when a filter chip is clicked', () => {
    renderAuditoria();
    // Both categories visible under "Todo".
    expect(screen.getByText(BILL_TARGET)).toBeTruthy();
    expect(screen.getByText(SEC_TARGET)).toBeTruthy();

    // Click the "Facturación" (bill) chip.
    fireEvent.click(screen.getByRole('button', { name: 'Facturación' }));

    // A bill row stays; a sec row is gone.
    expect(screen.getByText(BILL_TARGET)).toBeTruthy();
    expect(screen.queryByText(SEC_TARGET)).toBeNull();
  });

  it('restores the full log when "Todo" is re-selected', () => {
    renderAuditoria();
    fireEvent.click(screen.getByRole('button', { name: 'Seguridad' }));
    expect(screen.queryByText(BILL_TARGET)).toBeNull();
    expect(screen.getByText(SEC_TARGET)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Todo' }));
    expect(screen.getByText(BILL_TARGET)).toBeTruthy();
    expect(screen.getByText(SEC_TARGET)).toBeTruthy();
  });
});
