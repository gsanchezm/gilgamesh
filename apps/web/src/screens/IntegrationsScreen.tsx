import { Button } from '@gilgamesh/ui';
import { useCallback, useEffect, useState } from 'react';
import type { IntegrationsClient, IntegrationView } from '../lib/integrations-client';

export interface IntegrationsScreenProps {
  client: IntegrationsClient;
  orgId: string;
}

export function IntegrationsScreen({ client, orgId }: IntegrationsScreenProps) {
  const [items, setItems] = useState<IntegrationView[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await client.list(orgId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load integrations.');
    }
  }, [client, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  function replace(view: IntegrationView) {
    setItems((prev) => prev.map((i) => (i.key === view.key ? view : i)));
  }

  async function connect(key: string) {
    setError(null);
    setBusy(key);
    try {
      replace(await client.connect(orgId, key, tokens[key] ?? ''));
      setTokens((t) => ({ ...t, [key]: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect.');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(key: string) {
    setError(null);
    setBusy(key);
    try {
      replace(await client.disconnect(orgId, key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="gx-integrations">
      <header>
        <h1>Integrations</h1>
        <p>Connect a source repository to import its feature files into the Test Lab.</p>
      </header>

      {error && (
        <p role="alert" className="gx-login__error">
          {error}
        </p>
      )}

      <ul className="gx-integrations__list">
        {items.map((i) => (
          <li key={i.key} className="gx-integrations__item" aria-label={i.name}>
            <span className="gx-integrations__name">{i.name}</span>
            <span className="gx-integrations__status">{i.connected ? 'Connected' : 'Not connected'}</span>
            {i.connected ? (
              <Button variant="secondary" onClick={() => disconnect(i.key)} disabled={busy === i.key}>
                Disconnect
              </Button>
            ) : (
              <>
                <input
                  aria-label={`Token for ${i.name}`}
                  type="password"
                  placeholder="Access token"
                  value={tokens[i.key] ?? ''}
                  onChange={(e) => setTokens((t) => ({ ...t, [i.key]: e.target.value }))}
                />
                <Button onClick={() => connect(i.key)} disabled={busy === i.key || !(tokens[i.key] ?? '').trim()}>
                  Connect
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
