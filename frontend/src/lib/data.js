import { Spade, Club, Target, Plane, Dice5, Heart, Trophy, Users, Gamepad2, Gift } from "lucide-react";

export const USER = {
  name: "Arjun",
  avatar: "https://images.unsplash.com/photo-1740252117044-2af197eea287?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NjZ8MHwxfHNlYXJjaHwxfHx1c2VyJTIwcHJvZmlsZSUyMGF2YXRhciUyMHBvcnRyYWl0fGVufDB8fHx8MTc4NjIwNTkyNHww&ixlib=rb-4.1.0&q=85",
};

export const QUICK_ACTIONS = [
  { key: "sports", label: "Sports", icon: Trophy, tint: "bg-royal-light text-royal" },
  { key: "fantasy", label: "Fantasy", icon: Users, tint: "bg-flame-light text-flame" },
  { key: "games", label: "Games", icon: Gamepad2, tint: "bg-mint-light text-mint" },
  { key: "rewards", label: "Rewards", icon: Gift, tint: "bg-[#FCE7F3] text-[#DB2777]" },
];

export const LIVE_MATCHES = [
  {
    id: "cric",
    sport: "Cricket · T20",
    league: "Premier League",
    image: "https://images.unsplash.com/photo-1771909713995-d793a0c93660?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxNzV8MHwxfHNlYXJjaHwzfHxjcmlja2V0JTIwc3RhZGl1bSUyMHN1bnNldHxlbnwwfHx8fDE3ODYyOTk0MTZ8MA&ixlib=rb-4.1.0&q=85",
    teamA: { name: "MI", score: "182/4", ov: "18.2" },
    teamB: { name: "CSK", score: "146/6", ov: "16.0" },
    note: "MI need 37 off 22",
  },
  {
    id: "foot",
    sport: "Football",
    league: "Champions Cup",
    image: "https://images.unsplash.com/photo-1488474739786-757973c2dff6?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHw0fHxmb290YmFsbCUyMGFjdGlvbiUyMHBsYXllcnxlbnwwfHx8fDE3ODYyOTk0MTZ8MA&ixlib=rb-4.1.0&q=85",
    teamA: { name: "ARS", score: "2", ov: "" },
    teamB: { name: "BAR", score: "1", ov: "" },
    note: "67' · Second half",
  },
];

export const FANTASY_PROMO_BG =
  "https://images.unsplash.com/photo-1508087625439-de3978963553?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwyfHxmb290YmFsbCUyMGFjdGlvbiUyMHBsYXllcnxlbnwwfHx8fDE3ODYyOTk0MTZ8MA&ixlib=rb-4.1.0&q=85";

export const GAMES = [
  { key: "teen-patti", name: "Teen Patti", icon: Spade, tint: "bg-royal-light text-royal" },
  { key: "poker", name: "Poker", icon: Club, tint: "bg-[#EAF7F0] text-mint" },
  { key: "roulette", name: "Roulette", icon: Target, tint: "bg-[#FDECEC] text-[#EF4444]" },
  { key: "aviator", name: "Aviator", icon: Plane, tint: "bg-flame-light text-flame" },
  { key: "ludo", name: "Ludo", icon: Dice5, tint: "bg-[#EEF2FF] text-[#6366F1]" },
  { key: "call-break", name: "Call Break", icon: Heart, tint: "bg-[#FCE7F3] text-[#DB2777]" },
];

export const INITIAL_TXNS = [
  { id: 1, label: "Daily Login Bonus", meta: "Streak reward", type: "credit", amount: 50, when: "Today · 9:12 AM", icon: "Gift" },
  { id: 2, label: "Joined Mega Fantasy Contest", meta: "IPL Grand League", type: "debit", amount: 100, when: "Today · 8:40 AM", icon: "Users" },
  { id: 3, label: "Played Ludo Classic", meta: "Table #2291", type: "debit", amount: 25, when: "Yesterday · 10:05 PM", icon: "Dice5" },
  { id: 4, label: "Referral Reward", meta: "Invited Priya", type: "credit", amount: 200, when: "Yesterday · 6:22 PM", icon: "Sparkles" },
  { id: 5, label: "Won Teen Patti", meta: "Royal Table", type: "credit", amount: 75, when: "Mon · 7:15 PM", icon: "Trophy" },
];

export const CONTEST = {
  name: "IPL Grand League",
  sub: "MI vs CSK · Mega Contest",
  entryFee: 100,
  budget: 100,
};

export const PLAYERS = [
  { id: "p1", name: "Ishan Kishan", team: "MI", role: "WK", credits: 9.0, points: 88 },
  { id: "p2", name: "MS Dhoni", team: "CSK", role: "WK", credits: 9.5, points: 76 },
  { id: "p3", name: "Rohit Sharma", team: "MI", role: "BAT", credits: 10.5, points: 120 },
  { id: "p4", name: "Suryakumar Yadav", team: "MI", role: "BAT", credits: 10.0, points: 140 },
  { id: "p5", name: "Ruturaj Gaikwad", team: "CSK", role: "BAT", credits: 9.5, points: 110 },
  { id: "p6", name: "Devon Conway", team: "CSK", role: "BAT", credits: 9.0, points: 95 },
  { id: "p7", name: "Tilak Varma", team: "MI", role: "BAT", credits: 8.5, points: 70 },
  { id: "p8", name: "Hardik Pandya", team: "MI", role: "AR", credits: 11.0, points: 160 },
  { id: "p9", name: "Ravindra Jadeja", team: "CSK", role: "AR", credits: 10.5, points: 150 },
  { id: "p10", name: "Kieron Pollard", team: "MI", role: "AR", credits: 9.0, points: 80 },
  { id: "p11", name: "Moeen Ali", team: "CSK", role: "AR", credits: 8.5, points: 90 },
  { id: "p12", name: "Jasprit Bumrah", team: "MI", role: "BOWL", credits: 11.0, points: 130 },
  { id: "p13", name: "Trent Boult", team: "MI", role: "BOWL", credits: 9.0, points: 100 },
  { id: "p14", name: "Matheesha Pathirana", team: "CSK", role: "BOWL", credits: 8.5, points: 85 },
  { id: "p15", name: "Deepak Chahar", team: "CSK", role: "BOWL", credits: 8.5, points: 75 },
  { id: "p16", name: "Mitchell Santner", team: "CSK", role: "BOWL", credits: 8.0, points: 60 },
];

export const STORE_ITEMS = [
  { id: "av1", type: "avatar", name: "Neon Striker", desc: "Glowing sport avatar frame.", price: 300, icon: "Smile", tint: "bg-royal-light text-royal" },
  { id: "av2", type: "avatar", name: "Golden Captain", desc: "Premium gold captain avatar.", price: 800, icon: "Crown", tint: "bg-flame-light text-flame" },
  { id: "av3", type: "avatar", name: "Pixel Pro", desc: "Retro pixel-art avatar skin.", price: 500, icon: "Ghost", tint: "bg-[#EEF2FF] text-[#6366F1]" },
  { id: "bd1", type: "badge", name: "MVP Badge", desc: "Show off your top form.", price: 400, icon: "Award", tint: "bg-mint-light text-mint" },
  { id: "bd2", type: "badge", name: "Streak Master", desc: "For 30-day login legends.", price: 600, icon: "Flame", tint: "bg-flame-light text-flame" },
  { id: "bd3", type: "badge", name: "Champion", desc: "Elite winner's badge.", price: 1000, icon: "Trophy", tint: "bg-[#FEF3C7] text-[#D97706]" },
  { id: "bo1", type: "boost", name: "2x Coins Boost", desc: "Double coin earnings for 24h.", price: 250, icon: "Zap", tint: "bg-royal-light text-royal" },
  { id: "bo2", type: "boost", name: "XP Booster", desc: "Level up faster this week.", price: 350, icon: "Rocket", tint: "bg-[#FCE7F3] text-[#DB2777]" },
  { id: "bo3", type: "boost", name: "Lucky Spin", desc: "One free spin on the reward wheel.", price: 150, icon: "Sparkles", tint: "bg-mint-light text-mint" },
];
