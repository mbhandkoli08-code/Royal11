import { Home, Trophy, Users, Gamepad2, Wallet, Spade } from "lucide-react";

// Shared across SideNav (desktop/tablet) and BottomNav (mobile) so the player
// app navigation stays in sync in one place.
export const NAV_ITEMS = [
  { to: "/", label: "Home", icon: Home, id: "home" },
  { to: "/sports", label: "Sports", icon: Trophy, id: "sports" },
  { to: "/fantasy", label: "Fantasy", icon: Users, id: "fantasy" },
  { to: "/casino", label: "Cards", icon: Spade, id: "casino" },
  { to: "/games", label: "Games", icon: Gamepad2, id: "games" },
  { to: "/wallet", label: "Wallet", icon: Wallet, id: "wallet" },
];
