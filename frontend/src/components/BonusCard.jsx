import { useEffect, useState } from "react";
import axios from "axios";
import { Lock, Sparkles, Info } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmt = (n) => (n || 0).toLocaleString("en-IN");

// Player-facing bonus wallet: shows the separate, non-withdrawable bonus balance
// and the playthrough (wagering) progress that converts it to real coins.
export const BonusCard = () => {
  const { token } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    axios.get(`${API}/bonus/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => { if (active) setData(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [token]);

  if (!data || (data.bonus_balance === 0 && data.active_grants.length === 0)) return null;

  return (
    <div className="mt-6 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-6 shadow-soft" data-testid="bonus-card">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-display text-lg font-extrabold text-slate-900">
          <Sparkles className="h-5 w-5 text-amber-500" /> Bonus Coins
        </p>
        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700" data-testid="bonus-balance">
          <Lock className="h-3 w-3" /> {fmt(data.bonus_balance)}
        </span>
      </div>

      {data.active_grants.map((g, i) => (
        <div key={i} className="mt-4" data-testid={`bonus-grant-${i}`}>
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Play to unlock</span>
            <span data-testid={`bonus-progress-${i}`}>{g.progress_pct}% · {fmt(g.remaining_to_unlock)} more to wager</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-amber-100">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-600 transition-all"
              style={{ width: `${g.progress_pct}%` }} />
          </div>
        </div>
      ))}

      <p className="mt-4 flex items-start gap-2 text-xs text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Bonus coins are playable right away. As you play with real coins, they convert into withdrawable balance.
      </p>
    </div>
  );
};
