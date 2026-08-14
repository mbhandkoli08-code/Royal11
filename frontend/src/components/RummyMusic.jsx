import { useEffect, useRef, useState } from "react";
import { Music2, VolumeX } from "lucide-react";

const KEY = "royal11_rummy_music";

// Soft, elegant lounge ambience for the Rummy table — synthesized live with the
// Web Audio API (a sustained Amaj9-ish pad through a low-pass filter with very
// slow swell + filter drift). No lyrics, no beat, no external asset => inherently
// royalty-free/CC0. OFF by default; only ever starts from a user tap (autoplay-safe).
export const RummyMusic = () => {
  const [on, setOn] = useState(() => localStorage.getItem(KEY) === "on");
  const audioRef = useRef(null); // { ctx, master, nodes[] }

  const stop = () => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.master.gain.setTargetAtTime(0.0001, a.ctx.currentTime, 0.6);
      setTimeout(() => { try { a.ctx.close(); } catch { /* noop */ } }, 900);
    } catch { /* noop */ }
    audioRef.current = null;
  };

  const start = () => {
    if (audioRef.current) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 820;
    filter.Q.value = 0.5;
    filter.connect(master);

    // Amaj9 voicing — warm and unobtrusive.
    const freqs = [110, 164.81, 220, 277.18, 329.63];
    const oscs = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? "sine" : "triangle";
      o.frequency.value = f;
      o.detune.value = Math.random() * 6 - 3;
      const g = ctx.createGain();
      g.gain.value = 0.13 / (i + 1);
      o.connect(g); g.connect(filter);
      o.start();
      return o;
    });

    // Gentle volume swell.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain); lfoGain.connect(master.gain); lfo.start();

    // Slow filter drift for a living, evolving pad.
    const flfo = ctx.createOscillator(); flfo.frequency.value = 0.028;
    const flfoGain = ctx.createGain(); flfoGain.gain.value = 260;
    flfo.connect(flfoGain); flfoGain.connect(filter.frequency); flfo.start();

    master.gain.setTargetAtTime(0.05, ctx.currentTime, 2.0); // fade in
    audioRef.current = { ctx, master, nodes: [...oscs, lfo, flfo] };
  };

  const toggle = () => {
    const next = !on;
    setOn(next);
    localStorage.setItem(KEY, next ? "on" : "off");
    if (next) start(); else stop();
  };

  // Resume if a previous session left it on (still requires this mount to have
  // happened via navigation, i.e. a prior user gesture); and always clean up.
  useEffect(() => {
    if (on) start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      data-testid="rummy-music-toggle"
      aria-pressed={on}
      onClick={toggle}
      title={on ? "Turn off lounge music" : "Turn on lounge music"}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
        on ? "border-[var(--r-gold)]/60 bg-[var(--r-gold)]/15 text-[var(--r-gold)]" : "border-white/15 bg-black/20 text-white/50 hover:text-white/80"
      }`}
    >
      {on ? <Music2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
    </button>
  );
};
