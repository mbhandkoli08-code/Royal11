import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Gift, Check } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const SEEN_KEY = "royal11_seen_notifs";

const loadSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
  catch { return new Set(); }
};
const saveSeen = (set) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-200))); } catch { /* noop */ }
};

// Home notification bell — live per-user feed. New unread notifications (e.g. a
// referral reward when a referred friend recharges) fire a celebratory toast
// once, and are listed in the dropdown; opening the panel marks them read.
export const NotificationBell = () => {
  const { token } = useAuth();
  const { refresh } = useWallet();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const seenRef = useRef(loadSeen());
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await axios.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${token}` } });
      setItems(data.items || []);
      setUnread(data.unread_count || 0);
      // Toast any newly-arrived unread notification exactly once.
      const fresh = (data.items || []).filter((n) => !n.read && !seenRef.current.has(n.id));
      if (fresh.length) {
        fresh.forEach((n) => {
          seenRef.current.add(n.id);
          if (!firstLoad.current || n.type === "referral_reward") {
            toast.success(n.title, { description: n.body });
          }
        });
        saveSeen(seenRef.current);
        if (fresh.some((n) => n.type === "referral_reward")) refresh && refresh();
      }
      firstLoad.current = false;
    } catch { /* keep last */ }
  }, [token, refresh]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try {
        await axios.post(`${API}/notifications/read`, {}, { headers: { Authorization: `Bearer ${token}` } });
        setUnread(0);
        setItems((xs) => xs.map((n) => ({ ...n, read: true })));
      } catch { /* noop */ }
    }
  };

  return (
    <div className="relative">
      <button
        data-testid="notification-btn"
        onClick={toggle}
        className="relative grid h-11 w-11 place-items-center rounded-2xl bg-white text-slate-600 shadow-soft transition-transform hover:-translate-y-0.5"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span data-testid="notification-badge" className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-flame px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div data-testid="notification-panel" className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="font-display text-sm font-bold text-slate-900">Notifications</p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">You&apos;re all caught up 🎉</p>
              ) : items.map((n, i) => (
                <div key={n.id} data-testid={`notification-item-${i}`} className="flex gap-3 border-b border-slate-50 px-4 py-3 last:border-0">
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${n.type === "referral_reward" ? "bg-emerald-100 text-emerald-600" : "bg-royal-light text-royal"}`}>
                    {n.type === "referral_reward" ? <Gift className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                    <p className="mt-0.5 text-xs leading-snug text-slate-500">{n.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
