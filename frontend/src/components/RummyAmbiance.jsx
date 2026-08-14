// Decorative ambient layer for the Rummy table — an "elegant Vegas lounge at
// night" mood built purely from CSS/SVG: a low-opacity skyline silhouette,
// slow-drifting light glow, soft light rays and gently floating specks.
// No figures, no mascots. Colour follows the active theme via --r-gold, so it
// adapts to charcoal / red-felt / green-felt automatically. pointer-events:none
// throughout so it never blocks gameplay, and it sits behind content (z-0).

// x, width, height (baseline y=180). Varied heights evoke a lounge skyline.
const BUILDINGS = [
  [0, 58, 84], [62, 40, 132], [106, 46, 66], [156, 34, 116], [194, 68, 48],
  [266, 42, 150], [312, 30, 96], [346, 54, 124], [404, 40, 76], [448, 62, 144],
  [514, 34, 104], [552, 46, 178], [602, 40, 86], [646, 58, 132], [708, 36, 66],
  [748, 48, 116], [800, 44, 162], [848, 30, 92], [882, 56, 128], [942, 40, 58],
  [986, 50, 144], [1040, 36, 98], [1080, 62, 170], [1146, 40, 78], [1190, 48, 124],
  [1242, 34, 104], [1280, 58, 150], [1342, 40, 68], [1386, 54, 120],
];

// Sparse "lit windows" — [x, y, r, twinkle?]
const WINDOWS = [
  [70, 70, 2, true], [72, 88, 2, false], [560, 40, 2, true], [558, 58, 2, false],
  [1090, 40, 2, true], [1092, 60, 2, false], [458, 60, 2, false], [810, 55, 2, true],
  [990, 60, 2, false], [356, 55, 2, true], [656, 70, 2, false], [1288, 60, 2, false],
];

const PARTICLES = [
  { left: "8%", size: 4, delay: 0, dur: 14 },
  { left: "18%", size: 3, delay: 4, dur: 17 },
  { left: "27%", size: 5, delay: 8, dur: 15 },
  { left: "39%", size: 3, delay: 2, dur: 19 },
  { left: "48%", size: 4, delay: 6, dur: 16 },
  { left: "57%", size: 3, delay: 10, dur: 18 },
  { left: "66%", size: 5, delay: 1, dur: 15 },
  { left: "74%", size: 3, delay: 7, dur: 20 },
  { left: "83%", size: 4, delay: 3, dur: 17 },
  { left: "92%", size: 3, delay: 9, dur: 16 },
];

export const RummyAmbiance = () => {
  return (
    <div
      className="r-ambiance pointer-events-none absolute inset-0 z-0 overflow-hidden"
      aria-hidden="true"
      data-testid="rummy-ambiance"
    >
      {/* Slow-drifting soft glow pools */}
      <div
        className="absolute -left-24 top-8 h-72 w-72 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, var(--r-gold) 0%, transparent 70%)", opacity: 0.12, animation: "r-drift 22s ease-in-out infinite" }}
      />
      <div
        className="absolute -right-20 top-24 h-80 w-80 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, var(--r-gold) 0%, transparent 70%)", opacity: 0.1, animation: "r-drift 28s ease-in-out infinite reverse" }}
      />

      {/* Slow light rays sweeping from top */}
      <div
        className="absolute -top-40 left-1/2 h-[130%] w-[70%] -translate-x-1/2"
        style={{
          background: "conic-gradient(from 200deg at 50% 0%, transparent 0deg, var(--r-gold) 12deg, transparent 26deg, transparent 60deg, var(--r-gold) 74deg, transparent 90deg)",
          opacity: 0.06,
          filter: "blur(8px)",
          animation: "r-rays 26s ease-in-out infinite",
        }}
      />

      {/* Floating specks */}
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute bottom-24 rounded-full"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            background: "var(--r-gold)",
            boxShadow: "0 0 8px var(--r-gold)",
            opacity: 0,
            animation: `r-float ${p.dur}s ease-in-out ${p.delay}s infinite`,
          }}
        />
      ))}

      {/* Skyline silhouette anchored to the bottom */}
      <svg
        className="absolute bottom-0 left-0 w-full"
        style={{ height: "34vh", maxHeight: 260 }}
        viewBox="0 0 1440 180"
        preserveAspectRatio="none"
      >
        <g fill="rgba(0,0,0,0.42)">
          {BUILDINGS.map(([x, w, h], i) => (
            <rect key={i} x={x} y={180 - h} width={w} height={h} rx="1.5" />
          ))}
        </g>
        <g fill="var(--r-gold)">
          {WINDOWS.map(([x, y, r, tw], i) => (
            <circle
              key={i}
              cx={x}
              cy={180 - y}
              r={r}
              opacity={tw ? undefined : 0.4}
              style={tw ? { animation: `r-twinkle ${4 + (i % 4)}s ease-in-out ${i * 0.6}s infinite` } : undefined}
            />
          ))}
        </g>
      </svg>

      {/* Bottom vignette so the skyline melts into the felt */}
      <div
        className="absolute inset-x-0 bottom-0 h-40"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.35), transparent)" }}
      />
    </div>
  );
};
