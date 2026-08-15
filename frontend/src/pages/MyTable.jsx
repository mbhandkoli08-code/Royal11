import { useState } from "react";
import { toast } from "sonner";
import { Layers, Home, Spade, Crown, User, Sparkles, Volume2, Check, Eye } from "lucide-react";
import { DailyBonusWidget } from "@/components/DailyBonusWidget";
import { AAA_ROOM_BG } from "@/lib/casinoAssets";

// "MY TABLE" — free cosmetic customization. IMPORTANT: everything here is
// presentation-only. Selections are saved to localStorage and NEVER sent to the
// game engine / RNG / scoring. All themes are free.
const FELTS = [
  { key: "crimson", label: "Crimson", color: "#6b0f1a", theme: "red_felt" },
  { key: "emerald", label: "Emerald", color: "#0f5132", theme: "green_felt" },
  { key: "midnight", label: "Midnight", color: "#141110", theme: "luxury" },
  { key: "royal_blue", label: "Royal Blue", color: "#12305e", theme: "luxury" },
  { key: "purple", label: "Purple", color: "#3d1a5b", theme: "luxury" },
  { key: "champagne", label: "Champagne", color: "#6b5a2a", theme: "luxury" },
];
const TABS = [
  { key: "table", label: "Table", icon: Layers },
  { key: "room", label: "Room", icon: Home },
  { key: "cards", label: "Cards", icon: Spade },
  { key: "host", label: "Host", icon: Crown },
  { key: "avatar", label: "Avatar", icon: User },
  { key: "effects", label: "Effects", icon: Sparkles },
  { key: "sound", label: "Sound", icon: Volume2 },
];
const OPTIONS = {
  room: ["VIP Night", "Emerald Lounge", "Obsidian Bar", "Golden Hall"],
  cards: ["Royal 11 V2", "Classic Ivory", "Midnight Back"],
  host: ["Royal Host", "No Host", "Golden Dealer"],
  avatar: ["Royal Crest", "Jester", "Monarch", "Minimal"],
  effects: ["Confetti Wins", "Card Glow", "Spotlight", "Off"],
  sound: ["Palace Ambience", "Casino Buzz", "Muted"],
};

const LS = "royal11_cosmetics";
const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };

export default function MyTable() {
  const [tab, setTab] = useState("table");
  const saved = load();
  const [felt, setFelt] = useState(saved.felt || "crimson");
  const [picks, setPicks] = useState(saved.picks || {});
  const feltObj = FELTS.find((f) => f.key === felt) || FELTS[0];
  const pick = (cat, val) => setPicks((p) => ({ ...p, [cat]: val }));

  const apply = () => {
    localStorage.setItem(LS, JSON.stringify({ felt, picks }));
    // Reflect the felt on the actual table via the existing (gameplay-neutral)
    // theme key. Cosmetics never touch the engine.
    localStorage.setItem("royal11_rummy_theme", feltObj.theme);
    toast.success("Theme applied — free!", { description: "Cosmetics never affect gameplay." });
  };

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] text-white" data-testid="my-table-page">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-black text-[var(--r-gold,#c9a227)]">My Table</h1>
            <p className="text-xs text-white/50">ROYAL 11 VIP Casino Room · Night · Warm chandelier ambience</p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_460px]">
          {/* Live preview */}
          <div className="relative overflow-hidden rounded-3xl border border-[var(--r-gold,#c9a227)]/30 bg-cover bg-center p-6"
            style={{ backgroundImage: `url(${AAA_ROOM_BG})` }} data-testid="my-table-preview">
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative mx-auto mt-6 flex aspect-[16/10] max-w-md items-center justify-center rounded-[50%] border-8 border-[#c9a227]/60 shadow-2xl"
              style={{ background: `radial-gradient(circle at 50% 40%, ${feltObj.color}, #000)` }}>
              <div className="text-center">
                <p className="font-display text-3xl font-black text-[var(--r-gold,#c9a227)]/80">R11</p>
                <p className="text-[10px] uppercase tracking-[0.3em] text-white/50">Royal Rummy</p>
              </div>
            </div>
            <p className="relative mt-4 text-center text-[11px] text-white/50">Preview · {feltObj.label} felt</p>
          </div>

          {/* Customize panel */}
          <div className="rounded-3xl border border-[var(--r-gold,#c9a227)]/40 bg-black/50 p-5">
            <p className="font-display text-lg font-black">Customize Your Table</p>
            <p className="mb-3 text-xs text-emerald-300/80">All themes are FREE · Cosmetics never affect gameplay</p>

            <div className="mb-4 flex flex-wrap gap-1.5" data-testid="my-table-tabs">
              {TABS.map((t) => (
                <button key={t.key} data-testid={`mytable-tab-${t.key}`} onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${tab === t.key ? "bg-[var(--r-gold,#c9a227)] text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}>
                  <t.icon className="h-3.5 w-3.5" /> {t.label}
                </button>
              ))}
            </div>

            {tab === "table" ? (
              <>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">Table Felt</p>
                <div className="grid grid-cols-3 gap-2" data-testid="felt-swatches">
                  {FELTS.map((f) => (
                    <button key={f.key} data-testid={`felt-${f.key}`} onClick={() => setFelt(f.key)}
                      className={`relative h-16 rounded-xl border-2 transition-transform hover:scale-[1.03] ${felt === f.key ? "border-[var(--r-gold,#c9a227)]" : "border-white/10"}`}
                      style={{ background: f.color }}>
                      {felt === f.key && <Check className="absolute right-1 top-1 h-4 w-4 text-[var(--r-gold,#c9a227)]" />}
                      <span className="absolute inset-x-0 bottom-1 text-center text-[10px] font-bold text-white/80">{f.label}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5" data-testid="detail-pills">
                  {["Felt: Velvet", "Trim: Antique Gold", "Pattern: Royal", "Card Back: R11 V2", "Room: VIP Night", "Host: Royal"].map((d) => (
                    <span key={d} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/60">{d}</span>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-2" data-testid={`mytable-options-${tab}`}>
                {(OPTIONS[tab] || []).map((opt) => (
                  <button key={opt} data-testid={`option-${tab}-${opt.replace(/\s+/g, "-").toLowerCase()}`} onClick={() => pick(tab, opt)}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors ${(picks[tab] || OPTIONS[tab][0]) === opt ? "border-[var(--r-gold,#c9a227)] bg-[var(--r-gold,#c9a227)]/10 text-white" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"}`}>
                    {opt}
                    {(picks[tab] || OPTIONS[tab][0]) === opt && <Check className="h-4 w-4 text-[var(--r-gold,#c9a227)]" />}
                  </button>
                ))}
                <p className="pt-1 text-[10px] text-white/30">Free cosmetic · does not change cards, odds, dealing, scoring or timer.</p>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button data-testid="mytable-preview-btn" onClick={() => toast("Preview updated")}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-white/15 py-3 text-sm font-bold text-white/70 hover:bg-white/5"><Eye className="h-4 w-4" /> Preview</button>
              <button data-testid="mytable-apply-btn" onClick={apply}
                className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-2xl bg-[var(--r-gold,#c9a227)] py-3 text-sm font-black text-black transition-transform hover:-translate-y-0.5">Apply Free Theme</button>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-4 left-4 z-40 hidden sm:block">
        <DailyBonusWidget />
      </div>
    </div>
  );
}
