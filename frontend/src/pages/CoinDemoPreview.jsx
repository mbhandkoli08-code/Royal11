import { useState } from "react";
import { GetCoinsDemo } from "@/components/casino/GetCoinsDemo";

// TEMPORARY preview route (/coin-demo) to review Coin Flow modals at any
// viewport (portrait phones show the Rotate gate on the real table). Removed
// once the Coin Flow is approved.
export default function CoinDemoPreview() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ minHeight: "100vh", background: "#0b0405", display: "grid", placeItems: "center" }}>
      <button data-testid="coin-demo-reopen" onClick={() => setOpen(true)}
        style={{ color: "#e9c667", border: "1px solid #e9c667", borderRadius: 999, padding: "8px 16px", fontWeight: 800 }}>
        Open Get Coins
      </button>
      <GetCoinsDemo open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
