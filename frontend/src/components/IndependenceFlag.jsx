import { TRICOLOR } from "@/lib/festive";

// A 24-spoke Ashoka Chakra (navy) — generic national symbol, no people/names.
const Chakra = ({ size = 34 }) => {
  const spokes = Array.from({ length: 24 });
  const c = size / 2;
  const r = size / 2 - 1.5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="none" stroke={TRICOLOR.chakra} strokeWidth={size * 0.055} />
      <circle cx={c} cy={c} r={size * 0.06} fill={TRICOLOR.chakra} />
      {spokes.map((_, i) => {
        const a = (i * 15 * Math.PI) / 180;
        return (
          <line
            key={i}
            x1={c}
            y1={c}
            x2={c + r * 0.86 * Math.cos(a)}
            y2={c + r * 0.86 * Math.sin(a)}
            stroke={TRICOLOR.chakra}
            strokeWidth={size * 0.028}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
};

// The tricolor flag on a gold pole with a continuous, wind-like cloth flutter
// (CSS: .id-flag-cloth). The chakra sits static on the white band, as on the
// real flag. No spinning of the flag itself.
export const IndependenceFlag = ({ w = 108, h = 72 }) => {
  const band = h / 3;
  return (
    <div className="relative flex items-stretch" style={{ height: h + 8 }} data-testid="id-flag">
      {/* Pole */}
      <span className="mr-1 w-[3px] shrink-0 rounded-full bg-gradient-to-b from-amber-300 via-amber-400 to-amber-600 shadow-[0_0_10px_rgba(212,175,55,0.5)]" />
      {/* Cloth */}
      <div
        className="id-flag-cloth relative overflow-hidden rounded-r-md shadow-[0_10px_30px_rgba(0,0,0,0.35)] ring-1 ring-black/10"
        style={{
          width: w,
          height: h,
          background: `linear-gradient(180deg, ${TRICOLOR.saffron} 0 ${band}px, ${TRICOLOR.white} ${band}px ${band * 2}px, ${TRICOLOR.green} ${band * 2}px ${h}px)`,
        }}
      >
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Chakra size={band * 0.92} />
        </span>
      </div>
    </div>
  );
};
