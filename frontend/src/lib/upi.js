// Standard UPI deep-link used by all UPI apps (GPay/PhonePe/Paytm/BHIM).
// upi://pay?pa=<vpa>&pn=<payee-name>&cu=INR
export const buildUpiUri = (upiId, name, amount) => {
  if (!upiId) return null;
  const params = new URLSearchParams({ pa: upiId, pn: name || "ROYAL11", cu: "INR" });
  const amt = Number(amount);
  if (amt > 0) params.set("am", String(Math.round(amt)));  // opens the UPI app pre-filled
  return `upi://pay?${params.toString()}`;
};
