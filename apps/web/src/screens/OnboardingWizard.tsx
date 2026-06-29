import { useState } from 'react';
import { Button } from '@gilgamesh/ui';
import type {
  CreateProjectResult,
  OnboardingClient,
  ProjectFormat,
  RepoProvider,
} from '../lib/onboarding-client';

const REPO_LABEL: Record<RepoProvider, string> = {
  github: 'GitHub',
  bitbucket: 'Bitbucket',
  ado: 'Azure DevOps',
};

export interface OnboardingWizardProps {
  client: OnboardingClient;
  onComplete: (result: CreateProjectResult) => void;
}

export function OnboardingWizard({ client, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<ProjectFormat>('BDD');
  const [repo, setRepo] = useState<RepoProvider | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function finish() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await client.createProject({
        projectName: name.trim(),
        format,
        repoProvider: repo,
      });
      onComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the project.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="gx-onboard">
      <ol className="gx-onboard__steps" aria-label="Onboarding steps">
        {[1, 2, 3].map((n) => (
          <li key={n} aria-current={n === step ? 'step' : undefined}>
            {n}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section>
          <h2>Name your project</h2>
          <label className="gx-field">
            <span className="gx-field__label">Project name</span>
            <input value={name} placeholder="OmniPizza" onChange={(e) => setName(e.target.value)} />
          </label>
          <Button disabled={!name.trim()} onClick={() => setStep(2)}>
            Continue
          </Button>
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h2>Choose a test format</h2>
          <div className="gx-onboard__cards">
            <button type="button" aria-pressed={format === 'BDD'} onClick={() => setFormat('BDD')}>
              BDD / Gherkin
            </button>
            <button
              type="button"
              aria-pressed={format === 'TRADITIONAL'}
              onClick={() => setFormat('TRADITIONAL')}
            >
              Traditional
            </button>
          </div>
          <Button variant="secondary" onClick={() => setStep(1)}>
            Back
          </Button>
          <Button onClick={() => setStep(3)}>Continue</Button>
        </section>
      ) : null}

      {step === 3 ? (
        <section>
          <h2>Connect a repository</h2>
          <p>Optional — connect now or later from Integrations.</p>
          <div className="gx-onboard__repos">
            {(['github', 'bitbucket', 'ado'] as RepoProvider[]).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={repo === p}
                onClick={() => setRepo(repo === p ? undefined : p)}
              >
                {REPO_LABEL[p]}
              </button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="gx-login__error">
              {error}
            </p>
          ) : null}
          <Button variant="secondary" onClick={() => setStep(2)}>
            Back
          </Button>
          <Button disabled={submitting} onClick={finish}>
            {submitting ? 'Creating…' : 'Create project'}
          </Button>
        </section>
      ) : null}
    </main>
  );
}
