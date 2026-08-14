import "../pages/casino-vegas.css";

const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RED = new Set(["h", "d"]);

// px sizing per size key: [width, height, centerFontRem, pipFontRem]
const SIZES = {
  xs: [30, 42, 1.1, 0.62],
  sm: [38, 54, 1.5, 0.72],
  md: [46, 66, 1.9, 0.82],
  lg: [64, 92, 2.6, 1.0],
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
 * Realistic playing card — glossy face with corner pips + center art, a branded
 * ROYAL11 card back for face-down cards, and a joker treatment. Original art
 * (no real-world card-brand logos). Used across Rummy + High Card.
 */
export function PlayingCard({ card, code, faceDown, size = "sm", selected, onClick, plain }) {
  const [w, h, cf, pf] = SIZES[size] || SIZES.sm;
  const dim = { width: w, height: h };

  if (faceDown) {
    return (
      <span className="pc pc-back" style={dim} data-testid="playing-card-back">
        <span className="pc-back-mono" style={{ fontSize: cf * 0.5 + "rem" }}>R11</span>
      </span>
    );
  }

  const c = parse(card ?? code);
  if (!c) return <span className="pc-empty" style={dim} />;

  let inner;
  if (c.joker) {
    inner = (
      <span className="pc" style={dim} data-testid="playing-card">
        <span className="pc-pip pc-pip-tl pc-red" style={{ fontSize: pf + "rem" }}>J<span style={{ fontSize: pf * 0.7 + "rem" }}>★</span></span>
        <span className="pc-center pc-red" style={{ fontSize: cf + "rem" }}>★</span>
        <span className="pc-pip pc-pip-br pc-red" style={{ fontSize: pf + "rem" }}>J<span style={{ fontSize: pf * 0.7 + "rem" }}>★</span></span>
      </span>
    );
  } else {
    const colorCls = RED.has(c.suit) ? "pc-red" : "pc-black";
    const isFace = ["J", "Q", "K"].includes(c.rank);
    inner = (
      <span className={`pc ${colorCls}`} style={dim} data-testid="playing-card">
        <span className="pc-pip pc-pip-tl" style={{ fontSize: pf + "rem" }}>
          <span>{rankLabel(c.rank)}</span>
          <span style={{ fontSize: pf * 0.86 + "rem" }}>{SUIT[c.suit]}</span>
        </span>
        <span className="pc-center">
          {isFace ? (
            <span className="pc-face-badge" style={{ width: w * 0.52, height: w * 0.52, fontSize: cf * 0.7 + "rem" }}>
              <span className={colorCls}>{c.rank}</span>
            </span>
          ) : (
            <span style={{ fontSize: cf + "rem" }}>{SUIT[c.suit]}</span>
          )}
        </span>
        <span className="pc-pip pc-pip-br" style={{ fontSize: pf + "rem" }}>
          <span>{rankLabel(c.rank)}</span>
          <span style={{ fontSize: pf * 0.86 + "rem" }}>{SUIT[c.suit]}</span>
        </span>
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
