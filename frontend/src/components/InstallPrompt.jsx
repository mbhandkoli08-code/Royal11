import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";

const DISMISS_KEY = "royal11_install_dismissed";

// Detects if the app is already running as an installed PWA (standalone).
const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;

/**
 * Lightweight "Install ROYAL11" banner (mobile-first).
 * - Android/Chrome: captures `beforeinstallprompt` and shows a real Install button.
 * - iOS Safari (no beforeinstallprompt): shows the manual "Share → Add to Home Screen" hint.
 * Installing/launching from the home screen opens ROYAL11 with zero browser chrome.
 */
export const InstallPrompt = () => {
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed — never show
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    const onBip = (e) => {
      e.preventDefault();
      setDeferred(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    // iOS never fires beforeinstallprompt — surface a manual hint after a beat.
    let iosTimer;
    if (isIOS()) {
      iosTimer = setTimeout(() => { setIosHint(true); setVisible(true); }, 2500);
    }

    const onInstalled = () => { setVisible(false); localStorage.setItem(DISMISS_KEY, "1"); };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  const dismiss = () => { setVisible(false); localStorage.setItem(DISMISS_KEY, "1"); };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* noop */ }
    setDeferred(null);
    dismiss();
  };

  if (!visible) return null;

  return (
    <div data-testid="pwa-install-prompt"
      className="fixed inset-x-3 bottom-20 z-[85] mx-auto max-w-md rounded-2xl border border-[#e9c667]/40 bg-[#150a0c]/95 p-3.5 shadow-2xl backdrop-blur-md md:bottom-6 md:left-6 md:right-auto md:w-80">
      <button data-testid="pwa-install-dismiss" onClick={dismiss} aria-label="Dismiss"
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white">
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e9c667]/15 text-[#e9c667]">
          <Download className="h-5 w-5" />
        </span>
        <div className="min-w-0 pr-4">
          <p className="text-sm font-black text-[#e9c667]">Install ROYAL11</p>
          {iosHint ? (
            <p className="mt-0.5 text-xs leading-snug text-white/70">
              Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" /> then <b className="text-white/90">“Add to Home Screen”</b> for a full-screen, no-URL-bar app.
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-snug text-white/70">
              Add to your home screen for a full-screen, app-like experience — no browser bar.
            </p>
          )}
          {!iosHint && (
            <button data-testid="pwa-install-btn" onClick={install}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[#e9c667] px-4 py-1.5 text-xs font-black text-black transition-transform hover:-translate-y-0.5 active:scale-95">
              <Download className="h-3.5 w-3.5" /> Install app
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
