import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Coins, Check, Crown, Ghost, Smile, Award, Flame, Trophy, Zap, Sparkles, Rocket } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/context/WalletContext";
import { STORE_ITEMS } from "@/lib/data";
import { RewardWheel } from "@/components/RewardWheel";

const ICONS = { Crown, Ghost, Smile, Award, Flame, Trophy, Zap, Sparkles, Rocket };
const CATS = [
  { key: "avatar", label: "Avatars" },
  { key: "badge", label: "Badges" },
  { key: "boost", label: "Boosts" },
];

const fmt = (n) => n.toLocaleString("en-IN");

export const RewardsStore = ({ open, onClose }) => {
  const { balance, ownedItems, buyItem, equippedAvatarId, equipAvatar } = useWallet();
  const [cat, setCat] = useState("avatar");
  const [wheelOpen, setWheelOpen] = useState(false);
  const items = STORE_ITEMS.filter((i) => i.type === cat);

  const buy = (item) => {
    // Disabled until a real ledger endpoint exists — surfaces a "Coming soon" notice.
    buyItem(item);
  };

  const equip = (item) => {
    equipAvatar(item.id);
    toast.success(`${item.name} equipped`, { description: "Now showing on your profile." });
  };

  return (
    <>
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="rewards-store-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-6"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-background sm:rounded-3xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-100 bg-white p-5">
              <div>
                <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900">Rewards Store</h2>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-flame">
                  <Coins className="h-4 w-4" /> {fmt(balance)} coins available
                </p>
              </div>
              <button
                data-testid="rewards-store-close"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-slate-100 bg-white px-5 pb-4">
              {CATS.map((c) => (
                <button
                  key={c.key}
                  data-testid={`store-tab-${c.key}`}
                  onClick={() => setCat(c.key)}
                  className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                    cat === c.key ? "bg-royal text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-3">
              {items.map((item) => {
                const Icon = ICONS[item.icon] || Sparkles;
                const owned = ownedItems.includes(item.id);
                const affordable = balance >= item.price;
                const isAvatar = item.type === "avatar";
                const equipped = isAvatar && equippedAvatarId === item.id;
                let btn;
                if (item.id === "bo3") {
                  btn = { label: <><Sparkles className="h-4 w-4" /> Spin</>, cls: "bg-flame text-white hover:-translate-y-0.5", onClick: () => setWheelOpen(true), disabled: false };
                } else if (equipped) {
                  btn = { label: <><Check className="h-4 w-4" /> Equipped</>, cls: "cursor-default bg-mint-light text-mint", onClick: undefined, disabled: true };
                } else if (owned && isAvatar) {
                  btn = { label: "Equip", cls: "bg-flame text-white hover:-translate-y-0.5", onClick: () => equip(item), disabled: false };
                } else if (owned) {
                  btn = { label: <><Check className="h-4 w-4" /> Owned</>, cls: "cursor-default bg-mint-light text-mint", onClick: undefined, disabled: true };
                } else {
                  btn = {
                    label: <><Coins className="h-4 w-4" /> {fmt(item.price)}</>,
                    cls: affordable ? "bg-royal text-white hover:-translate-y-0.5" : "bg-slate-100 text-slate-400 hover:bg-slate-200",
                    onClick: () => buy(item),
                    disabled: false,
                  };
                }
                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    data-testid={`store-item-${item.id}`}
                    className="flex flex-col rounded-3xl bg-white p-5 shadow-soft"
                  >
                    <span className={`grid h-14 w-14 place-items-center rounded-2xl ${item.tint}`}>
                      <Icon className="h-7 w-7" strokeWidth={2} />
                    </span>
                    <p className="mt-3 text-sm font-bold text-slate-900">{item.name}</p>
                    <p className="mt-0.5 flex-1 text-xs leading-relaxed text-slate-500">{item.desc}</p>
                    <button
                      data-testid={`buy-${item.id}`}
                      onClick={btn.onClick}
                      disabled={btn.disabled}
                      className={`mt-4 flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-bold transition-transform ${btn.cls}`}
                    >
                      {btn.label}
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    <RewardWheel open={wheelOpen} onClose={() => setWheelOpen(false)} />
    </>
  );
};
