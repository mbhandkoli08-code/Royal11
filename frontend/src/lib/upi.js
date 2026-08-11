// Standard UPI deep-link used by all UPI apps (GPay/PhonePe/Paytm/BHIM).
// upi://pay?pa=<vpa>&pn=<payee-name>&cu=INR
export const buildUpiUri = (upiId, name) => {
  if (!upiId) return null;
  const params = new URLSearchParams({ pa: upiId, pn: name || "ROYAL11", cu: "INR" });
  return `upi://pay?${params.toString()}`;
};
