import { useEffect, useState } from "react";
import Lenis from "lenis";
import axios from "axios";
import { BrowserRouter, Routes, Route, useLocation, useParams, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { Construction, Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { WalletProvider } from "@/context/WalletContext";
import { BottomNav } from "@/components/BottomNav";
import { SideNav } from "@/components/SideNav";
import { SupportChatbot } from "@/components/SupportChatbot";
import { InstallPrompt } from "@/components/InstallPrompt";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { isIndependenceWindow } from "@/lib/festive";
import { WelcomeAgentModal } from "@/components/WelcomeAgentModal";
import FantasyPage from "@/pages/FantasyPage";
import CasinoPage from "@/pages/CasinoPage";
import MyTable from "@/pages/MyTable";
import CoinDemoPreview from "@/pages/CoinDemoPreview";
import CourtCompare from "@/pages/CourtCompare";
import { SplashScreen } from "@/components/SplashScreen";
import HomePage from "@/pages/HomePage";
import WalletPage from "@/pages/WalletPage";
import AuthPage from "@/pages/AuthPage";
import ConsolePage from "@/pages/ConsolePage";
import ConsoleLoginPage from "@/pages/ConsoleLoginPage";
import SportsPage from "@/pages/SportsPage";
import "@/App.css";

const CONSOLE_ROLES = ["SUPER_ADMIN", "ZONAL_MANAGER", "MANAGER", "ADMIN", "SUPPORT_HELPER"];

const Placeholder = ({ title }) => (
  <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
    <span className="grid h-16 w-16 place-items-center rounded-3xl bg-royal-light text-royal">
      <Construction className="h-8 w-8" />
    </span>
    <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>
    <p className="mt-2 text-sm text-slate-500">This tab is coming soon. Explore Home and Wallet in the meantime.</p>
  </div>
);

const ScrollTop = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
};

const FullScreenLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background" data-testid="auth-loading">
    <Loader2 className="h-8 w-8 animate-spin text-royal" />
  </div>
);

const ProtectedShell = () => {
  const { loading, isAuthenticated } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!isAuthenticated) return <Navigate to="/auth" replace />;
  return (
    <WalletProvider>
      <ScrollTop />
      <WelcomeAgentModal />
      {isIndependenceWindow() && (
        <div data-testid="festive-ribbon" aria-hidden="true"
          className="fixed inset-x-0 top-0 z-[60] h-1"
          style={{ background: "linear-gradient(90deg,#FF9933 0 33%,#ffffff 33% 66%,#138808 66% 100%)" }} />
      )}
      <SideNav />
      <div className="md:pl-[76px] lg:pl-64">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/sports" element={<SportsPage />} />
          <Route path="/fantasy" element={<FantasyPage />} />
          <Route path="/games" element={<Placeholder title="Games" />} />
          <Route path="/casino" element={<CasinoPage />} />
          <Route path="/my-table" element={<MyTable />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <BottomNav />
      <SupportChatbot />
      <InstallPrompt />
    </WalletProvider>
  );
};

const AuthRoute = () => {
  const { loading, isAuthenticated, user } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (isAuthenticated) {
    // Admin roles land on the dark Console after login; players go to the app.
    return <Navigate to={CONSOLE_ROLES.includes(user?.role) ? "/console" : "/"} replace />;
  }
  return <AuthPage />;
};

// Per-Admin branded login at /login/:slug. Display-only layer over AuthPage —
// same auth underneath. Falls back to the default /auth on any invalid slug,
// missing branding, or inactive Admin.
const BrandedLoginRoute = () => {
  const { slug } = useParams();
  const { loading, isAuthenticated, user } = useAuth();
  const [branding, setBranding] = useState(undefined); // undefined=loading, null=fallback

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${process.env.REACT_APP_BACKEND_URL}/api/public/branding/${slug}`)
      .then((res) => { if (!cancelled) setBranding(res.data); })
      .catch(() => { if (!cancelled) setBranding(null); });
    return () => { cancelled = true; };
  }, [slug]);

  if (loading || branding === undefined) return <FullScreenLoader />;
  if (isAuthenticated) {
    return <Navigate to={CONSOLE_ROLES.includes(user?.role) ? "/console" : "/"} replace />;
  }
  if (branding === null) return <Navigate to="/auth" replace />;
  return <AuthPage branding={branding} />;
};

const ConsoleLoginRoute = () => {
  const { loading, isAuthenticated, user } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (isAuthenticated) {
    return <Navigate to={CONSOLE_ROLES.includes(user?.role) ? "/console" : "/"} replace />;
  }
  return <ConsoleLoginPage />;
};

const ConsoleRoute = () => {
  const { loading, isAuthenticated, user } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!isAuthenticated) return <Navigate to="/console/login" replace />;
  if (!CONSOLE_ROLES.includes(user?.role)) return <Navigate to="/" replace />;
  return <ConsolePage />;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/auth" element={<AuthRoute />} />
    <Route path="/coin-demo" element={<CoinDemoPreview />} />
    <Route path="/court-compare" element={<CourtCompare />} />
    <Route path="/login/:slug" element={<BrandedLoginRoute />} />
    <Route path="/console/login" element={<ConsoleLoginRoute />} />
    <Route path="/console" element={<ConsoleRoute />} />
    <Route path="/*" element={<ProtectedShell />} />
  </Routes>
);

function App() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    let id;
    const raf = (t) => {
      lenis.raf(t);
      id = requestAnimationFrame(raf);
    };
    id = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(id);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-background">
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
            <Toaster position="top-center" richColors />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
    </div>
  );
}

export default App;
