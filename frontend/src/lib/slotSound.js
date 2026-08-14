// Tiny synthesized slot SFX via Web Audio API — no asset files, autoplay-safe
// (only ever triggered by a user gesture / after a spin). Global mute persisted
// in localStorage['royal11_sound'] (default OFF), matching the splash-audio rule.
let ctx = null;

function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function soundEnabled() {
  try {
    return localStorage.getItem("royal11_sound") === "on";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on) {
  try {
    localStorage.setItem("royal11_sound", on ? "on" : "off");
  } catch { /* ignore */ }
}

function tone(freq, start, dur, type = "sine", gain = 0.14) {
  const a = ac();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  osc.connect(g);
  g.connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + dur + 0.02);
}

export function playReelStop() {
  if (!soundEnabled()) return;
  tone(320, 0, 0.08, "triangle", 0.12);
}

export function playSpinStart() {
  if (!soundEnabled()) return;
  tone(180, 0, 0.18, "sawtooth", 0.06);
}

export function playWin(big = false) {
  if (!soundEnabled()) return;
  const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
  notes.forEach((f, i) => tone(f, i * 0.09, 0.22, "sine", big ? 0.18 : 0.13));
}

export function playJackpot() {
  if (!soundEnabled()) return;
  const seq = [523, 659, 784, 1047, 784, 1047, 1319, 1568];
  seq.forEach((f, i) => tone(f, i * 0.1, 0.28, "square", 0.14));
}
