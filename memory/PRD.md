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

- 2026-06: **Server-authoritative backend** — JWT auth (`/api/auth/*`), coin-ledger wallet with idempotency (`/api/wallet/me`), and SUPER_ADMIN→MANAGER→ADMIN→PLAYER hierarchy (`/api/admin/*`) under `backend/app/` + `seed.py`. Verified 100% (32/32 pytest). Note: seed emails use `@royal11.com` (email-validator rejects `.local`).

- 2026-07: **Frontend wired to real backend (Auth + Wallet)** — `AuthContext` (JWT Bearer, `localStorage['royal11_token']`, `/api/auth/me` on mount, login/register/logout, `formatApiErrorDetail`), `AuthPage` (Log In / Sign Up, matches Cherry-Red theme), `ProtectedShell`/`AuthRoute` in `App.js` (unauth → `/auth`), and `WalletContext` now reads real balance + history from `GET /api/wallet/me` (never locally mutated). Logout button on Home; greeting uses real `display_name`. Per product decision, coin-spending actions without a ledger endpoint yet (Earn Coins, Redeem/buy, Lucky Spin, Boost extend, Contest join/lock, Streak claim) are **disabled** and show a "Coming soon" toast — no fake balance changes. Verified 100% (9/9 e2e flows, iteration_8).
- 2026-07: **AI Match Preview (Gemini 3 Flash)** — `MatchDetail` modal fetches `POST /api/match/preview` on open, rendering an AI preview + favorite/win-probability bar + prediction (with graceful fallback). Verified live.
- 2026-07: **New R11 crest logo + video intro splash (visual-only)** — Replaced the header emblem with the Figma "R11" crest (`src/assets/royal11-logo*.png`, re-hosted locally) plus a thin gold accent bar; updated favicon/app-icons + title in `public/`. Added `SplashScreen.jsx` that plays a full-screen portrait intro video (`public/royal11-intro.mp4`, ~10s, H.264/AAC, autoplay+muted+playsInline, no controls) once on load, with a top-right **Skip** button, a top-left **mute/unmute** toggle (`VolumeX`↔`Volume2`, starts muted), `onEnded` handoff, and an 11s safety timer. On decode/load failure (e.g. browsers without H.264), it gracefully falls back to a branded crest card (~2.3s) then hands off. Handoff goes to Home (valid token) or Login. No backend changes.
- 2026-07: **Favorite IPL team personalization (visual-only)** — `lib/iplTeams.js` (10 teams: colors + slogans, `useFavoriteTeam` localStorage hook `royal11_fav_team`, luminance-based readable-text helper). `TeamBuilder.jsx` shows a first-run "Choose your team" picker (badge grid), then themes the Fantasy screen with that team's accent (gradient header, slogan banner, picked-card border/tint, pick-toggle + Lock CTA colors) and a "change team" chip to re-pick. Persists across reload. Verified live (MI + RCB). No backend/wallet changes.
- 2026-07: **Super Admin API Keys management (new feature)** — First Super Admin dashboard screen. Backend (`app/crypto_utils.py` Fernet encrypt-at-rest keyed by new `APP_ENCRYPTION_KEY` env, `app/api_keys_service.py` provider auto-detect + cheap live "list models" tests via httpx, `app/routers/api_keys.py`) exposes `POST/GET/DELETE /api/admin/api-keys`, `POST /api/admin/api-keys/test` (ad-hoc pre-save), `POST /api/admin/api-keys/{id}/test` — all behind `require_roles(SUPER_ADMIN)` and audit-logged. Keys stored encrypted; only provider + last4 ever returned; full key never logged/returned. `balance_info` honestly null (no provider exposes it via a simple key call). Frontend: `/admin` SUPER_ADMIN-only route (others redirected), admin nav shield on Home, `pages/AdminPage.jsx` with add form (debounced provider auto-detect, test-before-save, save), saved-keys list with status dots (green=ok+recent / yellow=untested·stale / red=failed), masked key, balance cell, per-row test + delete. Verified live end-to-end (add/test/save/re-test/delete + player redirect + 403 guard). New env vars added: `APP_ENCRYPTION_KEY`, `SPORTMONKS_CRICKET_API_KEY` (latter stored for future cricket-data use, not yet wired).

## Backlog / Remaining
- P1: Real ledger endpoints for game mechanics so the "Coming soon" actions go live:
  Earn Coins (daily/achievement credit), Rewards Store purchases (debit + owned items),
  Lucky Spin (entry debit + reward credit), Boosts, Fantasy Contest join/lock, Streak claim.
- P1: My Contests screen (joined contests with live rank); Match Alerts (wicket/goal toasts).
- P1: Streak Calendar (7-day + day-7 milestone); Spin Cooldown (free daily spin).
- P2: Boost timer on more surfaces; extend AI Coach with per-match context; refresh token flow.

## Notes
- Frontend now server-authoritative for Auth + Wallet (JWT Bearer in `localStorage['royal11_token']`).
- Coin-spending UI actions are intentionally disabled ("Coming soon") until their ledger endpoints exist.
