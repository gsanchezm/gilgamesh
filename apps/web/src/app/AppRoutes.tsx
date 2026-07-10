import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AgentRoomScreen } from '../screens/AgentRoomScreen';
import { BillingScreen } from '../screens/BillingScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ComingSoonScreen } from '../screens/ComingSoonScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { IntegrationsScreen } from '../screens/IntegrationsScreen';
import { KnowledgeScreen } from '../screens/KnowledgeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { OnboardingWizard } from '../screens/OnboardingWizard';
import { PricingScreen } from '../screens/PricingScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { TestLabScreen } from '../screens/TestLabScreen';
import { AppLayout } from './AppLayout';
import { useClients } from './clients';
import { useSession } from './session';

// The admin console (platform + workspace roles) is a SEPARATE lazy chunk so it never inflates the
// main bundle. Access is gated INSIDE the chunk by <RoleGuard> (in AdminLayout), NOT by the shell's
// RequireAuth: it requires an authenticated session for BOTH trees (logged-out → /login), restricts
// the workspace tree to the user's active org, and keeps the all-customer platform back-office behind
// the off-by-default `VITE_ENABLE_PLATFORM_ADMIN` flag (a stopgap until a real staff-permission model
// exists). Keeping the gate in the chunk means a future permission-derived role check touches one file.
const AdminApp = lazy(() => import('../admin/routes'));

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
  // `?sso=unavailable|failed` rides the SSO redirect back to /login (slice 15).
  const [params] = useSearchParams();
  if (booting) return <Booting />;
  // An already-authenticated user (e.g. session restored on reload) shouldn't see the login form.
  if (authed) return <Navigate to="/onboarding" replace />;
  return (
    <LoginScreen
      authClient={auth}
      sso={params.get('sso')}
      onSuccess={(result) => {
        signIn(result.activeOrgId);
        navigate('/onboarding');
      }}
      onCreate={() => navigate('/register')}
      onForgot={() => navigate('/forgot-password')}
      onViewPlans={() => navigate('/pricing')}
    />
  );
}

function ForgotPasswordRoute() {
  const { auth } = useClients();
  const navigate = useNavigate();
  return <ForgotPasswordScreen authClient={auth} onSignIn={() => navigate('/login')} />;
}

function ResetPasswordRoute() {
  const { auth } = useClients();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // The raw token rides the email link's query string; it is only ever POSTed, never stored.
  return (
    <ResetPasswordScreen
      authClient={auth}
      token={params.get('token')}
      onSignIn={() => navigate('/login')}
      onRequestNew={() => navigate('/forgot-password')}
    />
  );
}

function RegisterRoute() {
  const { auth } = useClients();
  const { signIn, authed, booting } = useSession();
  const navigate = useNavigate();
  // The company captured by a just-completed register, carried to onboarding as router state
  // (it becomes the Org name there — spec AC-ONB-14; the tenant is still bootstrapped only at
  // onboarding, AC-AUTH-01). It rides the authed-guard <Navigate> below rather than a separate
  // navigate() call: signIn() flushes immediately while navigate() is startTransition-deferred
  // (React Router 7), so a second navigation would lose the race to the stateless guard redirect
  // and strip the state.
  const [pendingCompany, setPendingCompany] = useState<string | null>(null);
  if (booting) return <Booting />;
  // An already-authenticated user shouldn't see the signup form.
  if (authed) {
    return <Navigate to="/onboarding" replace state={pendingCompany ? { company: pendingCompany } : undefined} />;
  }
  return (
    <RegisterScreen
      authClient={auth}
      onSuccess={(company) => {
        // Register auto-signs-in but creates no Org yet. Both updates land in one batch, so the
        // authed guard renders with the company already pending.
        setPendingCompany(company);
        signIn(null);
      }}
      onSignIn={() => navigate('/login')}
      onViewPlans={() => navigate('/pricing')}
    />
  );
}

function PricingRoute() {
  const navigate = useNavigate();
  // Public marketing page: both CTAs enter the funnel (start free → register; sign in → login).
  return <PricingScreen onStart={() => navigate('/register')} onSignIn={() => navigate('/login')} />;
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
  const navigate = useNavigate();
  const pid = projectId ?? '';
  return (
    <AgentRoomScreen
      client={agents}
      projectId={pid}
      onGoToCanvas={() => navigate(`/projects/${pid}/orchestrate`)}
      onOpenAgent={() => navigate(`/projects/${pid}/session`)}
      onChatAgent={(agentId) => navigate(`/projects/${pid}/chat?agent=${agentId}`)}
    />
  );
}

function ChatRoute() {
  const { chat, agents } = useClients();
  const { projectId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const pid = projectId ?? '';
  // `?agent=<agentId>` pins the session to one deity (the tile-pinned entry, slice 11).
  return (
    <ChatScreen
      client={chat}
      agentsClient={agents}
      projectId={pid}
      pinnedAgentId={params.get('agent')}
      onBack={() => navigate(`/projects/${pid}/agents`)}
    />
  );
}

function TestLabRoute() {
  const { testlab, runs, integrations } = useClients();
  const { projectId } = useParams();
  return (
    <TestLabScreen client={testlab} runsClient={runs} integrationsClient={integrations} projectId={projectId ?? ''} />
  );
}

function ReportsRoute() {
  const { runs } = useClients();
  const { projectId } = useParams();
  return <ReportsScreen runsClient={runs} projectId={projectId ?? ''} />;
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
  const { activeOrgId } = useSession();
  return <KnowledgeScreen client={knowledge} orgId={activeOrgId ?? ''} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/register" element={<RegisterRoute />} />
      {/* Public recovery flow (slice 12): reachable without a session, like login/register. */}
      <Route path="/forgot-password" element={<ForgotPasswordRoute />} />
      <Route path="/reset-password" element={<ResetPasswordRoute />} />
      {/* Public marketing pricing page (capture 03). */}
      <Route path="/pricing" element={<PricingRoute />} />
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
        <Route path="/projects/:projectId/reports" element={<ReportsRoute />} />
        <Route path="/projects/:projectId/chat" element={<ChatRoute />} />
        <Route path="/projects/:projectId/session" element={<ComingSoonScreen title="Session" />} />
        <Route path="/billing" element={<BillingRoute />} />
        <Route path="/knowledge" element={<KnowledgeRoute />} />
        <Route path="/integrations" element={<IntegrationsRoute />} />
      </Route>
      {/* Admin console — standalone, lazy. Two role trees behind splat routes; the descendant
          <Routes> inside AdminApp matches the remainder relative to the consumed prefix. */}
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<Booting />}>
            <AdminApp role="platform" />
          </Suspense>
        }
      />
      <Route
        path="/w/:wsId/admin/*"
        element={
          <Suspense fallback={<Booting />}>
            <AdminApp role="workspace" />
          </Suspense>
        }
      />
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
