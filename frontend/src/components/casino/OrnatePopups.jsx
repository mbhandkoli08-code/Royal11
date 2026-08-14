import { X, Trophy, Coins, AlertTriangle } from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import "../../pages/casino-vegas.css";

// Shared ornate gold/red palace popup shell.
export function OrnateModal({ title, onClose, children, testid }) {
  return (
    <div className="ornate-backdrop" data-testid={testid} onClick={onClose}>
      <div className="ornate-modal" onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button onClick={onClose} data-testid="ornate-close"
            className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/30 text-amber-200/90 hover:bg-black/50">
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="ornate-header">{title}</div>
        <div className="relative p-5 text-white">{children}</div>
      </div>
    </div>
  );
}

// Win / bonus celebration with a coin burst.
export function WinCelebration({ amount, title = "CONGRATS!", subtitle, onClose }) {
  const dots = Array.from({ length: 16 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 16 + Math.random() * 0.3;
    const d = 60 + Math.random() * 90;
    return { id: i, cx: `${Math.cos(a) * d}px`, cy: `${Math.sin(a) * d}px`, delay: `${Math.random() * 0.15}s` };
  });
  return (
    <OrnateModal title={title} onClose={onClose} testid="win-celebration">
      <span className="coin-burst">
        {dots.map((d) => <span key={d.id} className="coin-dot" style={{ "--cx": d.cx, "--cy": d.cy, animationDelay: d.delay }} />)}
      </span>
      <div className="relative flex flex-col items-center py-2 text-center">
        <Trophy className="h-10 w-10 text-amber-300" />
        <p className="mt-2 text-sm text-amber-100/80">You won</p>
        <p className="font-display text-5xl font-black text-amber-300 drop-shadow">{amount?.toLocaleString("en-IN")}</p>
        <p className="text-xs font-semibold text-amber-100/70">coins</p>
        {subtitle && <p className="mt-2 text-xs text-white/70">{subtitle}</p>}
        <button onClick={onClose} data-testid="win-okay" className="ornate-gold-btn mt-5 px-8 py-2.5 text-sm">Okay</button>
      </div>
    </OrnateModal>
  );
}

// Round-end scoreboard (built from the settled players list).
export function Scoreboard({ players = [], onClose }) {
  return (
    <OrnateModal title="ROUND RESULT" onClose={onClose} testid="scoreboard-popup">
      <div className="space-y-2">
        {players.map((p) => {
          const won = (p.delta ?? 0) > 0;
          const drop = p.status === "dropped";
          return (
            <div key={p.user_id} data-testid={`score-row-${p.user_id}`} className="flex items-center gap-3 rounded-xl bg-black/25 px-3 py-2 ring-1 ring-amber-300/20">
              <PlayerAvatar seed={p.user_id} name={p.display_name} size={30} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{p.display_name}{p.is_you ? " (You)" : ""}</p>
                <p className="text-[11px] text-amber-100/60">{drop ? "Dropped" : won ? "Won" : "Lost"} · {p.points ?? 0} pts</p>
              </div>
              {p.delta != null && (
                <span className={`text-sm font-black ${won ? "text-emerald-300" : "text-rose-300"}`}>{won ? "+" : ""}{p.delta}</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[11px] text-amber-100/60">Next game starts shortly…</p>
      <button onClick={onClose} data-testid="scoreboard-okay" className="ornate-gold-btn mt-4 w-full py-2.5 text-sm">Continue</button>
    </OrnateModal>
  );
}

// Low-balance nudge.
export function LowChipsPopup({ needed, have, onGetChips, onClose }) {
  return (
    <OrnateModal title="NOT ENOUGH CHIPS" onClose={onClose} testid="low-chips-popup">
      <div className="flex flex-col items-center py-1 text-center">
        <AlertTriangle className="h-9 w-9 text-amber-300" />
        <div className="mt-3 grid w-full grid-cols-2 gap-3">
          <div className="rounded-xl bg-black/25 p-3 ring-1 ring-amber-300/20">
            <p className="text-[10px] uppercase tracking-wider text-amber-100/60">Minimum needed</p>
            <p className="font-display text-xl font-black text-amber-300">{needed?.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl bg-black/25 p-3 ring-1 ring-amber-300/20">
            <p className="text-[10px] uppercase tracking-wider text-amber-100/60">You have</p>
            <p className="font-display text-xl font-black text-white">{have?.toLocaleString("en-IN")}</p>
          </div>
        </div>
        <button onClick={onGetChips} data-testid="get-chips-btn" className="ornate-gold-btn mt-5 flex items-center gap-2 px-8 py-2.5 text-sm">
          <Coins className="h-4 w-4" /> Get Chips
        </button>
      </div>
    </OrnateModal>
  );
}
