import { useState } from 'react';
import { Badge, Button, Card, IconChevronLeft, IconChevronRight, IconIntegrations, IconTestLab } from '@gilgamesh/ui';
import { useLocation } from 'react-router-dom';
import type { CreateProjectResult, OnboardingClient, ProjectFormat, RepoProvider } from '../lib/onboarding-client';

export interface OnboardingWizardProps {
  client: OnboardingClient;
  onComplete: (result: CreateProjectResult) => void;
}

type LocationState = {
  company?: string;
};

const FORMAT_OPTIONS: Array<{
  value: ProjectFormat;
  title: string;
  description: string;
  badge: string;
}> = [
  {
    value: 'BDD',
    title: 'BDD / Gherkin',
    description: 'Start with executable scenarios, readable specs and agent-friendly acceptance criteria.',
    badge: 'Recommended',
  },
  {
    value: 'TRADITIONAL',
    title: 'Traditional',
    description: 'Use structured test cases, step data and expected results for manual or hybrid QA.',
    badge: 'Classic',
  },
];

const REPO_OPTIONS: Array<{
  value: RepoProvider;
  title: string;
  description: string;
}> = [
  {
    value: 'github',
    title: 'GitHub',
    description: 'Connect repositories, pull requests and feature files.',
  },
  {
    value: 'bitbucket',
    title: 'Bitbucket',
    description: 'Attach workspace repos and import test assets later.',
  },
  {
    value: 'ado',
    title: 'Azure DevOps',
    description: 'Prepare Azure Repos integration for project sources.',
  },
];

const STEP_META = [
  { n: 1, label: 'Workspace' },
  { n: 2, label: 'Format' },
  { n: 3, label: 'Repository' },
] as const;

export function OnboardingWizard({ client, onComplete }: OnboardingWizardProps) {
  const location = useLocation();
  const routeState = location.state as LocationState | null;
  const carriedCompany = typeof routeState?.company === 'string' ? routeState.company.trim() : '';
  const [step, setStep] = useState(1);
  const [orgName, setOrgName] = useState(carriedCompany);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<ProjectFormat>('BDD');
  const [repo, setRepo] = useState<RepoProvider | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const effectiveOrgName = orgName.trim() || name.trim();

  async function finish() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await client.createProject({
        orgName: effectiveOrgName,
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
      <section className="gx-onboard__hero" aria-labelledby="onboarding-title">
        <div className="gx-onboard__brand">
          <span className="gx-onboard__mark">GX</span>
          <span>Gilgamesh</span>
        </div>
        <Badge tone="accent">Onboarding</Badge>
        <h1 id="onboarding-title">Prepare your QA workspace</h1>
        <p>Create the tenant, seed the agent roster and open your first project in one guided flow.</p>
        <Card className="gx-onboard__summary">
          <span className="gx-eyebrow">Workspace</span>
          <strong>{effectiveOrgName || 'Company pending'}</strong>
          <small>
            {name.trim() || 'Project pending'} · {format === 'BDD' ? 'BDD / Gherkin' : 'Traditional'}
          </small>
        </Card>
      </section>

      <Card className="gx-onboard__panel" as="section">
        <ol className="gx-onboard__steps" aria-label="Onboarding steps">
          {STEP_META.map(({ n, label }) => (
            <li key={n} aria-current={n === step ? 'step' : undefined} data-complete={n < step}>
              <span>{n}</span>
              <small>{label}</small>
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <section className="gx-onboard__step">
            <div className="gx-onboard__head">
              <Badge tone="muted">Step 1</Badge>
              <h2>Name your project</h2>
              <p>The company becomes the Org name; the project is the first QA workspace inside it.</p>
            </div>
            <div className="gx-onboard__fields">
              <label className="gx-field">
                <span className="gx-field__label">Company</span>
                <input value={orgName} placeholder="Acme Inc." onChange={(e) => setOrgName(e.target.value)} />
              </label>
              <label className="gx-field">
                <span className="gx-field__label">Project name</span>
                <input value={name} placeholder="OmniPizza" onChange={(e) => setName(e.target.value)} />
              </label>
            </div>
            <div className="gx-onboard__actions">
              <Button className="gx-onboard__next" disabled={!name.trim()} onClick={() => setStep(2)}>
                Continue <IconChevronRight size={16} />
              </Button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="gx-onboard__step">
            <div className="gx-onboard__head">
              <Badge tone="muted">Step 2</Badge>
              <h2>Choose a test format</h2>
              <p>Pick the authoring model the agents should use when they create your first assets.</p>
            </div>
            <div className="gx-onboard__cards">
              {FORMAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="gx-onboard__choice"
                  aria-label={option.title}
                  aria-pressed={format === option.value}
                  onClick={() => setFormat(option.value)}
                >
                  <span className="gx-onboard__choiceicon">
                    <IconTestLab size={20} />
                  </span>
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                  <Badge tone={format === option.value ? 'accent' : 'muted'}>{option.badge}</Badge>
                </button>
              ))}
            </div>
            <div className="gx-onboard__actions">
              <Button variant="secondary" onClick={() => setStep(1)}>
                <IconChevronLeft size={16} /> Back
              </Button>
              <Button onClick={() => setStep(3)}>
                Continue <IconChevronRight size={16} />
              </Button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="gx-onboard__step">
            <div className="gx-onboard__head">
              <Badge tone="muted">Step 3</Badge>
              <h2>Connect a repository</h2>
              <p>Optional — connect now or later from Integrations.</p>
            </div>
            <div className="gx-onboard__repos">
              {REPO_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="gx-onboard__repo"
                  aria-label={option.title}
                  aria-pressed={repo === option.value}
                  onClick={() => setRepo(repo === option.value ? undefined : option.value)}
                >
                  <IconIntegrations size={19} />
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                </button>
              ))}
            </div>
            {error ? (
              <p role="alert" className="gx-login__error gx-onboard__error">
                {error}
              </p>
            ) : null}
            <div className="gx-onboard__actions">
              <Button variant="secondary" onClick={() => setStep(2)}>
                <IconChevronLeft size={16} /> Back
              </Button>
              <Button disabled={submitting} onClick={finish}>
                {submitting ? 'Creating...' : 'Create project'}
              </Button>
            </div>
          </section>
        ) : null}
      </Card>
    </main>
  );
}
