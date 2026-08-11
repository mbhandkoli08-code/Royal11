import { useEffect, useState } from "react";
import Lenis from "lenis";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Toaster } from "sonner";
import { Construction, Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { WalletProvider } from "@/context/WalletContext";
import { BottomNav } from "@/components/BottomNav";
import { WelcomeAgentModal } from "@/components/WelcomeAgentModal";
import { SplashScreen } from "@/components/SplashScreen";
import HomePage from "@/pages/HomePage";
import WalletPage from "@/pages/WalletPage";
import AuthPage from "@/pages/AuthPage";
import ConsolePage from "@/pages/ConsolePage";
import ConsoleLoginPage from "@/pages/ConsoleLoginPage";
import SportsPage from "@/pages/SportsPage";
import "@/App.css";

const CONSOLE_ROLES = ["SUPER_ADMIN", "ZONAL_MANAGER", "MANAGER", "ADMIN"];

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
  useEffect(() => window.scrollTo(0, 0), [pathname]);
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
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/sports" element={<SportsPage />} />
        <Route path="/fantasy" element={<Placeholder title="Fantasy" />} />
        <Route path="/games" element={<Placeholder title="Games" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
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
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster position="top-center" richColors />
        </AuthProvider>
      </BrowserRouter>
      <AnimatePresence>
        {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
      </AnimatePresence>
    </div>
  );
}

export default App;
