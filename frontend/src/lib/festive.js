// Independence Day (15 August) festive theme helpers.
// Active for a short window around the day so it never lingers year-round.
export const TRICOLOR = {
  saffron: "#FF9933",
  white: "#FFFFFF",
  green: "#138808",
  chakra: "#0A3D91", // navy blue
};

export const isIndependenceWindow = (now = new Date()) => {
  // Manual override for testing/preview: ?festive=1 (on) / ?festive=0 (off).
  try {
    const q = new URLSearchParams(window.location.search).get("festive");
    if (q === "1") return true;
    if (q === "0") return false;
  } catch { /* noop */ }
  // August (month index 7), 13th–16th inclusive.
  return now.getMonth() === 7 && now.getDate() >= 13 && now.getDate() <= 16;
};
