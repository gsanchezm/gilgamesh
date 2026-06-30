import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AgentRoomScreen } from '../screens/AgentRoomScreen';
import { BillingScreen } from '../screens/BillingScreen';
import { ComingSoonScreen } from '../screens/ComingSoonScreen';
import { IntegrationsScreen } from '../screens/IntegrationsScreen';
import { KnowledgeScreen } from '../screens/KnowledgeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { OnboardingWizard } from '../screens/OnboardingWizard';
import { TestLabScreen } from '../screens/TestLabScreen';
import { AppLayout } from './AppLayout';
import { useClients } from './clients';
import { useSession } from './session';

function Booting() {
  return <div className="gx-booting">Loading…</div>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { authed, booting } = useSession();
  if (booting) return <Booting />;
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}

/** `/` and unknown paths: wait out the session restore, then route by auth state. */
function Landing() {
  const { authed, booting } = useSession();
  if (booting) return <Booting />;
  return <Navigate to={authed ? '/onboarding' : '/login'} replace />;
}

function LoginRoute() {
  const { auth } = useClients();
  const { signIn, authed, booting } = useSession();
  const navigate = useNavigate();
  if (booting) return <Booting />;
  // An already-authenticated user (e.g. session restored on reload) shouldn't see the login form.
  if (authed) return <Navigate to="/onboarding" replace />;
  return (
    <LoginScreen
      authClient={auth}
      onSuccess={(result) => {
        signIn(result.activeOrgId);
        navigate('/onboarding');
      }}
    />
  );
}

function OnboardingRoute() {
  const { onboarding } = useClients();
  const navigate = useNavigate();
  return (
    <OnboardingWizard
      client={onboarding}
      onComplete={(result) => navigate(`/projects/${result.projectId}/agents`)}
    />
  );
}

function AgentRoomRoute() {
  const { agents } = useClients();
  const { projectId } = useParams();
  return <AgentRoomScreen client={agents} projectId={projectId ?? ''} />;
}

function TestLabRoute() {
  const { testlab, runs, integrations } = useClients();
  const { projectId } = useParams();
  return (
    <TestLabScreen client={testlab} runsClient={runs} integrationsClient={integrations} projectId={projectId ?? ''} />
  );
}

function IntegrationsRoute() {
  const { integrations } = useClients();
  const { activeOrgId } = useSession();
  return <IntegrationsScreen client={integrations} orgId={activeOrgId ?? ''} />;
}

function BillingRoute() {
  const { billing } = useClients();
  const { activeOrgId } = useSession();
  return <BillingScreen client={billing} orgId={activeOrgId ?? ''} />;
}

function KnowledgeRoute() {
  const { knowledge } = useClients();
  return <KnowledgeScreen client={knowledge} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<LoginRoute />} />
      {/* Onboarding is a standalone stepped flow — outside the app shell. */}
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <OnboardingRoute />
          </RequireAuth>
        }
      />
      {/* Authenticated in-app views render inside the sidebar+topbar shell. */}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/projects/:projectId/agents" element={<AgentRoomRoute />} />
        <Route path="/projects/:projectId/lab" element={<TestLabRoute />} />
        <Route path="/projects/:projectId/orchestrate" element={<ComingSoonScreen title="Orchestration" />} />
        <Route path="/projects/:projectId/reports" element={<ComingSoonScreen title="Reports" />} />
        <Route path="/billing" element={<BillingRoute />} />
        <Route path="/knowledge" element={<KnowledgeRoute />} />
        <Route path="/integrations" element={<IntegrationsRoute />} />
      </Route>
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
