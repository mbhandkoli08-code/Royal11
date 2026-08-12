import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import logo from "@/assets/royal11-logo.png";

const VIDEO_SRC = `${process.env.PUBLIC_URL}/royal11-intro.mp4`;
const MAX_DURATION_MS = 11000; // safety net if `onended` never fires

export const SplashScreen = ({ onFinish }) => {
  const videoRef = useRef(null);
  const finishedRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    // CSS-only fade-out, then unmount via parent — no framer-motion exit path.
    setLeaving(true);
    setTimeout(() => onFinish?.(), 450);
  };

  const toggleMute = () => {
    const v = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (v) {
      v.muted = next;
      // Unmuting is a user gesture, so it's safe to (re)start playback with audio.
      if (!next) v.play?.().catch(() => {});
    }
  };

  useEffect(() => {
    // Kick off muted autoplay. If the browser blocks it, the poster (crest)
    // stays visible and the user can Skip — we do NOT treat that as a failure.
    const v = videoRef.current;
    if (v) {
      v.muted = true;
      const p = v.play?.();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    const t = setTimeout(finish, MAX_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  // Genuine load/decode failure → short branded card, then hand off.
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(finish, 2300);
    return () => clearTimeout(t);
  }, [failed]);

  return (
    <div
      data-testid="splash-screen"
      className={`fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-black transition-opacity duration-500 ease-in-out ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      {!failed ? (
        <video
          ref={videoRef}
          data-testid="splash-video"
          className="h-full w-full object-contain"
          src={VIDEO_SRC}
          poster={logo}
          autoPlay
          muted
          playsInline
          preload="auto"
          controls={false}
          onEnded={finish}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex flex-col items-center justify-center px-6 text-center" data-testid="splash-fallback">
          <div
            className="relative overflow-hidden shadow-[0_20px_60px_rgba(200,16,46,0.45)] ring-1 ring-amber-300/40"
            style={{ width: 180, height: 180, borderRadius: 28 }}
          >
            <img src={logo} alt="ROYAL11" className="h-full w-full object-cover" draggable={false} />
          </div>
          <p className="mt-7 text-[11px] font-bold uppercase tracking-[0.32em] text-amber-300">
            Premium Sports &amp; Gaming
          </p>
          <p className="mt-2 text-sm font-medium text-slate-400">Virtual Coins Platform</p>
        </div>
      )}

      {/* Sound toggle (only while the video is the active experience) */}
      {!failed && (
        <button
          data-testid="splash-mute-btn"
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={!muted}
          onClick={toggleMute}
          className="absolute left-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/25"
          style={{ marginTop: "env(safe-area-inset-top)" }}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}

      {/* Skip */}
      <button
        data-testid="splash-skip-btn"
        onClick={finish}
        className="absolute right-4 top-4 z-10 rounded-full bg-white/15 px-4 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/25"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        Skip
      </button>
    </div>
  );
};
