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
- 2026-07: **Super Admin API Keys management (new feature)** — First Super Admin dashboard screen. Backend (`app/crypto_utils.py` Fernet encrypt-at-rest keyed by new `APP_ENCRYPTION_KEY` env, `app/api_keys_service.py` provider auto-detect + cheap live "list models" tests via httpx, `app/routers/api_keys.py`) exposes `POST/GET/DELETE /api/admin/api-keys`, `POST /api/admin/api-keys/test` (ad-hoc pre-save), `POST /api/admin/api-keys/{id}/test` — all behind `require_roles(SUPER_ADMIN)` and audit-logged. Keys stored encrypted; only provider + last4 ever returned; full key never logged/returned. `balance_info` honestly null (no provider exposes it via a simple key call). Frontend: `/admin` SUPER_ADMIN-only route (others redirected), admin nav shield on Home, `pages/AdminPage.jsx` with add form (debounced provider auto-detect, test-before-save, save), saved-keys list with status dots (green=ok+recent / yellow=untested·stale / red=failed), masked key, balance cell, per-row test + delete. Verified live end-to-end (add/test/save/re-test/delete + player redirect + 403 guard). New env vars added: `APP_ENCRYPTION_KEY`, `SPORTMONKS_CRICKET_API_KEY`.
- 2026-07: **Real cricket data via Sportmonks (server-side)** — `app/cricket_service.py` calls Sportmonks Cricket v2.0 (`livescores`, `fixtures`) using `SPORTMONKS_CRICKET_API_KEY` from env (**never** exposed to frontend), normalizes to the UI's match shape, and caches in-memory 45s. `app/routers/cricket.py` exposes public `GET /api/cricket/live` and `GET /api/cricket/matches`. Errors are handled gracefully (returns `{status:"unavailable"}`; never logs the token — only exception type). Frontend HomePage "Live Now" → renamed **Live Cricket**, now fetches `/api/cricket/live` (polls 45s) with four states: loading, list (`LiveCard`), empty ("No live matches right now"), and error ("Live scores temporarily unavailable"). Removed the old mock `LIVE_MATCHES` ticker + fake score/goal simulation. Verified live (empty + forced-error states). NOTE: `MatchDetail` still runs an animated ball-by-ball commentary as a visual flourish (only reachable from a live card; its AI preview is real) — not yet wired to real ball data.

- 2026-07: **Role-based Admin Console — Phase 1 (`/console`, NEW dark desktop dashboard)** — Replaces the old `/admin` page (deleted). A professional dark Admin Platform (page `#0d0d0d`, sidebar `#090607`, cards `#1b1012`, gold `#d4af37` accents, cherry `#c41230` primary), Outfit font, 240px grouped sidebar (CORE / COINS & FINANCIALS / SYSTEM), top search bar. Role-aware: **Super Admin** → Overview (real stat cards from `GET /api/admin/overview` + Manager Allocation & Performance table; honest "Coming soon" cards for DAU/alerts/time-series we don't track yet), Managers (list + create + fund + set-quota), Admins (read-only, with allocated/used/remaining/usage), Transactions (paginated `GET /api/admin/transactions` with player→admin→manager chain, type filter, reverse-with-confirm), API Keys (restyled dark). **Manager** → My Admins (quota stat cards + create admin + allocate coins) + Transaction History. **Admin** → My Players (grant coins) + Transaction History. **Player** → redirected to Home; `/console` guarded by `CONSOLE_ROLES`; admin roles redirect to `/console` after login. Backend additive endpoints in `admin.py`: `GET /admin/overview`, enriched `GET /admin/managers` (admin_count/usage), enriched `GET /admin/admins` + `GET /admin/my-admins` (allocated/used/usage/player_count via `_admin_flows` from the ledger), paginated `GET /admin/transactions` (`{items,total,skip,limit}` + `type` filter). Frontend under `src/console/*` (primitives, api hook, 7 panels) + `pages/ConsolePage.jsx`. Verified 100% — backend 21/21 pytest (`tests/test_console_admin.py`), all frontend role flows + role isolation (iteration_9). No fake data anywhere.

- 2026-07: **Coin top-up + revenue-share + settlement system (Parts 1–5)** — All fully backend-verified + frontend-tested (iteration_10 Parts 1–4, iteration_11 Part 5 + re-theme; pytest `tests/test_console_admin.py`, `test_royal11_recharge_part5.py`).
  - **P1 Deposits (manual)**: `deposits` collection; player `POST /api/wallet/deposit-request` (PENDING, no auto-credit), `GET /api/wallet/deposit-info` (assigned Admin + bank + 1 INR:1 coin ratio), `GET /api/wallet/deposits`; Admin `POST /api/admin/deposits/{id}/confirm` (idempotent credit `deposit:{id}`) / `/reject`, scoped `GET /api/admin/deposits`. UI: player `AddCoins.jsx` (Wallet → Add Coins), Console Deposits tab (chat-thread confirm/reject).
  - **P1b Bank accounts**: `admin_bank_accounts`; `GET/PUT /api/admin/bank-account` (Admin/Manager). Console Bank Account panel.
  - **P2 Revenue split + weekly settlements**: `revenue_split_super_admin_pct` per-admin (default 70), `PATCH /api/admin/admins/{id}/revenue-split`; `settlements` collection (Sun–Sat, due following Wed), idempotent lazy+scheduled generation, `GET /api/admin/settlements`, `POST .../{id}/settle`. Console Settlements tab + Admins "Split" action.
  - **P3 Usage alerts + auto-suspend**: `UserStatus.SUSPENDED`; 100%-used allocation auto-suspends Admin (COINS_EXHAUSTED) via `sync_admin_usage_suspension` on grant; re-allocation reinstates; suspended = read-only Console + action endpoints 403 (`require_not_suspended`). Usage badges + suspended banner.
  - **P4 Referral + nudge + daily summary**: player `referral_code`/`referred_by`, referrer +200 coins on signup (idempotent `referral:{new_user}`), `/me` backfills code; `POST /api/auth/activity` returns a non-punitive 2-day inactivity nudge; `daily_summaries` + `GET /api/admin/daily-summary(/export)` CSV. UI: signup referral field, Wallet referral card, Overview Daily Activity view.
  - **P5 Admin self-recharge**: `admin_recharges`; Admin `POST /api/admin/recharge-request` (allowed even while suspended), `GET /api/admin/my-recharges` + `/recharge-info`; Super Admin `GET /api/superadmin/recharges`, `POST .../{id}/confirm` (credits at 1.5x, idempotent `admin_recharge:{id}`, counts as allocation so it lifts COINS_EXHAUSTED) / `/reject`. Console Recharge Quota (Admin) + Recharge Requests (Super Admin) panels.
  - Scheduler: APScheduler daily 00:10 UTC `_daily_maintenance` (yesterday's summary + last week's settlements + overdue-suspension sweep).
- 2026-07: **Console visual RE-THEME (visual-only, all testids preserved)** — Dedicated Console login `/console/login` (orange→red gradient bank-marketing layout: gradient header, headline, icon quick-access cards, sign-in form; `ConsoleRoute` redirects logged-out to it, players → `/`). All other Console screens re-skinned dark→**white + sky-blue banking dashboard** (light sidebar, sky active highlight, IBM Plex Sans body, sky pill buttons, white cards/soft shadows, green/amber/red for status only) via rewritten `console/primitives.jsx` + bulk inline-class conversion. Overview gained a two-option toggle (Coin Economy / Daily Activity). Verified 100% across all 3 roles (iteration_11).

- 2026-08: **Task 1 — Deposit Screenshot Upload + Google Cloud Vision OCR + duplicate-UTR fraud flag (DONE, verified iteration_12, 100%)**. 
  - **Storage**: `app/storage_service.py` — Emergent object storage (init at startup, async put/get via `asyncio.to_thread`, retry-on-404 force re-init). Screenshots stored at `royal11/deposits/{player_id}/{uuid}.{ext}`; served through backend only (`GET /api/admin/deposits/{id}/screenshot`, scope-checked, streamed as blob to the console).
  - **OCR**: `app/ocr_service.py` — `GoogleVisionOCR` behind a single `get_ocr_provider()` boundary (swap engine = one-file change). Uses Cloud Vision `images:annotate` DOCUMENT_TEXT_DETECTION via `x-goog-api-key` header + `GOOGLE_CLOUD_VISION_API_KEY` env. **Graceful degrade**: key unset → `status="unavailable"`, verdict `"unknown"` (same pattern as Sportmonks). `parse_and_match()` extracts amount (₹/Rs/INR), UTR (case/punctuation-insensitive alnum substring), and timestamp (advisory). Verdict: green **"Matches"** = amount AND UTR match; else red **"Review carefully"**; timestamp advisory-only (never flips red). OCR NEVER auto-confirms/rejects.
  - **Fraud**: `deposit_service.create_deposit_request` sets `duplicate_utr=true` when reference_note exactly matches a previously CONFIRMED deposit; shows amber banner in console.
  - **API change**: `POST /api/wallet/deposit-request` is now **multipart/form-data** (`amount_inr`, `reference_note`, optional `screenshot` file; 8 MB + image/* validation).
  - **UI**: player `AddCoins.jsx` — optional screenshot attach + preview + FormData submit. Console `DepositsPanel.jsx` — side-by-side "Payment proof" thumbnail (fetch-as-blob, click to zoom) + "Auto-verification" OcrPanel + duplicate banner.
  - **PENDING (user action)**: user will send the `GOOGLE_CLOUD_VISION_API_KEY` in a separate chat message; add it to `backend/.env` + restart to activate live OCR. Regression pytest: `tests/test_ocr_service.py`, `tests/test_deposit_screenshot_ocr.py`.


## Backlog / Remaining
- **P0 (NEXT PHASE — queued, build together): Zonal Manager tier + Admin-creation approval workflow + per-Manager Admin cap + Manager/Zonal weekly incentive.** This is a real auth/hierarchy change → MUST consult `integration_playbook_expert_v2` and confirm plan before coding, and test with settlement-level rigor (commission math + role isolation + backward-compat).
  - **New role `ZONAL_MANAGER`** between SUPER_ADMIN and MANAGER (`SUPER_ADMIN → ZONAL_MANAGER → MANAGER → ADMIN → PLAYER`). Created by Super Admin. Can create/manage/allocate to Managers in their zone. Managers get nullable `zonal_manager_id` (null = reports straight to Super Admin, unchanged = backward compatible). NO revenue-split involvement.
  - **Admin-creation approval**: Manager can no longer create Admins directly — submits `admin_creation_requests` (PENDING). Approved/rejected by the Manager's Zonal Manager if any, else Super Admin. Admin account only created on approval (reuse existing create logic). New Console "Admin Requests" queue (Zonal Manager sees own zone; Super Admin sees no-zone Managers' + all).
  - **`max_admins_allowed` per Manager** (default null = unlimited, set by Super Admin or the Manager's Zonal Manager). At cap → HARD-BLOCK new Admin-creation requests with a clear error.
  - **Zonal Manager Console view** (like Manager's, post-retheme): "My Managers" (create/allocate) + "Admin Requests" queue.
  - **Manager/Zonal weekly deposit-revenue incentive** (builds on settlements): Super Admin sets per-person weekly `target_amount_inr` + `incentive_pct` (`incentive_targets` collection, one active per person). Measured against total CONFIRMED downline deposit revenue that Sun–Sat week (Manager = deposits under their Admins; Zonal = all Managers+Admins in zone). If met, bonus = target-week downline revenue × incentive_pct, **paid out of Super Admin's 70% share, NOT the Admin's cut**. Recurring per week, bonus-only (never a penalty). `incentive_payouts` (or ledger) records each week; idempotent credit `incentive:{user_id}:{week_start}`. Evaluate inside the existing APScheduler `_daily_maintenance` alongside settlement generation. UI: Super Admin sets/edits target+pct on a Manager/Zonal (like quota); the Manager/Zonal sees their own target + current week downline total + progress on their Overview.
- P1: Admin Console — Phase 2 (Figma frames not yet built): Users/Players management, Rewards & Game admin, Reports, Notifications, Support, Settings. NOTE: Deposit Mgmt / Withdrawal Mgmt / Bank Accounts nav from Figma are on HOLD (non-withdrawable model) — do NOT build.
- P1: Manager "Assign Players" UI (backend `POST /admin/players/assign` + `GET /admin/players` already exist).
- P2 (refactor): `admin.py` is ~680 lines — split into feature routers (managers/admins/deposits/settlements/recharge); consider a shared DomainError for uniform 400/404 mapping.
- P1: Real ledger endpoints for game mechanics so the "Coming soon" actions go live:
  Earn Coins (daily/achievement credit), Rewards Store purchases (debit + owned items),
  Lucky Spin (entry debit + reward credit), Boosts, Fantasy Contest join/lock, Streak claim.
- P1: My Contests screen (joined contests with live rank); Match Alerts (wicket/goal toasts).
- P1: Streak Calendar (7-day + day-7 milestone); Spin Cooldown (free daily spin).
- P2: Boost timer on more surfaces; extend AI Coach with per-match context; refresh token flow.

## Notes
- Frontend now server-authoritative for Auth + Wallet (JWT Bearer in `localStorage['royal11_token']`).
- Coin-spending UI actions are intentionally disabled ("Coming soon") until their ledger endpoints exist.
