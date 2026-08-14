// Deterministic, generated player avatars (DiceBear "shapes" — colourful
// abstract/geometric icons). No real faces, no licensing concerns (CC0), and
// the same seed always yields the same avatar. Seed by stable player id.
const STYLE = "shapes";

export const playerAvatarUrl = (seed) =>
  `https://api.dicebear.com/9.x/${STYLE}/svg?seed=${encodeURIComponent(String(seed || "player"))}` +
  `&radius=50&backgroundType=gradientLinear,solid`;

export const avatarInitials = (name) =>
  (name || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
