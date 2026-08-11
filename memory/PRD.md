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
  - **PENDING (user action)**: ✅ RESOLVED 2026-08 — `GOOGLE_CLOUD_VISION_API_KEY` added to `backend/.env`; **live OCR verified end-to-end** (real screenshot → green "Matches" with amount+UTR+timestamp all correct; mismatch → red "Review carefully"). Regression pytest: `tests/test_ocr_service.py`, `tests/test_deposit_screenshot_ocr.py`.

- 2026-08: **Task 2 — Zonal Manager tier + Admin-creation approval + per-Manager admin cap (DONE, verified iteration_13, 23/23 backend + all 3 console roles)**.
  - New role `ZONAL_MANAGER` (SA → ZM → Manager → Admin → Player). `app/hierarchy_service.py` + `app/routers/zonal.py`.
  - **Funding chain**: SA mints into ZM wallet (`SUPER_ADMIN_TO_ZONAL`) + sets ZM `authorized_quota`; ZM transfers to Managers in its zone (`ZONAL_TO_MANAGER`, atomic quota reservation like Manager→Admin). Managers with `zonal_manager_id=null` still funded directly by SA (backward-compatible).
  - **Approval workflow**: Managers can NO LONGER direct-create Admins (`POST /admin/admins` is SA-only). They submit `admin_creation_requests` (PENDING, password stored hashed) → approved/rejected by their ZM (or SA if no zone). Idempotent account creation on approve. Console "Admin Requests" queue (SA/ZM approve; Manager read-only).
  - **Per-Manager cap** `max_admins_allowed` (null=unlimited) set by SA or owning ZM; existing admins + pending requests both count; hard-block at cap on submit + re-check on approve. `PATCH /admin/managers/{id}/max-admins`.
  - Endpoints: `POST/GET /admin/zonal-managers`, `PATCH .../{id}/quota`, `POST .../{id}/fund`, `GET /admin/zonal/my-allocation|my-managers`, `POST /admin/zonal/managers|fund-manager`, `POST /admin/admin-requests` (+`/approve`,`/reject`), `GET /admin/admin-requests`. Console: `ZonalManagersPanel` (SA), `MyManagersPanel` (ZM), `AdminRequestsPanel` (SA/ZM/Manager); `ManagersPanel` gained Zone+Cap columns + Cap action + optional zone on create. Seed adds `zonal1@royal11.com` (funded); `manager1` stays no-zone. `CONSOLE_ROLES` now includes ZONAL_MANAGER.

- 2026-08: **Multi-bank accounts + UPI ID + auto QR (DONE, verified iteration_14, 10/10 backend + all frontend)**.
  - Admin/Manager can hold MULTIPLE `admin_bank_accounts`; exactly one `is_active` (activating one deactivates the rest; old accounts kept, never deleted). Migration drops legacy unique(admin_id) index + backfills `id`/`is_active`.
  - Each account has optional `upi_id`; scannable **UPI QR** generated client-side (`qrcode.react`) from `upi://pay?pa=<upi_id>&pn=<name>&cu=INR` (`frontend/src/lib/upi.js`). No photo upload.
  - Deposits auto-stamp `account_id` = active account at creation. Per-account CONFIRMED-deposit totals (this-week Sun–Sat + all-time) via aggregation.
  - Endpoints: `GET/POST /admin/bank-accounts`, `PATCH /admin/bank-accounts/{id}/activate` (old singular `/bank-account` removed). UI: rewritten Console `BankAccountPanel` (cards + totals + active Switch + add modal w/ live QR preview) + player `AddCoins` (active account QR + details side-by-side). Regression: `tests/test_multi_bank_upi.py`.
  - **Add-on (2026-08)**: optional bank-account **nickname/label** (e.g. "Primary GPay") — `BankAccountInput.label`; shown on the account card headline.

- 2026-08: **Task 3 — Salary + Incentive payroll for Managers & Zonal Managers (DONE, verified iteration_15, 18/18 backend + all frontend)**. `app/payroll_service.py`.
  - **SALARY** = fixed guaranteed weekly amount (`weekly_salary_inr`, default 0), paid every settlement week (Sun–Sat) regardless of performance. **INCENTIVE** = extra bonus only when downline CONFIRMED deposit revenue that week ≥ `incentive_target_inr`: bonus = round(revenue × `incentive_pct`/100). Both funded from the Super Admin share (Admin's 30% untouched), credited 1:1 as coins, idempotent (`salary:{uid}:{ws}`, `incentive:{uid}:{ws}`), TxnType `SALARY`/`INCENTIVE`. Manager downline = admins under them; ZM downline = all admins under all managers in the zone.
  - Evaluated in the APScheduler `_daily_maintenance` via `run_recent_payroll` (pays the most recent completed week, idempotent). Live projection endpoints `GET /admin/my-payroll` (Manager) + `GET /admin/zonal/my-payroll` (ZM). SA sets via `PATCH /admin/managers/{id}/payroll` + `PATCH /admin/zonal-managers/{id}/payroll`.
  - UI: SA "Pay" action + modal on `ManagersPanel` & `ZonalManagersPanel`; `PayrollCard` (salary + incentive + total + progress bar) on Manager (`MyAdminsPanel`) & ZM (`MyManagersPanel`) consoles. Regression: `tests/test_payroll_whatsapp_banklabel.py`.

- 2026-08: **WhatsApp contact + wa.me deep-link (DONE, verified iteration_15)**. Admin/Manager set `whatsapp_number` (with country code) via `PUT /admin/profile/whatsapp` (`GET /admin/profile`), edited in the Console Bank Account tab (`whatsapp-card`). Players get a "Chat on WhatsApp" button (`https://wa.me/<digits>?text=...`, `frontend/src/lib/whatsapp.js`) in two places: (1) player `AddCoins` near the bank/QR section (prefill "Hi, I need help with my payment"; `deposit-info`/`my-agent` expose `admin_whatsapp`), and (2) a one-time post-signup `WelcomeAgentModal` (flag `r11_welcome`) naming the assigned admin (prefill "Hi, I just signed up on ROYAL11"). Button hidden gracefully when no number is set. No Meta Business API — pure device deep-link.


## Backlog / Remaining
- **P2 (NEXT): Connect mock frontend actions to real ledgers** — Rewards Store redemptions, Boost extensions, Contest entries, and the lucky spin should debit/credit real coins via the wallet ledger (currently front-end-only/mocked).
  - ✅ Task 3 — Salary + Incentive payroll (Managers & Zonal Managers) — DONE (2026-08, iteration_15).
  - ✅ Zonal Manager tier + Admin-creation approval + per-Manager cap — DONE (2026-08, iteration_13).
  - ✅ Multi-bank accounts + UPI QR + nickname; WhatsApp contact — DONE (2026-08, iteration_14 & 15).
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
