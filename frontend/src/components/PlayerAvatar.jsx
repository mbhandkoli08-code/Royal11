import { useState } from "react";
import { avatarInitials, playerAvatarUrl } from "@/lib/avatar";

// Generated geometric player avatar with a graceful initials fallback.
export function PlayerAvatar({ seed, name, size = 32, className = "" }) {
  const [failed, setFailed] = useState(false);
  const dim = { width: size, height: size };

  if (failed) {
    return (
      <span
        className={`fx-avatar grid shrink-0 place-items-center rounded-full text-[11px] font-extrabold ${className}`}
        style={dim}
        data-testid="player-avatar-fallback"
      >
        {avatarInitials(name)}
      </span>
    );
  }
  return (
    <img
      src={playerAvatarUrl(seed || name)}
      alt={name || "player"}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full border border-white/15 bg-white/10 ${className}`}
      style={dim}
      data-testid="player-avatar"
    />
  );
}
