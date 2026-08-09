import { createContext, useContext, useMemo, useState } from "react";
import { INITIAL_TXNS } from "@/lib/data";

const WalletContext = createContext(null);

export const WalletProvider = ({ children }) => {
  const [balance, setBalance] = useState(12480);
  const [todayEarned, setTodayEarned] = useState(320);
  const [streakClaimed, setStreakClaimed] = useState(false);
  const [rewardsClaimed, setRewardsClaimed] = useState(6);
  const [txns, setTxns] = useState(INITIAL_TXNS);
  const [ownedItems, setOwnedItems] = useState([]);
  const [equippedAvatarId, setEquippedAvatarId] = useState(null);
  const [boostUntil, setBoostUntil] = useState(null);

  const activateBoost = (seconds) =>
    setBoostUntil((prev) => (prev && Date.now() < prev ? prev : Date.now()) + seconds * 1000);

  const credit = (amount, label, meta, icon) => {
    const mult = boostUntil && Date.now() < boostUntil ? 2 : 1;
    const amt = amount * mult;
    setBalance((b) => b + amt);
    setTodayEarned((t) => t + amt);
    setTxns((list) => [
      { id: Date.now(), label: mult > 1 ? `${label} (2x boost)` : label, meta, type: "credit", amount: amt, when: "Just now", icon },
      ...list,
    ]);
    return amt;
  };

  const claimStreak = () => {
    if (streakClaimed) return;
    setStreakClaimed(true);
    setRewardsClaimed((r) => r + 1);
    credit(50, "Daily Streak Claimed", "Day 5 reward", "Flame");
  };

  const earnCoins = () => credit(100, "Earned Coins", "Watch & play bonus", "Sparkles");
  const debit = (amount, label, meta, icon) => {
    setBalance((b) => b - amount);
    setTxns((list) => [
      { id: Date.now(), label, meta, type: "debit", amount, when: "Just now", icon },
      ...list,
    ]);
  };

  const joinContest = (fee) => {
    if (balance < fee) return false;
    debit(fee, "Joined Fantasy Contest", "Lineup locked", "Users");
    return true;
  };

  const spend = (amount, label, meta, icon) => {
    if (balance < amount) return false;
    debit(amount, label, meta, icon);
    return true;
  };

  const extendBoost = (seconds, cost) => {
    if (!boostUntil || Date.now() >= boostUntil) return "inactive";
    if (balance < cost) return "insufficient";
    setBoostUntil((prev) => (prev && Date.now() < prev ? prev : Date.now()) + seconds * 1000);
    debit(cost, "Extended 2x Boost", `+${seconds}s`, "Zap");
    return "success";
  };

  const buyItem = (item) => {
    if (ownedItems.includes(item.id)) return "owned";
    if (balance < item.price) return "insufficient";
    setOwnedItems((o) => [...o, item.id]);
    if (item.type === "avatar") setEquippedAvatarId(item.id);
    if (item.boostSeconds) activateBoost(item.boostSeconds);
    setRewardsClaimed((r) => r + 1);
    debit(item.price, `Redeemed ${item.name}`, item.type, "Gift");
    return "success";
  };

  const equipAvatar = (id) => setEquippedAvatarId(id);

  const value = useMemo(
    () => ({ balance, todayEarned, streakClaimed, rewardsClaimed, txns, ownedItems, equippedAvatarId, boostUntil, claimStreak, earnCoins, joinContest, buyItem, equipAvatar, spend, credit, extendBoost }),
    [balance, todayEarned, streakClaimed, rewardsClaimed, txns, ownedItems, equippedAvatarId, boostUntil]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
};
