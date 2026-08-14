// Dynamic team-color theming for the Fantasy "Glass Premium" screens.
// Looks up a match/team name against known IPL team colours; when nothing
// matches (or no team is selected) it falls back to the bold, DOMINANT
// ROYAL11 / Dream11-style RED gradient so the page always looks intentional.
import { IPL_TEAMS } from "./iplTeams";

const GOLD = "#FFD25A";
const RED = "#EC1C24";
const MAROON = "#5E080E";

// Mix a hex colour toward black by `amt` (0..1).
export const darken = (hex, amt = 0.6) => {
  const h = (hex || "#000000").replace("#", "");
  const ch = (i) => Math.round(parseInt(h.substring(i, i + 2), 16) * (1 - amt));
  return `#${[ch(0), ch(2), ch(4)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};

export const hexToRgb = (hex) => {
  const h = (hex || "#000000").replace("#", "");
  return `${parseInt(h.substring(0, 2), 16)}, ${parseInt(h.substring(2, 4), 16)}, ${parseInt(h.substring(4, 6), 16)}`;
};

// Distinctive city/keyword tokens per IPL team — matching on these (not loose
// words like "royal"/"kings"/"super") avoids false positives for non-IPL teams.
const TEAM_KEYWORDS = {
  mi: ["mumbai"],
  csk: ["chennai"],
  rcb: ["bengaluru", "bangalore"],
  kkr: ["kolkata"],
  dc: ["delhi"],
  pbks: ["punjab", "mohali"],
  rr: ["rajasthan", "jaipur"],
  srh: ["hyderabad", "sunrisers"],
  gt: ["gujarat", "ahmedabad"],
  lsg: ["lucknow"],
};

// Fuzzy-match a free-text team name to a known IPL team (strict: exact short
// code, full-name inclusion, or a distinctive city keyword).
const findTeam = (name) => {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  return (
    IPL_TEAMS.find((t) => n === t.short.toLowerCase()) ||
    IPL_TEAMS.find((t) => n.includes(t.name.toLowerCase())) ||
    IPL_TEAMS.find((t) => (TEAM_KEYWORDS[t.id] || []).some((kw) => n.includes(kw))) ||
    null
  );
};

// Short code for the badge: official IPL short, else initials of the team name.
export const teamShort = (name) => {
  const t = findTeam(name);
  if (t) return t.short;
  return (name || "R11").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 3).join("").toUpperCase() || "R11";
};

// Split a "Team A vs Team B" label into its two team names.
export const splitTeams = (label) => {
  const parts = (label || "").split(/\s+vs\s+/i);
  return [parts[0]?.trim() || "", parts[1]?.trim() || ""];
};

// The default BOLD RED theme (no team / unknown team) — red is dominant.
export const DEFAULT_THEME = {
  teamName: null,
  isTeam: false,
  primary: RED,
  secondary: GOLD,
  bgFrom: RED,
  bgTo: MAROON,
  accent: GOLD,
  gold: GOLD,
};

// Resolve a theme for a single team name (used by the "Your Team Theme" card).
export const getTeamTheme = (teamName) => {
  const team = findTeam(teamName);
  if (!team) return DEFAULT_THEME;
  return {
    teamName: team.name,
    short: team.short,
    isTeam: true,
    primary: team.primary,
    secondary: team.secondary,
    bgFrom: team.primary,
    bgTo: darken(team.primary, 0.66),
    accent: team.secondary,
    gold: team.secondary,
  };
};

// CSS custom properties consumed by fantasy-glass.css.
export const themeVars = (theme) => ({
  "--fx-from": theme.bgFrom,
  "--fx-to": theme.bgTo,
  "--fx-accent": theme.accent,
  "--fx-accent-rgb": hexToRgb(theme.accent),
  "--fx-primary-rgb": hexToRgb(theme.primary),
});
