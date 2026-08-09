import { createContext, useContext, useMemo, useState } from "react";
import { INITIAL_TXNS } from "@/lib/data";

const WalletContext = createContext(null);

export const WalletProvider = ({ children }) => {
  const [balance, setBalance] = useState(12480);
  const [todayEarned, setTodayEarned] = useState(320);
  const [streakClaimed, setStreakClaimed] = useState(false);
  const [rewardsClaimed, setRewardsClaimed] = useState(6);
  const [txns, setTxns] = useState(INITIAL_TXNS);

  const credit = (amount, label, meta, icon) => {
    setBalance((b) => b + amount);
    setTodayEarned((t) => t + amount);
    setTxns((list) => [
      { id: Date.now(), label, meta, type: "credit", amount, when: "Just now", icon },
      ...list,
    ]);
  };

  const claimStreak = () => {
    if (streakClaimed) return;
    setStreakClaimed(true);
    setRewardsClaimed((r) => r + 1);
    credit(50, "Daily Streak Claimed", "Day 5 reward", "Flame");
  };

  const earnCoins = () => credit(100, "Earned Coins", "Watch & play bonus", "Sparkles");

  const value = useMemo(
    () => ({ balance, todayEarned, streakClaimed, rewardsClaimed, txns, claimStreak, earnCoins }),
    [balance, todayEarned, streakClaimed, rewardsClaimed, txns]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
};
