import { Button, ErrorState } from '@gilgamesh/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IntegrationsClient, IntegrationView } from '../lib/integrations-client';

export interface IntegrationsScreenProps {
  client: IntegrationsClient;
  orgId: string;
}

// Section title per integration group (keystone §8). Unknown groups are humanized from their key so
// the screen stays data-driven — it renders whatever the catalog returns, never a hardcoded list.
const GROUP_LABELS: Record<string, string> = {
  SOURCE_REPOS: 'Source & Repos',
  PROJECT_TRACKING: 'Project & Tracking',
  PIPELINES: 'Pipelines',
  COMMS: 'Comms',
  TEST_MANAGEMENT: 'Test Management',
  AI_PROVIDERS: 'AI Providers',
};

function groupLabel(group: string): string {
  return (
    GROUP_LABELS[group] ??
    group
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// Two-letter monogram for the card tile: curated for the known catalog keys (capture 11), else derived
// from the display name.
const MONOGRAMS: Record<string, string> = {
  github: 'GH',
  gitlab: 'GL',
  bitbucket: 'BB',
  ado_repos: 'AZ',
  anthropic: 'AN',
};

function monogram(key: string, name: string): string {
  const curated = MONOGRAMS[key];
  if (curated) return curated;
  const initials = name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return initials || name.slice(0, 2).toUpperCase();
}

/** Stroke-based status glyph (handoff §7 — no emoji): a check-circle when connected, a ring otherwise. */
function StatusMark({ connected }: { connected: boolean }) {
  return connected ? (
    <svg
      className="gx-intg__dot"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.4 12 2.5 2.5 4.7-5.2" />
    </svg>
  ) : (
    <svg
      className="gx-intg__dot"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5.5" />
    </svg>
  );
}

export function IntegrationsScreen({ client, orgId }: IntegrationsScreenProps) {
  const [items, setItems] = useState<IntegrationView[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Clear a prior error so a successful retry never leaves a stale banner (AC-ADOPT-05).
    setError(null);
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

  const connectedCount = items.filter((i) => i.connected).length;

  // Group the catalog by `group`, preserving the first-seen order of both groups and their entries.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, IntegrationView[]>();
    for (const item of items) {
      const bucket = byGroup.get(item.group);
      if (bucket) {
        bucket.push(item);
      } else {
        byGroup.set(item.group, [item]);
        order.push(item.group);
      }
    }
    return order.map((group) => ({ group, entries: byGroup.get(group) ?? [] }));
  }, [items]);

  return (
    <section className="gx-intg-screen">
      <header>
        <h1 className="gx-room__title">Integrations</h1>
        <p className="gx-room__sub">
          Connect Gilgamesh to your stack — repos, pipelines, tracking, comms and test management. Results
          always live in Gilgamesh.
        </p>
      </header>

      {items.length > 0 && (
        <span className="gx-intg__count">
          <StatusMark connected /> {connectedCount} Connected
        </span>
      )}

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {groups.map(({ group, entries }) => (
        <section className="gx-intg__group" key={group}>
          <h2 className="gx-intg__grouphead">{groupLabel(group)}</h2>
          <ul className="gx-intg__grid">
            {entries.map((i) => {
              const connected = i.connected;
              // [S21] A connected org Voyage key only embeds when the PLATFORM has a live Voyage
              // space (the coherence gate). Strict `=== false` — an absent flag means "unknown", not
              // "gated", so old/unwired responses render exactly as before.
              const voyageGated = i.key === 'voyage' && connected && i.platformVoyageActive === false;
              return (
                <li key={i.key} className="gx-intg" data-connected={connected} aria-label={i.name}>
                  <div className="gx-intg__head">
                    <span className="gx-intg__logo" aria-hidden="true">
                      {monogram(i.key, i.name)}
                    </span>
                    <div className="gx-intg__meta">
                      <span className="gx-intg__name">{i.name}</span>
                      <span className="gx-intg__status" data-connected={connected}>
                        <StatusMark connected={connected} />
                        {connected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                    <div className="gx-intg__action">
                      {connected ? (
                        <Button
                          variant="secondary"
                          onClick={() => disconnect(i.key)}
                          disabled={busy === i.key}
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          onClick={() => connect(i.key)}
                          disabled={busy === i.key || !(tokens[i.key] ?? '').trim()}
                        >
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>

                  {!connected && (
                    <div className="gx-intg__connect">
                      <input
                        className="gx-intg__token"
                        aria-label={`Token for ${i.name}`}
                        type="password"
                        placeholder="Paste a personal access token to connect"
                        value={tokens[i.key] ?? ''}
                        onChange={(e) => setTokens((t) => ({ ...t, [i.key]: e.target.value }))}
                      />
                    </div>
                  )}

                  {voyageGated && (
                    <p className="gx-intg__gated" role="status">
                      Connected — inactive: no platform Voyage space, embeddings stay lexical.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
