import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/auth";
import { TourProvider } from "@/contexts/tour";
import { TourOverlay } from "@/components/tour-overlay";
import NotFound from "@/pages/not-found";
import LedgerPage from "@/pages/ledger";
import SubmitReport from "@/pages/submit";
import ManagePage from "@/pages/manage";
import LoginPage from "@/pages/login";
import QcPage from "@/pages/qc";
import QcListPage from "@/pages/qc-list";
import GuidePage from "@/pages/guide";
import { ReactNode } from "react";

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  if (user.role !== "admin") return <Redirect to="/submit" />;
  return <>{children}</>;
}

function Router() {
  const { user, loading } = useAuth();
  if (loading) return null;

  return (
    <Switch>
      <Route path="/login">
        {user ? <Redirect to="/ledger" /> : <LoginPage />}
      </Route>
      <Route path="/">
        {user ? <Redirect to="/ledger" /> : <Redirect to="/login" />}
      </Route>
      <Route path="/ledger">
        <RequireAuth><LedgerPage /></RequireAuth>
      </Route>
      <Route path="/submit">
        <RequireAuth><SubmitReport /></RequireAuth>
      </Route>
      <Route path="/manage">
        <RequireAdmin><ManagePage /></RequireAdmin>
      </Route>
      <Route path="/qc">
        <RequireAdmin><QcListPage /></RequireAdmin>
      </Route>
      <Route path="/qc/:reportId">
        <RequireAdmin><QcPage /></RequireAdmin>
      </Route>
      <Route path="/guide">
        <RequireAuth><GuidePage /></RequireAuth>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <TourProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <TourOverlay />
            <Toaster />
          </TourProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
