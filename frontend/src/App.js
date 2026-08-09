import { useEffect } from "react";
import Lenis from "lenis";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { Construction } from "lucide-react";
import { WalletProvider } from "@/context/WalletContext";
import { BottomNav } from "@/components/BottomNav";
import HomePage from "@/pages/HomePage";
import WalletPage from "@/pages/WalletPage";
import "@/App.css";

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

function App() {
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
    <div className="min-h-screen bg-background">
      <BrowserRouter>
        <WalletProvider>
          <ScrollTop />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/sports" element={<Placeholder title="Sports" />} />
            <Route path="/fantasy" element={<Placeholder title="Fantasy" />} />
            <Route path="/games" element={<Placeholder title="Games" />} />
          </Routes>
          <BottomNav />
          <Toaster position="top-center" richColors />
        </WalletProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
