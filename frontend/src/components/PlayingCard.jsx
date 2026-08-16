import "../pages/casino-vegas.css";
import { ROYAL_JOKER_CARD_IMG, CARD_BACK_V2, COURT_CARD_SRC } from "@/lib/casinoAssets";

const SUIT = { s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" };
const RED = new Set(["h", "d"]);
const RED_HEX = "#c8102e";
const BLACK_HEX = "#15151c";

// px sizing per size key: [width, height]
const SIZES = { xs: [30, 42], sm: [38, 54], md: [46, 66], lg: [64, 92] };

const rankLabel = (r) => (r === "T" ? "10" : r);

// Symmetric traditional pip layouts. Columns L/C/R; lower-half pips (y>0.5)
// rotate 180° like a real deck. Ace = one centred suit.
const L = 0.3, C = 0.5, R = 0.7;
const PIPS = {
  A: [[C, 0.5]],
  2: [[C, 0.24], [C, 0.76]],
  3: [[C, 0.24], [C, 0.5], [C, 0.76]],
  4: [[L, 0.26], [R, 0.26], [L, 0.74], [R, 0.74]],
  5: [[L, 0.26], [R, 0.26], [C, 0.5], [L, 0.74], [R, 0.74]],
  6: [[L, 0.24], [R, 0.24], [L, 0.5], [R, 0.5], [L, 0.76], [R, 0.76]],
  7: [[L, 0.24], [R, 0.24], [C, 0.37], [L, 0.52], [R, 0.52], [L, 0.78], [R, 0.78]],
  8: [[L, 0.23], [R, 0.23], [C, 0.37], [L, 0.5], [R, 0.5], [C, 0.63], [L, 0.77], [R, 0.77]],
  9: [[L, 0.24], [R, 0.24], [L, 0.42], [R, 0.42], [C, 0.5], [L, 0.58], [R, 0.58], [L, 0.76], [R, 0.76]],
  T: [[L, 0.23], [R, 0.23], [C, 0.335], [L, 0.42], [R, 0.42], [L, 0.58], [R, 0.58], [C, 0.665], [L, 0.77], [R, 0.77]],
};

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
 * Royal 11 playing card — flat ivory, thin antique-gold edge, one soft shadow.
 * A/2–10: traditional symmetric pip field + compact top-left rank/suit (Ace =
 * one centred suit). J/Q/K: approved single-face portrait (cover / center-top,
 * "Variant A") + small top-left index. Joker + card back = approved artwork.
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

  if (c.joker) {
    const inner = (
      <span className="pc pc-joker" style={dim} data-testid="playing-card">
        <img src={ROYAL_JOKER_CARD_IMG} alt="Joker" draggable="false" style={imgStyle} />
      </span>
    );
    return plain || !onClick ? inner : <button type="button" onClick={onClick} className={`pc-btn ${selected ? "pc-sel rounded-[10px]" : ""}`}>{inner}</button>;
  }

  const color = RED.has(c.suit) ? RED_HEX : BLACK_HEX;
  const isCourt = ["J", "Q", "K"].includes(c.rank);
  const suitSym = SUIT[c.suit];
  let inner;

  if (isCourt) {
    inner = (
      <span className={`pc pc-face pc-court-card${richCls}`} style={dim} data-testid="playing-card">
        <img className="pc-court-portrait" src={COURT_CARD_SRC(c.rank, c.suit)}
          alt={`${rankLabel(c.rank)}${suitSym}`} draggable="false" />
        <span className="pc-idx" style={{ top: Math.round(h * 0.045), left: Math.round(w * 0.08), color }}>
          <b style={{ fontSize: Math.round(w * 0.22) }}>{rankLabel(c.rank)}</b>
          <span style={{ fontSize: Math.round(w * 0.17) }}>{suitSym}</span>
        </span>
      </span>
    );
  } else {
    const isAce = c.rank === "A";
    const pips = PIPS[c.rank] || [];
    const pipSize = isAce ? Math.round(w * 0.36) : Math.round(w * 0.17);
    inner = (
      <span className={`pc pc-face${richCls}`} style={dim} data-testid="playing-card">
        <span className="pc-idx" style={{ top: Math.round(h * 0.04), left: Math.round(w * 0.08), color }}>
          <b style={{ fontSize: Math.round(w * 0.18) }}>{rankLabel(c.rank)}</b>
          <span style={{ fontSize: Math.round(w * 0.13) }}>{suitSym}</span>
        </span>
        {pips.map(([x, y], i) => (
          <span key={i} className="pc-pip2" style={{
            left: `${x * 100}%`, top: `${y * 100}%`, color, fontSize: pipSize,
            transform: `translate(-50%,-50%)${!isAce && y > 0.5 ? " rotate(180deg)" : ""}`,
          }}>{suitSym}</span>
        ))}
      </span>
    );
  }

  if (plain || !onClick) return inner;
  return (
    <button type="button" onClick={onClick} className={`pc-btn ${selected ? "pc-sel rounded-[10px]" : ""}`}>
      {inner}
    </button>
  );
}
