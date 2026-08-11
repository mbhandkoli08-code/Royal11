import { createContext, useContext, useMemo, useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const WalletContext = createContext(null);

// Backend TxnType -> UI presentation (label + icon key understood by WalletPage).
const TXN_META = {
  WELCOME_BONUS: { label: "Welcome Bonus", icon: "Gift" },
  DAILY_BONUS: { label: "Daily Bonus", icon: "Flame" },
  ACHIEVEMENT: { label: "Achievement Reward", icon: "Trophy" },
  GAME_ENTRY: { label: "Game Entry", icon: "Dice5" },
  GAME_REWARD: { label: "Game Reward", icon: "Dice5" },
  FANTASY_ENTRY: { label: "Fantasy Contest Entry", icon: "Users" },
  FANTASY_REWARD: { label: "Fantasy Reward", icon: "Users" },
  ADMIN_GRANT: { label: "Coins Granted", icon: "Sparkles" },
  DEPOSIT_TOPUP: { label: "Coin Top-Up", icon: "Gift" },
  REFERRAL_BONUS: { label: "Referral Bonus", icon: "Users" },
  MANAGER_TO_ADMIN: { label: "Allocation", icon: "Sparkles" },
  SUPER_ADMIN_TO_MANAGER: { label: "Allocation", icon: "Sparkles" },
  REVERSAL: { label: "Reversal", icon: "Sparkles" },
};

const relativeTime = (iso) => {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d}d ago`;
};

const mapTxn = (t) => {
  const meta = TXN_META[t.type] || { label: "Transaction", icon: "Sparkles" };
  const isCredit = t.amount >= 0;
  return {
    id: t.id,
    label: t.reason || meta.label,
    meta: meta.label,
    type: isCredit ? "credit" : "debit",
    amount: Math.abs(t.amount),
    when: relativeTime(t.created_at),
    icon: meta.icon,
    _createdAt: t.created_at,
  };
};

export const WalletProvider = ({ children }) => {
  const { token, isAuthenticated } = useAuth();
  const [balance, setBalance] = useState(0);
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await axios.get(`${API}/wallet/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBalance(data.wallet.balance);
      setTxns((data.transactions || []).map(mapTxn));
    } catch {
      // Silent — an invalid token is handled by AuthContext bootstrap/logout.
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    } else {
      setBalance(0);
      setTxns([]);
      setLoading(false);
    }
  }, [isAuthenticated, refresh]);

  // Server-derived stats (never locally computed money).
  const todayEarned = useMemo(() => {
    const today = new Date().toDateString();
    return txns
      .filter((t) => t.type === "credit" && new Date(t._createdAt).toDateString() === today)
      .reduce((sum, t) => sum + t.amount, 0);
  }, [txns]);

  const rewardsClaimed = useMemo(() => txns.filter((t) => t.type === "credit").length, [txns]);

  // --- Actions without a backend ledger endpoint yet ---
  // Per product decision, these are disabled (no fake balance updates that would
  // silently revert on refresh). They surface a "Coming soon" notice instead and
  // will be wired to real ledger endpoints in a later pass.
  const comingSoon = () =>
    toast("Coming soon", { description: "This will connect to your live wallet in an upcoming update." });

  const earnCoins = () => {
    comingSoon();
    return 0;
  };
  const claimStreak = () => comingSoon();
  const joinContest = () => {
    comingSoon();
    return false;
  };
  const buyItem = () => {
    comingSoon();
    return "coming_soon";
  };
  const spend = () => {
    comingSoon();
    return false;
  };
  const credit = () => 0;
  const extendBoost = () => {
    comingSoon();
    return "coming_soon";
  };
  const equipAvatar = () => {};

  const value = useMemo(
    () => ({
      balance,
      todayEarned,
      rewardsClaimed,
      txns,
      loading,
      refresh,
      // Static UI states (no balance impact) — features pending real endpoints.
      streakClaimed: false,
      ownedItems: [],
      equippedAvatarId: null,
      boostUntil: null,
      // Disabled mock actions.
      claimStreak,
      earnCoins,
      joinContest,
      buyItem,
      equipAvatar,
      spend,
      credit,
      extendBoost,
    }),
    [balance, todayEarned, rewardsClaimed, txns, loading, refresh]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
};
