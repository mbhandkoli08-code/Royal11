// TEMPORARY comparison page (/court-compare) — current vs rembg-corrected J/Q/K
// samples. Removed after approval; live deck untouched.
const SUIT = { s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" };
const RED = { h: "#c8102e", d: "#c8102e" };
const CARDS = [
  { code: "Jc", rank: "J", suit: "c", orig: "/assets/royal11/cards/Jc.png", clean: "/assets/royal11/cards/clean/Jc.png" },
  { code: "Qh", rank: "Q", suit: "h", orig: "/assets/royal11/cards/Qh.png", clean: "/assets/royal11/cards/clean/Qh.png" },
  { code: "Kd", rank: "K", suit: "d", orig: "/assets/royal11/cards/Kd.png", clean: "/assets/royal11/cards/clean/Kd.png" },
];

function CourtCard({ c, src, w, h }) {
  const rad = Math.max(5, Math.round(w * 0.09));
  const color = RED[c.suit] || "#15151c";
  return (
    <span style={{ position: "relative", width: w, height: h, borderRadius: rad, background: "#fdfbf4",
      boxShadow: "0 2px 6px rgba(0,0,0,0.35)", border: "1px solid rgba(0,0,0,0.18)", overflow: "hidden", display: "inline-block" }}>
      <img src={src} alt={c.code} draggable="false"
        style={{ position: "absolute", top: "20%", left: "6%", right: "6%", bottom: "4%", width: "auto", height: "auto",
          objectFit: "cover", objectPosition: "center top", borderRadius: 6, zIndex: 1 }} />
      <span style={{ position: "absolute", inset: Math.max(2, Math.round(w * 0.05)), border: "1px solid rgba(201,154,46,0.34)", borderRadius: Math.max(3, rad - 3), zIndex: 2, pointerEvents: "none" }} />
      <span style={{ position: "absolute", top: Math.round(h * 0.045), left: Math.round(w * 0.08), zIndex: 3, display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 0.8, color, fontWeight: 900 }}>
        <b style={{ fontSize: Math.round(w * 0.22) }}>{c.rank}</b>
        <span style={{ fontSize: Math.round(w * 0.17) }}>{SUIT[c.suit]}</span>
      </span>
    </span>
  );
}

const sub = { fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", marginTop: 20, marginBottom: 8 };

export default function CourtCompare() {
  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(120% 90% at 50% 0%, #3a0d14, #1a0508 60%, #0b0405)", color: "#fff", padding: 24, fontFamily: "Outfit, system-ui, sans-serif" }} data-testid="court-compare">
      <h1 style={{ fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#e9c667", fontSize: 20 }}>J/Q/K Background Cleanup — Current vs Corrected</h1>
      {CARDS.map((c) => (
        <div key={c.code} style={{ display: "flex", gap: 28, alignItems: "flex-end", marginTop: 18 }}>
          <div style={{ textAlign: "center" }}>
            <CourtCard c={c} src={c.orig} w={150} h={214} />
            <div style={{ marginTop: 6, fontSize: 11, color: "rgba(255,150,150,0.75)" }}>Current {c.rank}{SUIT[c.suit]}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <CourtCard c={c} src={c.clean} w={150} h={214} />
            <div style={{ marginTop: 6, fontSize: 11, color: "rgba(150,255,180,0.8)" }}>Corrected {c.rank}{SUIT[c.suit]}</div>
          </div>
        </div>
      ))}
      <p style={sub}>Corrected at actual 844×390 mobile-hand size (38×54)</p>
      <div style={{ display: "flex", alignItems: "center", background: "linear-gradient(180deg,#7a1420,#3c070d)", padding: "10px 12px", borderRadius: 14, width: "fit-content" }}>
        {CARDS.map((c, i) => (
          <span key={c.code} style={{ marginLeft: i === 0 ? 0 : -7 }}><CourtCard c={c} src={c.clean} w={38} h={54} /></span>
        ))}
      </div>
    </div>
  );
}
