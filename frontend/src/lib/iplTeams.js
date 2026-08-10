import { useCallback, useEffect, useState } from "react";

// Well-known public IPL team associations (colors + slogans). We intentionally
// use simple colored badges / initials + team-name text here — NOT trademarked
// crests/logos.
export const IPL_TEAMS = [
  { id: "mi", name: "Mumbai Indians", short: "MI", primary: "#004BA0", secondary: "#D1AB3E", slogan: "Duniya Hila Denge" },
  { id: "csk", name: "Chennai Super Kings", short: "CSK", primary: "#F9CD05", secondary: "#1E3A8A", slogan: "Whistle Podu" },
  { id: "rcb", name: "Royal Challengers Bengaluru", short: "RCB", primary: "#EC1C24", secondary: "#D4AF37", slogan: "Ee Sala Cup Namde" },
  { id: "kkr", name: "Kolkata Knight Riders", short: "KKR", primary: "#3A225D", secondary: "#D1AB3E", slogan: "Korbo Lorbo Jeetbo" },
  { id: "dc", name: "Delhi Capitals", short: "DC", primary: "#17479E", secondary: "#EF3B4E", slogan: "Bleed Blue, Dilli" },
  { id: "pbks", name: "Punjab Kings", short: "PBKS", primary: "#ED1C24", secondary: "#8A8D8F", slogan: "Saddi History Nahi, Mystery Hai" },
  { id: "rr", name: "Rajasthan Royals", short: "RR", primary: "#EA1A85", secondary: "#004BA0", slogan: "Halla Bol" },
  { id: "srh", name: "Sunrisers Hyderabad", short: "SRH", primary: "#FF822A", secondary: "#1A1A1A", slogan: "Orange Army" },
  { id: "gt", name: "Gujarat Titans", short: "GT", primary: "#1B2133", secondary: "#D1AB3E", slogan: "Titans Hain Hum" },
  { id: "lsg", name: "Lucknow Super Giants", short: "LSG", primary: "#3AA6D0", secondary: "#FF822A", slogan: "Never Give Up" },
];

export const getTeamById = (id) => IPL_TEAMS.find((t) => t.id === id) || null;

// Pick readable text (dark vs white) for a given background hex via luminance.
export const readableText = (hex) => {
  const h = (hex || "#000000").replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#1A1A1A" : "#FFFFFF";
};

// Convert hex -> "r, g, b" so callers can build rgba() tints.
export const hexToRgb = (hex) => {
  const h = (hex || "#000000").replace("#", "");
  return `${parseInt(h.substring(0, 2), 16)}, ${parseInt(h.substring(2, 4), 16)}, ${parseInt(h.substring(4, 6), 16)}`;
};

const STORAGE_KEY = "royal11_fav_team";

// Client-side favorite-team preference, persisted to localStorage.
export const useFavoriteTeam = () => {
  const [teamId, setTeamId] = useState(() => localStorage.getItem(STORAGE_KEY) || null);

  useEffect(() => {
    if (teamId) localStorage.setItem(STORAGE_KEY, teamId);
  }, [teamId]);

  const setFavorite = useCallback((id) => setTeamId(id), []);

  return { team: getTeamById(teamId), teamId, setFavorite };
};
