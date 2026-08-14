import { useEffect, useRef } from "react";
import { TRICOLOR } from "@/lib/festive";

const COLORS = [TRICOLOR.saffron, "#ffffff", TRICOLOR.green, "#0A3D91"];

// Lightweight tricolor confetti + occasional firework bursts on a canvas.
// Runs a celebratory burst then eases off so it never distracts. Respects
// prefers-reduced-motion. pointer-events:none.
export const IndependenceConfetti = ({ duration = 6500 }) => {
  const ref = useRef(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const W = () => canvas.width;
    const H = () => canvas.height;

    const confetti = [];
    const sparks = [];
    const spawnConfetti = (n) => {
      for (let i = 0; i < n; i++) {
        confetti.push({
          x: Math.random() * W(),
          y: -20 * dpr - Math.random() * H() * 0.4,
          vx: (Math.random() - 0.5) * 1.2 * dpr,
          vy: (1 + Math.random() * 1.8) * dpr,
          size: (4 + Math.random() * 4) * dpr,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: COLORS[(Math.random() * COLORS.length) | 0],
        });
      }
    };
    const firework = (cx, cy) => {
      const color = COLORS[(Math.random() * COLORS.length) | 0];
      const count = 34;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const sp = (1.5 + Math.random() * 2.4) * dpr;
        sparks.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color });
      }
    };

    spawnConfetti(90);
    let t0 = performance.now();
    let nextFw = 300;

    const tick = (t) => {
      const elapsed = t - t0;
      const active = elapsed < duration;
      ctx.clearRect(0, 0, W(), H());

      if (active && elapsed > nextFw) {
        firework(W() * (0.2 + Math.random() * 0.6), H() * (0.15 + Math.random() * 0.35));
        nextFw = elapsed + 900 + Math.random() * 700;
      }
      if (active && elapsed < duration - 2500 && Math.random() < 0.35) spawnConfetti(2);

      for (let i = confetti.length - 1; i >= 0; i--) {
        const p = confetti[i];
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.015 * dpr;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.globalAlpha = 0.9;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
        if (p.y > H() + 20 * dpr) confetti.splice(i, 1);
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx; s.y += s.vy; s.vy += 0.03 * dpr; s.life -= 0.018;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.2 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (confetti.length || sparks.length || active) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [duration]);

  return <canvas ref={ref} data-testid="id-confetti" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />;
};
