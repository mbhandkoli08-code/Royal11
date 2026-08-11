// Standard wa.me deep-link — opens WhatsApp on the player's phone with a chat
// ready. No Meta Business API / cost involved.
export const buildWaLink = (number, text) => {
  if (!number) return null;
  const digits = String(number).replace(/\D/g, "");
  if (digits.length < 8) return null;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${q}`;
};
