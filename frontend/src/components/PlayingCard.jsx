import "../pages/casino-vegas.css";
import { ROYAL_JOKER_CARD, CARD_BACK_V2 } from "@/lib/casinoAssets";

const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RED = new Set(["h", "d"]);

// px sizing per size key: [width, height, cornerFontRem]
const SIZES = {
  xs: [30, 42, 0.6],
  sm: [38, 54, 0.7],
  md: [46, 66, 0.82],
  lg: [64, 92, 1.02],
};

const rankLabel = (r) => (r === "T" ? "10" : r);

// Authentic traditional pip layouts. Each pip = [xFrac, yFrac, flip].
// Columns: L=0.30, C=0.50, R=0.70 (of the card width). Pips in the lower
// half are rotated 180deg exactly like a real deck.
const L = 0.3, C = 0.5, R = 0.7;
const PIP_LAYOUT = {
  A: [[C, 0.5, false]],
  2: [[C, 0.2, false], [C, 0.8, true]],
  3: [[C, 0.2, false], [C, 0.5, false], [C, 0.8, true]],
  4: [[L, 0.2, false], [R, 0.2, false], [L, 0.8, true], [R, 0.8, true]],
  5: [[L, 0.2, false], [R, 0.2, false], [C, 0.5, false], [L, 0.8, true], [R, 0.8, true]],
  6: [[L, 0.2, false], [R, 0.2, false], [L, 0.5, false], [R, 0.5, false], [L, 0.8, true], [R, 0.8, true]],
  7: [[L, 0.2, false], [R, 0.2, false], [C, 0.35, false], [L, 0.5, false], [R, 0.5, false], [L, 0.8, true], [R, 0.8, true]],
  8: [[L, 0.2, false], [R, 0.2, false], [C, 0.35, false], [L, 0.5, false], [R, 0.5, false], [C, 0.65, true], [L, 0.8, true], [R, 0.8, true]],
  9: [[L, 0.16, false], [R, 0.16, false], [L, 0.38, false], [R, 0.38, false], [C, 0.5, false], [L, 0.62, true], [R, 0.62, true], [L, 0.84, true], [R, 0.84, true]],
  T: [[L, 0.16, false], [R, 0.16, false], [C, 0.3, false], [L, 0.38, false], [R, 0.38, false], [L, 0.62, true], [R, 0.62, true], [C, 0.7, true], [L, 0.84, true], [R, 0.84, true]],
};

// Small crown/court ornament per court rank (deterministic — no AI images).
const COURT_ORNAMENT = { J: "♟", Q: "♛", K: "♚" };

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

function CornerPip({ rank, suit, cf }) {
  return (
    <>
      <span style={{ fontSize: cf + "rem", lineHeight: 0.86, fontWeight: 900 }}>{rankLabel(rank)}</span>
      <span style={{ fontSize: cf * 0.88 + "rem", lineHeight: 0.86 }}>{SUIT[suit]}</span>
    </>
  );
}

/**
 * Realistic premium playing card — glossy ivory face with authentic traditional
 * pip layouts (2–10), ornate Aces, and gold court treatments for J/Q/K, plus the
 * photoreal ROYAL11 V2 back and unified Joker art. Original art only (no
 * real-world card-brand logos). Used across Rummy + High Card.
 */
export function PlayingCard({ card, code, faceDown, size = "sm", selected, onClick, plain, rich }) {
  const [w, h, cf] = SIZES[size] || SIZES.sm;
  const dim = { width: w, height: h };
  const richCls = rich ? " pc-rich" : "";

  if (faceDown) {
    return (
      <span className="pc pc-back" style={dim} data-testid="playing-card-back">
        <img src={CARD_BACK_V2} alt="" draggable="false"
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8, display: "block" }} />
      </span>
    );
  }

  const c = parse(card ?? code);
  if (!c) return <span className="pc-empty" style={dim} />;

  let inner;
  if (c.joker) {
    inner = (
      <span className="pc pc-joker" style={dim} data-testid="playing-card">
        <img src={ROYAL_JOKER_CARD} alt="Joker" draggable="false"
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8, display: "block" }} />
      </span>
    );
  } else {
    const colorCls = RED.has(c.suit) ? "pc-red" : "pc-black";
    const isCourt = ["J", "Q", "K"].includes(c.rank);
    const suitSym = SUIT[c.suit];
    const pipFont = cf * 1.02; // center pip size relative to corner
    const layout = PIP_LAYOUT[c.rank];

    inner = (
      <span className={`pc pc-face ${colorCls}${richCls}`} style={dim} data-testid="playing-card">
        <span className="pc-pip pc-pip-tl"><CornerPip rank={c.rank} suit={c.suit} cf={cf} /></span>
        <span className="pc-pip pc-pip-br"><CornerPip rank={c.rank} suit={c.suit} cf={cf} /></span>

        {isCourt ? (
          <span className="pc-court" style={{ inset: Math.max(4, w * 0.14) }}>
            <span className="pc-court-orn" style={{ fontSize: w * 0.26 + "px" }}>{COURT_ORNAMENT[c.rank]}</span>
            <span className="pc-court-rank" style={{ fontSize: w * 0.42 + "px" }}>{c.rank}</span>
            <span className="pc-court-suit" style={{ fontSize: w * 0.24 + "px" }}>{suitSym}</span>
          </span>
        ) : c.rank === "A" ? (
          <span className="pc-center">
            <span className="pc-ace" style={{ fontSize: w * 0.5 + "px" }}>{suitSym}</span>
          </span>
        ) : (
          <span className="pc-pipgrid">
            {layout && layout.map(([x, y, flip], i) => (
              <span key={i} className="pc-pipdot"
                style={{
                  left: x * 100 + "%", top: y * 100 + "%",
                  fontSize: pipFont + "rem",
                  transform: `translate(-50%, -50%)${flip ? " rotate(180deg)" : ""}`,
                }}>{suitSym}</span>
            ))}
          </span>
        )}
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
