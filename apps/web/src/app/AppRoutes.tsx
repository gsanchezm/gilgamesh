import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AgentRoomScreen } from '../screens/AgentRoomScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { OnboardingWizard } from '../screens/OnboardingWizard';
import { TestLabScreen } from '../screens/TestLabScreen';
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
  const { testlab, runs } = useClients();
  const { projectId } = useParams();
  return <TestLabScreen client={testlab} runsClient={runs} projectId={projectId ?? ''} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <OnboardingRoute />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/agents"
        element={
          <RequireAuth>
            <AgentRoomRoute />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/lab"
        element={
          <RequireAuth>
            <TestLabRoute />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
