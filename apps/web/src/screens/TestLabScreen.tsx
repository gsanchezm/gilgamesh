import { Button } from '@gilgamesh/ui';
import { useCallback, useEffect, useState } from 'react';
import type { RunSummaryView, RunTargetKind, RunView, RunsClient } from '../lib/runs-client';
import type {
  FeatureSummaryView,
  GeneratedDraftsView,
  SliceView,
  TestCaseView,
  TestCasePriority,
  TestLabClient,
} from '../lib/testlab-client';

export interface TestLabScreenProps {
  client: TestLabClient;
  runsClient: RunsClient;
  projectId: string;
}

const PRIORITIES: TestCasePriority[] = ['HIGH', 'MEDIUM', 'LOW'];

export function TestLabScreen({ client, runsClient, projectId }: TestLabScreenProps) {
  const [slices, setSlices] = useState<SliceView[] | null>(null);
  const [features, setFeatures] = useState<FeatureSummaryView[]>([]);
  const [testCases, setTestCases] = useState<TestCaseView[]>([]);
  const [runs, setRuns] = useState<RunSummaryView[]>([]);
  const [lastRun, setLastRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sliceKey, setSliceKey] = useState('');
  const [sliceName, setSliceName] = useState('');
  const [featurePath, setFeaturePath] = useState('');
  const [featureContent, setFeatureContent] = useState('');
  const [tcTitle, setTcTitle] = useState('');
  const [tcPriority, setTcPriority] = useState<TestCasePriority>('MEDIUM');
  const [prompt, setPrompt] = useState('');
  const [drafts, setDrafts] = useState<GeneratedDraftsView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, f, t, r] = await Promise.all([
        client.listSlices(projectId),
        client.listFeatures(projectId),
        client.listTestCases(projectId),
        runsClient.listRuns(projectId),
      ]);
      setSlices(s);
      setFeatures(f);
      setTestCases(t);
      setRuns(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the Test Lab.');
    }
  }, [client, runsClient, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const addSlice = () =>
    action(async () => {
      const created = await client.createSlice(projectId, { key: sliceKey, name: sliceName });
      setSlices((prev) => [...(prev ?? []), created]);
      setSliceKey('');
      setSliceName('');
    });

  const addFeature = () =>
    action(async () => {
      const created = await client.createFeature(projectId, { path: featurePath, content: featureContent });
      setFeatures((prev) => [
        ...prev,
        { id: created.id, name: created.name, path: created.path, sliceId: created.sliceId, scenarioCount: created.scenarios.length },
      ]);
      setFeaturePath('');
      setFeatureContent('');
    });

  const addTestCase = () =>
    action(async () => {
      const created = await client.createTestCase(projectId, { title: tcTitle, priority: tcPriority });
      setTestCases((prev) => [...prev, created]);
      setTcTitle('');
    });

  const generate = () =>
    action(async () => {
      setDrafts(await client.generate(projectId, { prompt }));
    });

  const runTarget = (targetKind: RunTargetKind, targetId: string) =>
    action(async () => {
      const run = await runsClient.triggerRun(projectId, { targetKind, targetId });
      setLastRun(run);
      setRuns(await runsClient.listRuns(projectId));
    });

  if (error && slices === null) {
    return (
      <main className="gx-lab">
        <p role="alert" className="gx-login__error">
          {error}
        </p>
      </main>
    );
  }
  if (slices === null) {
    return (
      <main className="gx-lab">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="gx-lab">
      <header className="gx-lab__head">
        <h1>Test Lab</h1>
        <p className="gx-lab__sub">
          {slices.length} slices · {features.length} features · {testCases.length} test cases
        </p>
      </header>

      {error && (
        <p role="alert" className="gx-login__error">
          {error}
        </p>
      )}

      <section aria-label="Slices">
        <h2>Slices</h2>
        <ul>
          {slices.map((s) => (
            <li key={s.id}>{s.name}</li>
          ))}
        </ul>
        <input aria-label="Slice key" placeholder="key" value={sliceKey} onChange={(e) => setSliceKey(e.target.value)} />
        <input aria-label="Slice name" placeholder="Name" value={sliceName} onChange={(e) => setSliceName(e.target.value)} />
        <Button onClick={addSlice} disabled={busy}>
          Add slice
        </Button>
      </section>

      <section aria-label="Features">
        <h2>Features</h2>
        <ul>
          {features.map((f) => (
            <li key={f.id}>
              <span>
                {f.name} · {f.scenarioCount} scenarios
              </span>{' '}
              <Button aria-label={`Run feature ${f.name}`} onClick={() => runTarget('FEATURE', f.id)} disabled={busy}>
                Run
              </Button>
            </li>
          ))}
        </ul>
        <input aria-label="Feature path" placeholder="path.feature" value={featurePath} onChange={(e) => setFeaturePath(e.target.value)} />
        <textarea
          aria-label="Feature content"
          placeholder="Feature: …"
          value={featureContent}
          onChange={(e) => setFeatureContent(e.target.value)}
        />
        <Button onClick={addFeature} disabled={busy}>
          Add feature
        </Button>
      </section>

      <section aria-label="Test cases">
        <h2>Test cases</h2>
        <ul>
          {testCases.map((t) => (
            <li key={t.id}>
              <span>
                {t.key} · {t.title} · {t.priority}
              </span>{' '}
              <Button aria-label={`Run test case ${t.title}`} onClick={() => runTarget('TESTCASE', t.id)} disabled={busy}>
                Run
              </Button>
            </li>
          ))}
        </ul>
        <input aria-label="Test case title" placeholder="Title" value={tcTitle} onChange={(e) => setTcTitle(e.target.value)} />
        <select aria-label="Priority" value={tcPriority} onChange={(e) => setTcPriority(e.target.value as TestCasePriority)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <Button onClick={addTestCase} disabled={busy}>
          Add test case
        </Button>
      </section>

      <section aria-label="Generate">
        <h2>Generate with AI</h2>
        <input aria-label="Prompt" placeholder="Describe what to test…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <Button onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : 'Generate'}
        </Button>
        {drafts && (
          <p className="gx-lab__drafts">
            Generated {drafts.features.length} feature draft(s) and {drafts.testCases.length} test-case draft(s).
          </p>
        )}
      </section>

      <section aria-label="Runs">
        <h2>Runs</h2>
        {lastRun && (
          <div className="gx-lab__run">
            <p>
              Run {lastRun.status} — {lastRun.passed}/{lastRun.total} passed ({lastRun.ratePct}%)
            </p>
            <ul>
              {lastRun.results.map((r) => (
                <li key={r.refId}>
                  {r.name}: {r.status}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul>
          {runs.map((r) => (
            <li key={r.id}>
              {r.targetKind} · {r.status} · {r.passed}/{r.total}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
