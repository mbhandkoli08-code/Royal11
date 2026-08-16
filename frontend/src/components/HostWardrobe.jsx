import { useState } from "react";
import { toast } from "sonner";
import { X, Eye, Check, Sparkles, UserX } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { HOST_OUTFITS, WARDROBE_LS, getSavedOutfit, outfitById } from "@/lib/hostWardrobe";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "indian", label: "Indian" },
  { id: "modern", label: "Modern" },
];

// Lucky 777 "HOST OUTFIT LANDSCAPE" — purely cosmetic host wardrobe. Applying an
// outfit only changes the host artwork on the Slots stage; never touches RNG,
// payouts, ledger or API contracts.
export const HostWardrobe = ({ open, onClose, onApply }) => {
  const { balance } = useWallet();
  const [selectedId, setSelectedId] = useState(getSavedOutfit());
  const [filter, setFilter] = useState("all");
  if (!open) return null;

  const selected = outfitById(selectedId);
  const tiles = HOST_OUTFITS.filter(
    (o) => filter === "all" || o.category === filter || o.id === "none"
  );

  const apply = () => {
    try { localStorage.setItem(WARDROBE_LS, selectedId); } catch { /* ignore */ }
    onApply?.(selectedId);
    toast.success(`${selected.label} applied — free!`, { description: "Cosmetics never affect gameplay." });
    onClose?.();
  };

  return (
    <div data-testid="host-wardrobe" className="fixed inset-0 z-[90] flex flex-col bg-[#0b0405] text-white">
      {/* Header — Lucky 777 pattern */}
      <header className="flex items-center justify-between border-b border-[#e9c667]/20 px-4 py-3 sm:px-6">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-xl font-black tracking-tight">ROYAL<span className="text-[#e9c667]">11</span></span>
          <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/45">Lucky 777</span>
        </div>
        <div className="flex items-center gap-2">
          <span data-testid="wardrobe-coin-balance"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#e9c667]/40 bg-black/50 px-3.5 py-1.5 text-sm font-black text-[#e9c667]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#e9c667]" />{(balance ?? 0).toLocaleString("en-IN")}
          </span>
          <button data-testid="wardrobe-close" onClick={onClose} aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Body — Preview stage (left) + Wardrobe panel (right) */}
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 sm:p-6 md:grid-cols-[minmax(280px,38%)_1fr]">
        {/* Preview stage */}
        <div className="relative flex flex-col overflow-hidden rounded-3xl border border-[#e9c667]/30 bg-gradient-to-b from-[#3a0d15] to-[#12060a] p-4">
          <div className="absolute inset-x-0 top-0 h-2/3 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(233,102,120,0.35),transparent_70%)]" />
          <p className="relative mb-2 text-[11px] font-bold uppercase tracking-[0.25em] text-white/50">Preview</p>
          <div className="relative flex flex-1 items-end justify-center">
            {selected.img ? (
              <img data-testid="wardrobe-preview-img" src={selected.img} alt={selected.label}
                className="max-h-[46vh] w-auto rounded-2xl object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)]" />
            ) : (
              <div className="grid h-[40vh] w-full place-items-center rounded-2xl border border-dashed border-white/15 text-white/40">
                <div className="text-center"><UserX className="mx-auto mb-2 h-10 w-10" /><p className="text-sm font-semibold">No Host</p></div>
              </div>
            )}
          </div>
          {/* Host Info */}
          <div className="relative mt-3 rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40">Host Name</p>
                <p className="font-display text-base font-black text-[#e9c667]">Zoya</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Selected Outfit</p>
                <p data-testid="wardrobe-selected-label" className="text-sm font-bold">{selected.label}</p>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-white/35">Cosmetic only · outfit never affects spins, odds or payouts.</p>
          </div>
        </div>

        {/* Wardrobe panel */}
        <div className="flex flex-col rounded-3xl border border-[#e9c667]/30 bg-black/40 p-4 sm:p-5">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#e9c667]" />
            <h2 className="font-display text-lg font-black">Host Wardrobe</h2>
          </div>
          <p className="mb-3 text-xs text-white/50">Dress your Lucky 777 host — 11 regional & modern looks, all free.</p>

          {/* Filter tabs */}
          <div className="mb-4 inline-flex w-fit rounded-full bg-white/5 p-1" data-testid="wardrobe-filters">
            {FILTERS.map((f) => (
              <button key={f.id} data-testid={`wardrobe-filter-${f.id}`} onClick={() => setFilter(f.id)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${filter === f.id ? "bg-[#e9c667] text-black" : "text-white/55 hover:text-white"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Outfit grid */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" data-testid="wardrobe-grid">
            {tiles.map((o) => {
              const active = o.id === selectedId;
              return (
                <button key={o.id} data-testid={`wardrobe-tile-${o.id}`} onClick={() => setSelectedId(o.id)}
                  className={`group relative overflow-hidden rounded-2xl border-2 text-left transition-all ${active ? "border-[#e9c667] ring-2 ring-[#e9c667]/40" : "border-white/10 hover:border-white/30"}`}>
                  <div className="aspect-[3/4] w-full bg-[#1a0c10]">
                    {o.img ? (
                      <img src={o.img} alt={o.label} loading="lazy" className="h-full w-full object-cover object-top transition-transform group-hover:scale-105" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-white/40"><UserX className="h-8 w-8" /></div>
                    )}
                  </div>
                  {active && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#e9c667] text-black"><Check className="h-3 w-3" strokeWidth={3} /></span>}
                  <span className="block truncate bg-black/70 px-2 py-1.5 text-center text-[11px] font-bold">{o.label}</span>
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-[11px] text-white/35">All outfits are FREE · Cosmetics never affect gameplay.</p>
          <div className="mt-3 flex gap-2">
            <button data-testid="wardrobe-preview-btn" onClick={() => toast(`Previewing ${selected.label}`)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-white/15 py-3 text-sm font-bold text-white/70 hover:bg-white/5">
              <Eye className="h-4 w-4" /> Preview
            </button>
            <button data-testid="wardrobe-apply-btn" onClick={apply}
              className="flex flex-[1.6] items-center justify-center gap-1.5 rounded-2xl bg-[#e9c667] py-3 text-sm font-black text-black transition-transform hover:-translate-y-0.5 active:scale-95">
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
