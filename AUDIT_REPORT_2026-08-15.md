# ROYAL11 — Technical Codebase Audit (2026-08-15)

> Audit-only. Findings are based on reading the actual source in `/app/backend` and `/app/frontend` today. Where the code contradicts `PRD.md`, the code is treated as truth and the discrepancy is flagged.

---

## 1. TECH STACK
- **Backend framework:** FastAPI `0.110.1` (single `server.py` mounting an `/api` router + ~21 sub-routers under `app/routers/`).
- **Language:** Python 3.11 (async/await throughout).
- **Database:** MongoDB via **Motor `3.3.1`** (async) + **pymongo `4.6.3`**. Single DB from `MONGO_URL`/`DB_NAME`.
- **ORM:** None. Raw Motor collection access (`db.<collection>`). Pydantic `2.13.4` used only for request/response DTOs, **not** as an ODM. No `PyObjectId`/BaseDocument pattern — documents use app-generated `str(uuid4())` `id` fields and `{_id:0}` projections (so ObjectId serialization is sidestepped).
- **Redis / cache:** **None.** In-process only (e.g. `cricket_service` 45s in-memory cache).
- **WebSocket / realtime:** **None implemented.** `websockets==16.1.1` is only a transitive dep. Realtime is **REST + client polling** (see §5). Casino router docstring literally says *"WebSocket push is a later-phase upgrade."*
- **Auth:** Custom JWT — **PyJWT `2.13.0`** (HS256, `JWT_SECRET_KEY` from env), passwords via **passlib+bcrypt** (`CryptContext(schemes=["bcrypt"])`). Bearer token. `python-jose` is installed but `security.py` uses `jwt` (PyJWT).
- **Scheduler:** APScheduler `3.11.3` (daily maintenance: payroll, settlements, bonus expiry).
- **Hosting/deploy:** Supervisor-managed processes (backend uvicorn on `0.0.0.0:8001`, React dev server on `3000`, local MongoDB) inside a Kubernetes preview pod. Ingress routes `/api/*` → 8001. No Dockerfile/CI observed in repo. Object storage via Emergent managed service (`storage_service.py`).
- **3rd-party integrations:** Emergent LLM (Gemini/Claude via `emergentintegrations`), Sportmonks Cricket, Google Cloud Vision OCR, Emergent-managed Resend email, DiceBear avatars.

---

## 2. PROJECT STRUCTURE

### `/app/backend`
- `server.py` — app bootstrap, CORS, router registration, startup index creation, APScheduler jobs, a few inline `/api` endpoints (fantasy coach, match preview, status).
- `app/models.py` — all Enums (Role, UserStatus, TxnType, TxnStatus, Ticket*) + Pydantic request/response DTOs.
- `app/db.py` — Motor client/db singleton.
- `app/deps.py` — `get_current_user`, `require_roles(...)`, `require_not_suspended`.
- `app/security.py` — bcrypt hashing + JWT encode/decode.
- `app/wallet_service.py` — coin ledger: `credit/debit/transfer/reverse`, idempotency, negative-balance guard.
- `app/hierarchy_service.py` — Zonal Manager + Manager creation/funding, atomic quota reservation, admin-creation approval workflow.
- `app/assignment_service.py` — player→admin assignment + capacity (self-flagged race).
- `app/revenue_service.py` — Admin/Super-Admin revenue split %.
- `app/deposit_service.py` — manual real-money top-up (INR→coins) lifecycle + OCR + duplicate-UTR flag.
- `app/recharge_service.py` — Admin self-recharge requests.
- `app/admin_credit_service.py` — Admin float credit line + auto top-up + repayment.
- `app/payroll_service.py` — Manager/ZM salary + incentive + payslips.
- `app/bonus_service.py` — non-withdrawable bonus rail + wagering/playthrough.
- `app/surprise_box_service.py`, `festival_service.py`, `promo_service.py`, `referral_service.py` — bonus-rail-based reward features.
- `app/fantasy_service.py` + `demo_data.py` — Dream11-style fantasy on Sportmonks/demo fixtures.
- `app/game_service.py` — Rewards store / Lucky Spin / boosts (coin ledger wired).
- `app/games/` — casino engine: `rng.py` (provably-fair), `cards.py`, `catalog.py`, `engine.py` (High Card instant-showdown), `rummy.py` (rules) + `rummy_engine.py` (turn machine), `slots.py`+`slots_service.py` (777 Slots), `practice_service.py`, `progression_service.py` (VIP/XP).
- `app/chatbot_service.py` — Q JOKER read-only AI support assistant.
- `app/support_service.py` — tickets + SUPPORT_HELPER staff role.
- `app/otp_service.py`, `email_service.py`, `login_security.py` — email OTP, Resend email, brute-force lockout.
- `app/branding_service.py`, `api_keys_service.py`, `crypto_utils.py`, `ocr_service.py`, `storage_service.py`, `notification_service.py`, `player_profile_service.py`, `audit.py`, `constants.py` — supporting services.
- `app/routers/*` — thin HTTP layers per feature area.
- `seed.py` — seeds the role hierarchy + demo accounts. `tests/` — pytest suite (see §11).

### `/app/frontend/src`
- `App.js` — routes, `ProtectedShell` (player app: SideNav/BottomNav + chatbot), `ConsoleRoute`/console routing, splash.
- `context/AuthContext.jsx`, `context/WalletContext.jsx` — JWT auth + wallet state.
- `pages/` — player app: `HomePage`, `WalletPage`, `SportsPage`, `FantasyPage`, `CasinoPage`, `RummyTable`, `SlotsPage`, `MatchDetail`, `ConsolePage` (admin console).
- `console/` — role-based console panels (Overview, Managers, Admins, ZonalManagers, Deposits, Settlements, Recharge, CoinSupply, Fantasy, CasinoCommission, Support, etc.) + `primitives.jsx`, `api.js`.
- `components/` — `SupportChatbot`, `AddCoins`, `PlayingCard`, `PlayerAvatar`, `SplashScreen`, `SideNav`, `BottomNav`, `casino/OrnatePopups`, `SupportPlayer`, etc.
- `lib/` — `slotAssets`, `slotSound`, `casinoAssets`, `rummy`, `teamColors`, `upi`, `whatsapp`, `navItems`, etc.

---

## 3. USER SYSTEM
| Capability | State | Evidence |
|---|---|---|
| Registration (player self-signup) | ✅ EXISTS | `routers/auth.py:register` → creates `PENDING_VERIFICATION` player + emails OTP. |
| Email OTP verification | ✅ EXISTS | `auth.py:verify-otp`/`resend-otp`, `otp_service.py` (6-digit, TTL, attempts, resend cooldown). |
| Login (JWT) | ✅ EXISTS | `auth.py:login` → `security.create_access_token` (PyJWT HS256). Blocks `PENDING_VERIFICATION` (403). |
| Session model | ✅ Stateless JWT | `ACCESS_TOKEN_EXPIRE_MINUTES` env; `deps.get_current_user` decodes + reloads user each request. No refresh token. |
| Player profile | ✅ EXISTS | `player_profile_service.py` + `routers/profile.py` (`/me/profile` GET/PUT: mobile, bank, UPI, marketing consent). |
| Roles | ✅ EXISTS (5+1) | `models.Role`: SUPER_ADMIN, ZONAL_MANAGER, MANAGER, ADMIN, SUPPORT_HELPER, PLAYER. |
| Permissions / RBAC | ✅ EXISTS | `deps.require_roles(*roles)` dependency on protected routes; per-service scope checks (support, sensitive player data SA-only). |
| Account status | ✅ EXISTS | `models.UserStatus`: ACTIVE/DISABLED/SUSPENDED/PENDING_VERIFICATION. |
| Ban / suspend enforcement | 🟡 PARTIAL | `deps.get_current_user` hard-blocks DISABLED (403); `require_not_suspended` blocks SUSPENDED on state-changing console actions. **No admin-facing endpoint to manually DISABLE/ban a player** was found — SUSPENDED is set programmatically (allocation exhaustion via `sync_admin_usage_suspension`), not via a UI/endpoint. |

---

## 4. RUMMY ENGINE (`app/games/rummy.py` + `rummy_engine.py`, catalog `rummy_points`)
| Feature | State | Notes / Evidence |
|---|---|---|
| 2-player | ✅ | `catalog.rummy_points` `min_players:2, max_players:6`. |
| 4-player | ✅ | Supported (2–6 range, not a fixed 4-seat table). |
| 6-player | ✅ | Uses a 2-deck (106-card) shoe: `rummy_engine._base_shoe`. |
| **Points Rummy** | ✅ | The ONLY variant implemented. |
| **Pool Rummy (101/201)** | ❌ | Not in code. No pool state/elimination logic. |
| **Deals Rummy** | ❌ | Not in code. No fixed-deal accounting. |
| Card dealing | ✅ | `start_round` deals 13 cards/seat from the committed shoe. |
| Shuffle | ✅ | `rng.shuffled_list` (HMAC-Fisher–Yates, provably fair). |
| Joker / wild selection | ✅ | Last card set aside as wild indicator; `wild.rank`; printed jokers handled (`_mk_card`). |
| Draw | ✅ | `draw(table_id, uid, source)` (closed/open pile). |
| Discard | ✅ | `discard(...)`. |
| Sort / group | ✅ (client) | Grouping is client-side (`lib/rummy.js`); server validates on declare. |
| Drop | ✅ | `drop(...)`: 20 (first) / 40 (middle) points. |
| Declare | ✅ | `declare(table_id, uid, groups)` → `rummy.validate_declaration`. |
| Sequence validation (pure/impure) | ✅ | `rummy.py` classify pure/impure sequences (2-deck duplicate handling). |
| Set validation | ✅ | Sets require distinct suits; jokers substitute. |
| Winner calc / scoring | ✅ | Winner = valid declarer (MAX_POINTS cap for losers); `best_deadwood` greedy for others. |
| Game settlement | ✅ | `_settle`: escrow (80×point_value/seat) → payout + rake→revenue split + XP + bonus wager. |
| Reconnection | ✅ | REST `/state` rehydrates; `heartbeat`; **disconnect ≠ drop** rule. |
| Turn timer | ✅ | `turn_seconds` (default 30) `turn_deadline`; `_maybe_autoplay` on expiry. |
| Abandoned-game handling | 🟡 PARTIAL | Auto-play, then auto-drop after `max_timeouts` (default 3) consecutive timeouts. No explicit "all-but-one abandoned → cancel/void table" cleanup job found; relies on per-turn auto-drop. |
| Concurrency safety | ✅ | Optimistic `rev` counter (`_save` replace-if-rev-matches). |
| Provably-fair verify | ✅ | `/rummy/rounds/{id}/verify`. |

**Bottom line:** Only **Points Rummy** exists; **Pool and Deals are NOT implemented.** Player counts 2–6 all supported (variable-seat, not fixed 4/6).

---

## 5. REALTIME
- **Mechanism:** ❌ No WebSockets/Socket.IO. ✅ **REST + client polling.**
  - Casino/High Card: `CasinoPage.jsx` polls `GET /state` ~1.5s; lobby polls ~10s.
  - Rummy: `RummyTable.jsx` polls `/state` (turn-aware) + `heartbeat` every few polls + a 500ms local timer for the countdown UI.
- **Rooms:** 🟡 Logical only — `casino_tables` documents act as rooms (`seats[]`); no socket rooms.
- **Matchmaking:** 🟡 Basic — `POST /casino/quick-match` joins first WAITING table matching stake+mode or creates one. No skill/rating matchmaking.
- **Join/leave:** ✅ `POST /tables/{id}/join` / `/leave` (engine.join_table/leave_table).
- **Reconnect:** ✅ Inherent to REST+polling; `/state` rebuilds the round; `last_seen` heartbeat.
- **Game-state sync:** ✅ via polling snapshots; optimistic `rev` prevents lost updates.
- **Duplicate-connection handling:** ❌ Not applicable/none — no socket identity; multiple tabs would each poll the same seat (no dedupe/single-session enforcement).

---

## 6. VIRTUAL COIN SYSTEM
| Capability | State | Evidence |
|---|---|---|
| Player balance | ✅ | `wallets` collection (`balance` + `bonus_balance`), `wallet_service.get_or_create_wallet`. |
| Coin ledger | ✅ | `ledger_transactions` (append-only; PENDING→COMPLETED/FAILED; `balance_after`). |
| Coin transactions | ✅ | `credit/debit/transfer/reverse`, all with `request_id` idempotency. |
| Rewards | ✅ | Store/Lucky Spin/boosts (`game_service.py`), bonus rail (`bonus_service.py`). |
| Game entry deduction | ✅ | Casino `bonus_service.debit_playable` (real-first, then bonus); Slots `slots_stake:{spin_id}`; Fantasy `FANTASY_ENTRY`. |
| Game reward | ✅ | `GAME_REWARD`/`FANTASY_REWARD` credits, idempotent. |
| Reversal / refund | ✅ | `wallet_service.reverse` (idempotent, never deletes); round-cancel refunds. |
| Transaction history | ✅ | `GET /wallet/me` (WalletWithHistory); console transaction feeds. |

### Hierarchy vs the intended 4-level model
**Implemented today = 5 levels + a side role:** `SUPER_ADMIN → ZONAL_MANAGER → MANAGER → ADMIN → PLAYER` (+ `SUPPORT_HELPER` parented to an Admin, tickets-only).
- **Super Admin sets Manager limits:** ✅ `authorized_quota` via `PATCH /admin/managers/{id}/quota`; funds wallet via `POST /admin/managers/{id}/fund` (a pure credit = **minting**, no source wallet).
- **Manager allocates to Admins within limit:** ✅ `POST /admin/allocate` — atomic `find_one_and_update` reserving against `authorized_quota` + `wallet_service.transfer` (debit Manager wallet → credit Admin). Overshoot rolls back.
- **Admin grants to assigned Players from own allocation:** ✅ `POST /admin/grant` — checks player is assigned to this admin, then `transfer` (Admin wallet → player). InsufficientFunds enforces "within available."
- **Zonal Manager tier:** ✅ EXISTS (SA→ZM funding + `authorized_quota`; ZM→Manager `POST /admin/zonal/fund-manager` with atomic reservation). Managers with `zonal_manager_id=null` are funded directly by SA (backward-compatible, i.e. the 4-level path works as a subset).
- **Virtual / non-withdrawable:** ✅ **No withdrawal/cashout/redeem endpoint exists** (grep confirms none). Bonus coins are explicitly non-withdrawable with playthrough.
- **⚠️ DISCREPANCY vs your 4-level target:** the code has a **5th tier (Zonal Manager)** the 4-level model omits. To match the intended model you'd either (a) leave ZM unused (create Managers with `zonal_manager_id=null` — already supported), or (b) remove ZM. Not a bug — a design mismatch to confirm.
- **⚠️ DISCREPANCY vs "no real-money payment system":** there **is** a real-money **inflow**: `POST /wallet/deposit-request` (player pays an Admin via UPI/bank, Admin confirms → coins credited at 1:1). Payout bank/UPI is stored in the player profile but there is **no outflow/withdrawal**. So "non-withdrawable" holds, but the platform is **not** payment-free on the deposit side.

---

## 7. ADMIN SYSTEM
- **Super Admin:** ✅ Full console — overview, coin-supply/mint, manage ZMs/Managers/Admins, approve admin-creation requests, deposits, settlements, recharge queue, transactions (+reverse), fantasy, casino commission, rewards config, API keys, login security, player payout (SA-only), support, admin credit.
- **Manager:** ✅ Create admin *requests* (approval workflow, not direct create), allocate coins to Admins, deposits, bank account, transactions, payroll card.
- **Admin (vendor):** ✅ Grant coins to assigned players, confirm/reject deposits, self-recharge quota, bank accounts, fantasy contest creation, login branding, create SUPPORT_HELPERs, credit line.
- **Player assignment:** ✅ `POST /admin/players/assign` (SA/Manager) + auto-assign on activation (`assignment_service.auto_assign_player`).
- **Admin player-capacity limits:** ✅ `player_capacity` on `admin_allocations`; enforced on assign. 🟡 auto-assign capacity check is **count-then-insert (self-documented race)**.
- **Manager/Admin coin limits:** ✅ `authorized_quota` / `allocated_out` on manager & zonal allocations.
- **Coin allocation logic:** ✅ Atomic reservation + wallet transfer + rollback (see §6).
- **Admin→player grants:** ✅ `POST /admin/grant`.
- **Audit logs:** ✅ `audit.log_action` → `audit_logs` collection on most privileged actions (funding, grants, status changes, escalations, sensitive reads).

---

## 8. SECURITY / ANTI-CHEAT
| Control | State | Evidence / Note |
|---|---|---|
| Server-authoritative game state | ✅ | Rummy/High Card/Slots outcomes computed server-side; client only renders. |
| Server-authoritative deck / RNG | ✅ | `rng.py` commit–reveal (HMAC-Fisher–Yates); seeds committed before play; `/verify`. |
| Server-authoritative balance | ✅ | All balance moves in `wallet_service`/`bonus_service`; no client-supplied amounts on ledger. |
| Idempotency | ✅ (mostly) | `request_id` on credit/debit/transfer/reverse, casino entry/payout, bonus grants. ⚠️ **Slots spin & Lucky Spin generate a fresh id server-side per call → NOT idempotent against client double-submit** (guarded only by frontend `busy`). |
| Race-condition protection | 🟡 PARTIAL | Quota allocation uses atomic `find_one_and_update`+rollback ✅; balance debit uses conditional `{balance:{$gte}}` update ✅; Rummy uses optimistic `rev` ✅. BUT auto-assign capacity and a few count-then-write paths have documented races. |
| DB transactions (multi-doc) | ⚠️ NOT USED | `wallet_service.transfer` is **two separate ops** (debit then credit) with **no Mongo transaction** — if the credit fails after the debit commits, coins can be lost/stranded (no compensating rollback). |
| Negative-balance protection | ✅ | `debit` uses `{id, balance:{$gte:amount}}` guard → `InsufficientFunds` on shortfall. |
| Duplicate-reward protection | ✅ | Idempotent payout/bonus `request_id`s (`casino_payout:*`, `contest_payout:*`, `bonus_grant:*`). |
| Duplicate-settlement protection | ✅ | Fantasy `contest_payout:{id}:{user}`; settlements/payroll idempotent per period. |
| Replay protection | 🟡 | Ledger idempotency yes; **no JWT jti/nonce or token-replay defense** beyond expiry. |
| Rate limiting | 🟡 PARTIAL | Only **login** brute-force (`login_security.py`: per-email 5/15min, per-IP 20/15min). **No global API rate limiting** (no slowapi/limiter). Chatbot/spin/OTP-verify endpoints are un-throttled (OTP has attempt caps + resend cooldown internally). |
| Input validation | ✅ | Pydantic DTOs with `Field` constraints on request bodies. |
| Authorization checks | ✅ | `require_roles` + per-service scope (support scope, SA-only sensitive endpoints). |
| Audit logging | ✅ | `audit_logs` on privileged actions. |
| Secrets management | ✅ | JWT secret, encryption key, API keys from env; API keys encrypted-at-rest (Fernet). |

---

## 9. DATABASE — collections (from actual `db.<name>` usage)
**Users/auth:** `users`, `email_otps`, `login_attempts`, `security_alerts`.
**Wallet/ledger:** `wallets`, `ledger_transactions`, `practice_wallets`.
**Hierarchy/allocation:** `zonal_manager_allocations`, `manager_allocations`, `admin_allocations`, `admin_creation_requests`, `player_assignments`, `player_assignment_history`.
**Deposits/recharge/credit/revenue:** `deposits`, `admin_bank_accounts`, `admin_recharges`, `admin_credit_lines`, `admin_credit_ledger`, `admin_credit_requests`, `settlements`, `daily_summaries`.
**Bonus/rewards/loyalty:** `bonus_grants`, `bonus_debits`, `bonus_config`, `surprise_boxes`, `surprise_box_config`, `festival_claims`, `promo_codes`, `promo_redemptions`, `referrals`, `referral_config`, `player_progression`, `xp_events`, `vip_config`, `player_inventory`.
**Casino/games:** `casino_tables`, `casino_rounds`, `casino_rake_ledger`, `casino_spins`, `player_game_seeds`, `revealed_game_seeds`, `slots_config`.
**Fantasy:** `fantasy_contests`, `fantasy_teams`, `fantasy_player_pool`, `fantasy_scoring_config`, `contest_entries`, `match_previews`, `ai_suggestions`.
**Support/notifications/profile/branding:** `support_tickets`, `support_ticket_messages`, `notifications`, `player_profiles`, `chatbot_sessions`, `api_keys`, `audit_logs`, `status_checks`.

**Relationships (by app-level id refs, no FKs):**
- `users.id` ← referenced by nearly all collections (`user_id`/`player_id`/`admin_id`/`manager_id`/`zonal_manager_id`/`created_by`).
- `player_assignments`: `player_id → admin_id` (drives grants, ticket routing, deposit agent).
- Allocation chain: `zonal_manager_allocations.user_id` → `manager_allocations.zonal_manager_id` → `admin_allocations.manager_id` → `player_assignments.admin_id`.
- `wallets.user_id → users.id`; `ledger_transactions.user_id/wallet_id`.
- `casino_rounds.table_id → casino_tables.id`; `casino_spins.user_id`, seeds by `user_id`+hash.
- `fantasy_teams.(contest_id,user_id)` → `fantasy_contests.id` (unique index = 1 team/user/contest).
- `support_ticket_messages.ticket_id → support_tickets.id`; `chatbot_sessions.(user_id,session_id)` → escalated ticket_no.

---

## 10. API (method + path; all under `/api`)
**auth:** POST `/auth/register`, `/auth/verify-otp`, `/auth/resend-otp`, `/auth/login`, `/auth/activity`; GET `/auth/me`; PUT `/auth/console-theme`, `/auth/rummy-theme`.
**wallet:** GET `/wallet/me`, `/wallet/surprise-box`, `/wallet/recharge-offer`, `/wallet/deposit-info`, `/wallet/my-agent`, `/wallet/deposits`; POST `/wallet/surprise-box/open`, `/wallet/deposit-request`.
**admin (34):** managers CRUD/quota/fund; `/admin/admins`; `/admin/allocate`; `/admin/grant`; `/admin/players/assign`; `/admin/my-players`, `/admin/my-admins`, `/admin/my-allocation`, `/admin/players`; `/admin/overview`, `/admin/coin-supply`, `/admin/transactions`, `/admin/transactions/{id}/reverse`; deposits list/screenshot/confirm/reject; profile/whatsapp; bank-accounts (list/create/activate); `/admin/admins/{id}/revenue-split`; settlements list/settle; daily-summary(+export); recharge-request/my-recharges/recharge-info.
**zonal (17):** zonal-managers CRUD/quota/fund/payroll; `/admin/zonal/my-allocation|my-managers|managers|fund-manager|my-payroll`; managers max-admins/payroll; admin-requests submit/list/approve/reject.
**casino (26):** catalog, practice/balance, progression/me, tables CRUD/join/leave/start/state, rounds/{id}/verify; **slots** config/seed/seed.client/seed.rotate/spin/history/verify; admin slots-config (GET/PUT), rake, commission-report(+trend/csv/pdf), vip-config (GET/PUT).
**rummy (9):** tables/{id}/state|start|draw|discard|declare|drop|heartbeat, rounds/{id}/verify, quick-match.
**chatbot (3):** POST `/chatbot/message`, `/chatbot/escalate`; GET `/chatbot/session/{id}`.
**support (11):** player tickets (create/list/detail/messages); admin tickets (list/reply/status/escalate); helpers (create/list/status).
**games (5):** inventory, spin, store/buy, store/equip, contest/join.
**fantasy (6 player):** matches, fixtures/{id}/players, contests, contests/{id}, contests/{id}/join, my-contests. **fantasy-admin router** (`/admin/fantasy/*`): scoring-config + contests create/settle/cancel/player-credit (SA/Admin scoped).
**bonus (8):** me, festival(+claim), config (GET/PUT), grant, surprise-box-config (GET/PUT).
**referrals (4):** me, admin/config (GET/PUT), admin/stats.
**profile (4):** me/profile (GET/PUT), admin/players/lookup, admin/players/{id}/sensitive.
**branding (6):** self branding (GET/PUT/logo), per-admin branding (GET/PUT/logo) + public `/public/branding/{slug}(/logo)`.
**security (2):** login-alerts (GET), login-alerts/resolve (POST).
**superadmin (3):** recharges (GET), recharges/{id}/confirm|reject.
**admin_credit (9):** me, request, report, admin/{id}/limit|revoke|repay|ledger, requests/{id}/approve|reject.
**api_keys (5):** create/list (`/admin/api-keys`), test, {id}/test, {id} DELETE.
**promo (1):** apply. **notifications (2):** list (GET) + read. **cricket (2):** live, matches.
**server.py inline:** fantasy/coach, match/preview, + status checks.
**WebSocket/realtime events:** **NONE.**

---

## 11. TESTS (`/app/backend/tests`, pytest)
**Present (36 files):** auth/wallet/admin (`test_royal11_auth_wallet_admin`, `test_console_admin`, `test_console_theme`), zonal hierarchy (`test_zonal_manager_hierarchy`), deposits/referrals (`test_royal11_deposits_referrals`, `test_referral_notify`, `test_royal11_recharge_part5`), OTP/brute-force (`test_otp_and_security`, `test_login_security`), bonus/VIP/surprise/festival/promo (`test_bonus`, `test_vip_recharge`, `test_surprise_box`, `test_festival`, `test_promo_iter25`), OCR/bank (`test_ocr_service`, `test_deposit_screenshot_ocr`, `test_multi_bank_upi`), payroll (`test_payroll_whatsapp_banklabel`, `test_games_payroll_iter16`), branding (`test_branding`), casino (`test_casino`, `test_casino_join_fix_iter27`, `test_commission_report`), rummy (`test_rummy`, `test_rummy_phase1_flow`), slots (`test_slots`, `test_iter30_slots_chatbot_mint`), fantasy (`test_fantasy`, `test_fantasy_coach`, `test_fantasy_demo`, `test_fantasy_e2e_iter24`, `test_fantasy_endpoints_iter17`), support/profile (`test_royal11_iter23_support_referral_profile`), `test_iter26_endpoints`.
**Coverage strengths:** coin ledger + hierarchy allocation, bonus playthrough, rummy rules + one full flow, slots math + spin/mint/chatbot, fantasy settlement, OTP/brute-force, commission report.
**Zero / thin coverage:** ❌ `wallet_service.transfer` partial-failure/rollback; ❌ Rummy multi-timeout auto-drop & abandoned-table cleanup; ❌ concurrency/race (parallel allocate/grant, double-spin); ❌ `admin_credit_service` edge cases; ❌ chatbot read-only guarantee as a unit test (only exercised live); ❌ **no frontend tests at all**; ❌ authz negative tests are sparse for many newer routers.

---

## 12. PRODUCTION READINESS
- User registration/login/OTP — ✅ COMPLETE (JWT + bcrypt + email OTP + brute-force lockout).
- Roles/RBAC — ✅ COMPLETE (`require_roles` enforced).
- Account status / ban — 🟡 PARTIAL (DISABLED/SUSPENDED enforced, but no manual ban/disable endpoint/UI).
- Rummy engine — 🟡 PARTIAL (Points only; Pool & Deals ❌; abandoned-table cleanup thin).
- Realtime — 🟡 PARTIAL (polling works; no WebSockets; no duplicate-connection handling).
- Coin ledger & idempotency — 🟡 PARTIAL (strong idempotency, but spins not idempotent to double-submit).
- Coin transfer atomicity — ⚠️ IMPLEMENTED BUT UNSAFE (no Mongo multi-doc transaction around debit+credit).
- Hierarchy/allocation — ✅ COMPLETE for the 5-level model (⚠️ mismatch vs your 4-level target — ZM tier extra).
- Admin system — ✅ COMPLETE (all tiers wired + audit logs).
- Anti-cheat (server-authoritative + provably fair) — ✅ COMPLETE.
- Rate limiting — 🟡 PARTIAL (login only; no global limiter).
- DB race conditions — 🟡 PARTIAL (atomic where it matters most; documented races in auto-assign).
- Withdrawal system — ❌ NOT IMPLEMENTED (by design; deposit inflow exists).
- Tests — 🟡 PARTIAL (broad backend unit coverage; no frontend/concurrency/transaction tests).

---

## 13. FINAL SUMMARY

### A. Already usable
- End-to-end auth (signup → OTP → login), JWT RBAC, and the full **Super Admin → (Zonal) Manager → Admin → Player** coin-allocation chain with atomic quota reservation and audit logs.
- **Points Rummy** (2–6 seats), **High Card**, and **777 Slots** — all server-authoritative + provably fair with `/verify`.
- Coin ledger (credit/debit/transfer/reverse) with idempotency + negative-balance guards; bonus rail with playthrough; deposits (manual real-money top-up) with OCR; VIP/referral/festival/promo/surprise-box; Fantasy contests with settlement; support tickets + Q JOKER chatbot; full role-based Console.

### B. Needs fixing
1. **Wallet transfer atomicity** — wrap debit+credit in a Mongo transaction or add a compensating rollback (currently can strand coins on partial failure).
2. **Spin idempotency** — accept a client-supplied idempotency key for `/slots/spin` and Lucky Spin to prevent double-submit double-charges.
3. **Auto-assign capacity race** — make the capacity check atomic (conditional update) instead of count-then-insert.
4. **Manual account ban/disable** — add an SA/Admin endpoint+UI to set DISABLED/SUSPENDED (enforcement exists; the action doesn't).
5. **Abandoned-table cleanup** — add a sweeper to void/settle tables where all-but-one player has dropped/timed out.

### C. Needs to be built
- **Pool Rummy (101/201) and Deals Rummy** (only Points exists).
- **WebSocket realtime** (optional but expected for a card room) + duplicate-connection/single-session handling.
- **Global API rate limiting** (spin/chatbot/deposit/OTP-verify).
- Broader **authz negative tests**, **concurrency tests**, and **any frontend tests**.
- If the 4-level model is the target: a decision to disable/remove the **Zonal Manager** tier.

### D. Security vulnerabilities (specific)
- **`app/wallet_service.py:152 transfer`** — non-atomic debit+credit (no session/transaction). Partial failure = inconsistent balances. **HIGH.**
- **`app/games/slots_service.py:150-159`** & **`app/game_service.py` spin** — server-generated per-call `request_id` → **no protection against rapid double-spin** (only UI `busy`). **MEDIUM.**
- **`app/assignment_service.py:17 auto_assign_player`** — count-then-insert capacity race (self-documented). **LOW/MEDIUM.**
- **No global rate limiting** — only `login_security`. Chatbot (`/chatbot/message`) hits the paid LLM with no throttle → cost/abuse risk. **MEDIUM.**
- **No manual ban path** — a compromised/abusive player cannot be locked out on demand (only DISABLED via DB or programmatic SUSPEND). **MEDIUM.**
- **JWT** — no refresh/rotation/`jti` revocation list; a leaked token is valid until expiry. **LOW/MEDIUM.**
- Note (not a vuln): real-money **deposit inflow** exists (`/wallet/deposit-request`) — contradicts a strict "no real-money payment system" reading; confirm intended.

### E. Architecture problems
- **No multi-document transactions** anywhere despite money movement spanning 2+ docs (transfer, allocate+wallet, grant). Relies on ordering + idempotency + optimistic rollback rather than ACID.
- **No ODM/schema layer** — raw dicts + Enums; schema drift risk across ~55 collections; no migrations framework (ad-hoc index/backfill in `server.py` startup).
- **Polling-based realtime** — fine at low scale, but N clients × 1.5s polls will pressure Mongo as tables grow; no push/backpressure.
- **`admin.py` router is large (~760 lines / 34 endpoints)** mixing managers/admins/deposits/settlements/recharge — should be split (already flagged in PRD backlog).
- **Hierarchy ambiguity** — 5-level code vs 4-level intent; "quota" (authorized_quota) and "wallet balance" are two separate gates that must both be satisfied, which is powerful but easy to misconfigure (funded wallet=0 blocks allocation even with quota).

### F. Recommended next development order
1. **Money-safety hardening first:** wrap `transfer`/`allocate`/`grant` in Mongo transactions (or compensating rollback) + add spin idempotency keys. (Highest risk, touches real balances.)
2. **Decide & align the hierarchy** (4-level vs keep ZM) before building more admin features on top.
3. **Account lifecycle:** manual ban/suspend/reactivate endpoints + UI; abandoned-table sweeper.
4. **Global rate limiting** (especially LLM chatbot + auth-adjacent + spin).
5. **Rummy variants** (Pool, then Deals) if product needs them.
6. **Realtime upgrade** (WebSockets) once money-safety + hierarchy are locked.
7. **Test debt:** concurrency/transaction tests, authz negative tests, and a minimal frontend test harness.

---
*End of audit. No source files were modified; this report is the only file created.*
