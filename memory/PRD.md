# ROYAL11 — Product Requirements & Build Log

## Original Problem Statement
Build a modern, clean, full-width responsive web app UI for "ROYAL11" — an all-in-one sports,
fantasy sports, and casual gaming entertainment platform using virtual (non-cash, non-withdrawable)
coins. Bright, friendly, trustworthy sports-app aesthetic (Dream11/FanCode energy), NOT a dark casino
look. Two core screens (Home, Wallet) + a bottom nav (Home, Sports, Fantasy, Games, Wallet).

## Architecture
- **Frontend**: React 19 + Tailwind, framer-motion (motion/reveals), Lenis (smooth scroll),
  lucide-react icons, sonner toasts, react-router. Fonts: Outfit (display) + Manrope (body).
  Palette: Royal Indigo #4F46E5 + Flame Orange #F97316 on soft-neutral #F5F6FB.
- **State**: In-memory shared wallet via React Context (`WalletContext`) — balance, transactions,
  owned items, equipped avatar, boost timer. Resets on refresh (frontend-only by user choice).
- **Backend**: FastAPI + MongoDB (motor). One AI endpoint so far.
- **AI**: Claude Sonnet 4.6 via `emergentintegrations` + `EMERGENT_LLM_KEY`.
  `POST /api/fantasy/coach` — Claude ranks players; backend enforces the credit budget (hybrid),
  with a safe fallback. Suggestions logged to `ai_suggestions` collection.

## User Persona
Casual sports/fantasy gamer who wants a fun, trustworthy hub to follow live matches, build fantasy
teams, play casual games, and manage virtual coins — no real-money gambling.

## Core Requirements (static)
- Home: greeting header + bell + avatar; coin balance card (+today, View Wallet / Earn Coins);
  quick actions; Live Now cards; fantasy promo banner; games lobby (6 tiles); daily streak strip.
- Wallet: back + title; big balance + virtual-coins disclaimer; 3 stat tiles; How to Earn / Redeem;
  transaction history.
- Bottom nav (Home + Wallet functional; Sports/Fantasy/Games placeholders).

## Implemented (with dates)
- 2026-06: MVP Home + Wallet + bottom nav (verified 100%).
- 2026-06: Team Builder (draft XI, 100-credit budget), Rewards Store (avatars/badges/boosts),
  Live Score Ticker.
- 2026-06: Captain/Vice-Captain picks (2x/1.5x); live Contest Leaderboard (rank + points tick);
  Equip Rewards (avatars + badges shown on Home).
- 2026-06: Reward Wheel (Lucky Spin), 2x Boost effects + countdown, Boost Extend, Boost Tiers
  (5-min Mega boost, stacking).
- 2026-06: Match Detail scorecard with live ball-by-ball commentary (cricket + football).
- 2026-06: **Fantasy AI Coach** (Claude Sonnet 4.6) — "AI Coach" button auto-picks XI + C/VC +
  rationale; backend enforces budget. Verified 100% (backend pytest + frontend flow).

- 2026-06: **Server-authoritative backend** — JWT auth (`/api/auth/*`), coin-ledger wallet with idempotency (`/api/wallet/me`), and SUPER_ADMIN→MANAGER→ADMIN→PLAYER hierarchy (`/api/admin/*`) under `backend/app/` + `seed.py`. Verified 100% (32/32 pytest). Note: seed emails use `@royal11.com` (email-validator rejects `.local`). Frontend not yet wired to this backend (still in-memory by design of this task).

## Backlog / Remaining
- P1: My Contests screen (joined contests with live rank); Match Alerts (wicket/goal toasts).
- P1: Streak Calendar (7-day + day-7 milestone); Spin Cooldown (free daily spin).
- P2: Persist wallet/state to backend + user accounts/auth; boost timer on more surfaces;
  extend AI Coach with per-match context.

## Notes
- Frontend-only state by explicit user choice (except the AI endpoint which needs a backend).
- All interactive elements carry data-testid.
