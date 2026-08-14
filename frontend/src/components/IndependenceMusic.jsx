import { useEffect, useRef, useState } from "react";
import { Music2, VolumeX } from "lucide-react";

const KEY = "royal11_id_music";

// Original, uplifting festive instrumental synthesized live (Web Audio) — a
// bright D-major phrase with a soft brass-like lead, a warm drone pad and a
// light tabla-ish tick. NOT the national anthem or any protected melody, no
// lyrics => inherently royalty-free/CC0. OFF by default; starts on user tap.
const D = 293.66;
const PHRASE = [
  // freq multiples relative to D4 for an original rising/resolving line
  D, D * 1.5, D * 2, D * 2.245, D * 2, D * 1.5, D * 1.335, D,
  D * 1.5, D * 2, D * 2.52, D * 3, D * 2.52, D * 2, D * 1.5, D * 2,
];

export const IndependenceMusic = ({ className = "" }) => {
  const [on, setOn] = useState(() => localStorage.getItem(KEY) === "on");
  const ref = useRef(null); // { ctx, master, drone[], timer, step }

  const stop = () => {
    const a = ref.current;
    if (!a) return;
    clearInterval(a.timer);
    try {
      a.master.gain.setTargetAtTime(0.0001, a.ctx.currentTime, 0.4);
      setTimeout(() => { try { a.ctx.close(); } catch { /* noop */ } }, 700);
    } catch { /* noop */ }
    ref.current = null;
  };

  const start = () => {
    if (ref.current) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    master.gain.setTargetAtTime(0.06, ctx.currentTime, 1.2);

    // Warm drone pad (D + A) for body.
    const drone = [D / 2, (D / 2) * 1.5].map((f) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.06;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
      o.connect(g); g.connect(lp); lp.connect(master); o.start();
      return o;
    });

    const playNote = (freq, when, dur) => {
      const o = ctx.createOscillator();
      o.type = "triangle"; o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.14, when + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2200;
      o.connect(g); g.connect(lp); lp.connect(master);
      o.start(when); o.stop(when + dur + 0.05);
    };
    const playTick = (when) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = 160;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.09, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
      o.connect(g); g.connect(master); o.start(when); o.stop(when + 0.14);
    };

    const stepDur = 0.34;
    const state = { ctx, master, drone, step: 0, timer: null };
    const tick = () => {
      const when = ctx.currentTime + 0.05;
      const i = state.step % PHRASE.length;
      playNote(PHRASE[i], when, stepDur * 1.6);
      if (i % 2 === 0) playTick(when);
      state.step += 1;
    };
    tick();
    state.timer = setInterval(tick, stepDur * 1000);
    ref.current = state;
  };

  const toggle = () => {
    const next = !on;
    setOn(next);
    localStorage.setItem(KEY, next ? "on" : "off");
    if (next) start(); else stop();
  };

  useEffect(() => {
    if (on) start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      data-testid="id-music-toggle"
      aria-pressed={on}
      onClick={toggle}
      title={on ? "Turn off festive music" : "Play festive music"}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors ${
        on ? "border-[#FF9933] bg-white/15 text-white" : "border-white/25 bg-white/5 text-white/80 hover:bg-white/10"
      } ${className}`}
    >
      {on ? <Music2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
      {on ? "Music on" : "Music"}
    </button>
  );
};
