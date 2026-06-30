import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AgentRoomScreen } from '../screens/AgentRoomScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { OnboardingWizard } from '../screens/OnboardingWizard';
import { useClients } from './clients';
import { useSession } from './session';

function RequireAuth({ children }: { children: ReactNode }) {
  const { authed, booting } = useSession();
  if (booting) return <div className="gx-booting">Loading…</div>;
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}

function LoginRoute() {
  const { auth } = useClients();
  const { signIn } = useSession();
  const navigate = useNavigate();
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

export function AppRoutes() {
  return (
    <Routes>
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
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
