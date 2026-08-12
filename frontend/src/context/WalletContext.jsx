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
  FANTASY_ENTRY: { label: "Fantasy Contest Entry", icon: "Users" },
  FANTASY_REWARD: { label: "Fantasy Reward", icon: "Users" },
  ADMIN_GRANT: { label: "Coins Granted", icon: "Sparkles" },
  DEPOSIT_TOPUP: { label: "Coin Top-Up", icon: "Gift" },
  REFERRAL_BONUS: { label: "Referral Bonus", icon: "Users" },
  MANAGER_TO_ADMIN: { label: "Allocation", icon: "Sparkles" },
  SUPER_ADMIN_TO_MANAGER: { label: "Allocation", icon: "Sparkles" },
  GAME_ENTRY: { label: "Lucky Spin", icon: "Sparkles" },
  GAME_REWARD: { label: "Spin Reward", icon: "Sparkles" },
  STORE_PURCHASE: { label: "Store Purchase", icon: "Trophy" },
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
  const [inventory, setInventory] = useState({ owned_items: [], equipped_avatar_id: null, boost_until: null });

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [w, inv] = await Promise.all([
        axios.get(`${API}/wallet/me`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/games/inventory`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setBalance(w.data.wallet.balance);
      setTxns((w.data.transactions || []).map(mapTxn));
      setInventory(inv.data);
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
      setInventory({ owned_items: [], equipped_avatar_id: null, boost_until: null });
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

  // --- Real server-authoritative game economy actions ---
  const comingSoon = () =>
    toast("Coming soon", { description: "This will connect to your live wallet in an upcoming update." });

  // Daily-bonus / streak / tap-to-earn remain out of scope for now.
  const earnCoins = () => { comingSoon(); return 0; };
  const claimStreak = () => comingSoon();
  const credit = () => 0;

  const spin = useCallback(async () => {
    try {
      const { data } = await axios.post(`${API}/games/spin`, {}, { headers });
      await refresh();
      return data; // { prize, won, balance }
    } catch (e) {
      toast.error("Couldn't spin", { description: e.response?.data?.detail || "" });
      return null;
    }
  }, [headers, refresh]);

  const buyItem = useCallback(async (item) => {
    try {
      const { data } = await axios.post(`${API}/games/store/buy`, { item_id: item.id }, { headers });
      if (data.inventory) setInventory(data.inventory);
      await refresh();
      toast.success(`${item.name} purchased`, { description: `${item.price?.toLocaleString?.("en-IN") ?? ""} coins spent` });
      return "ok";
    } catch (e) {
      toast.error("Couldn't buy", { description: e.response?.data?.detail || "" });
      return "error";
    }
  }, [headers, refresh]);

  const equipAvatar = useCallback(async (itemId) => {
    try {
      await axios.post(`${API}/games/store/equip`, { item_id: itemId }, { headers });
      setInventory((i) => ({ ...i, equipped_avatar_id: itemId }));
    } catch (e) {
      toast.error("Couldn't equip", { description: e.response?.data?.detail || "" });
    }
  }, [headers]);

  const joinContest = useCallback(async (contestId = "ipl_grand_league") => {
    try {
      await axios.post(`${API}/games/contest/join`, { contest_id: contestId }, { headers });
      await refresh();
      toast.success("Contest joined!", { description: "Entry fee deducted from your wallet." });
      return true;
    } catch (e) {
      toast.error("Couldn't join contest", { description: e.response?.data?.detail || "" });
      return false;
    }
  }, [headers, refresh]);

  // "Extend boost" buys the 60s 2x boost (bo1) — server sets the boost window.
  const extendBoost = useCallback(async () => {
    return buyItem({ id: "bo1", name: "2x Coins Boost", price: 250 });
  }, [buyItem]);

  const value = useMemo(
    () => ({
      balance,
      todayEarned,
      rewardsClaimed,
      txns,
      loading,
      refresh,
      streakClaimed: false,
      ownedItems: inventory.owned_items || [],
      equippedAvatarId: inventory.equipped_avatar_id,
      boostUntil: inventory.boost_until,
      claimStreak,
      earnCoins,
      joinContest,
      buyItem,
      equipAvatar,
      spin,
      credit,
      extendBoost,
    }),
    [balance, todayEarned, rewardsClaimed, txns, loading, refresh, inventory,
     joinContest, buyItem, equipAvatar, spin, extendBoost]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
};
