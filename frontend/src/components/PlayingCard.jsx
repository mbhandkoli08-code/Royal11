import "../pages/casino-vegas.css";
import { ROYAL_JOKER_CARD_IMG, CARD_BACK_V2, COURT_CARD_SRC } from "@/lib/casinoAssets";

const SUIT = { s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" };
const RED = new Set(["h", "d"]);
const RED_HEX = "#c8102e";
const BLACK_HEX = "#15151c";

// px sizing per size key: [width, height]
const SIZES = {
  xs: [30, 42],
  sm: [38, 54],
  md: [46, 66],
  lg: [64, 92],
};

const rankLabel = (r) => (r === "T" ? "10" : r);

// Normalize a code string ("As", "Th", "JK") or a card object into {rank,suit,joker}.
function parse(card) {
  if (!card) return null;
  if (typeof card === "string") {
    if (card === "JK" || card === "XJ") return { joker: true };
    return { rank: card[0], suit: card[1] };
  }
  if (card.joker) return { joker: true };
  if (card.rank && card.suit) return { rank: card.rank, suit: card.suit };
  if (card.code) return card.code.length === 2 ? { rank: card.code[0], suit: card.code[1] } : { joker: true };
  return null;
}

/**
 * Royal 11 playing card — flat ivory surface, thin antique-gold edge, one soft
 * outer shadow. A/2–10 use ONE bold top-left rank + ONE large central suit (no
 * pips, no mirrored index). J/Q/K use the approved single-face portrait
 * (object-fit: contain) with a compact ivory corner index chip. Joker + card
 * back use the approved artwork. One shared design across desktop + mobile.
 */
export function PlayingCard({ card, code, faceDown, size = "sm", selected, onClick, plain, rich }) {
  const [w, h] = SIZES[size] || SIZES.sm;
  const dim = { width: w, height: h };
  const rad = Math.max(5, Math.round(w * 0.09));
  const richCls = rich ? " pc-rich" : "";
  const imgStyle = { width: "100%", height: "100%", objectFit: "contain", borderRadius: rad, display: "block" };

  if (faceDown) {
    return (
      <span className="pc pc-back" style={dim} data-testid="playing-card-back">
        <img src={CARD_BACK_V2} alt="" draggable="false" style={imgStyle} />
      </span>
    );
  }

  const c = parse(card ?? code);
  if (!c) return <span className="pc-empty" style={dim} />;

  let inner;
  if (c.joker) {
    inner = (
      <span className="pc pc-joker" style={dim} data-testid="playing-card">
        <img src={ROYAL_JOKER_CARD_IMG} alt="Joker" draggable="false" style={imgStyle} />
      </span>
    );
  } else {
    const color = RED.has(c.suit) ? RED_HEX : BLACK_HEX;
    const isCourt = ["J", "Q", "K"].includes(c.rank);
    const suitSym = SUIT[c.suit];

    if (isCourt) {
      // Portrait (contain) + compact ivory corner index chip (thin gold outline).
      inner = (
        <span className={`pc pc-face pc-court-card${richCls}`} style={dim} data-testid="playing-card">
          <img className="pc-court-portrait" src={COURT_CARD_SRC(c.rank, c.suit)}
            alt={`${rankLabel(c.rank)}${suitSym}`} draggable="false"
            style={{ inset: Math.max(3, Math.round(w * 0.06)), borderRadius: Math.max(3, rad - 3) }} />
          <span className="pc-court-chip" style={{
            top: Math.round(h * 0.045), left: Math.round(w * 0.055), color,
            borderRadius: Math.max(3, Math.round(w * 0.11)),
            padding: `${Math.max(1, Math.round(h * 0.015))}px ${Math.max(2, Math.round(w * 0.045))}px`,
          }}>
            <b style={{ fontSize: Math.round(w * 0.28) }}>{rankLabel(c.rank)}</b>
            <span style={{ fontSize: Math.round(w * 0.22) }}>{suitSym}</span>
          </span>
        </span>
      );
    } else {
      // A + 2–10: bold top-left rank + ONE large central suit.
      inner = (
        <span className={`pc pc-face${richCls}`} style={dim} data-testid="playing-card">
          <span className="pc-idx" style={{ top: Math.round(h * 0.05), left: Math.round(w * 0.09), color }}>
            <b style={{ fontSize: Math.round(w * 0.3) }}>{rankLabel(c.rank)}</b>
            <span style={{ fontSize: Math.round(w * 0.24) }}>{suitSym}</span>
          </span>
          <span className="pc-bigsuit" style={{ color, fontSize: Math.round(w * 0.6) }}>{suitSym}</span>
        </span>
      );
    }
  }

  if (plain || !onClick) return inner;
  return (
    <button type="button" onClick={onClick} className={`pc-btn ${selected ? "pc-sel rounded-[10px]" : ""}`}>
      {inner}
    </button>
  );
}
