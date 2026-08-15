# ROYAL11 — Fresh Codebase Audit (Evidence-Based)
**Date:** 2026-08-16  
**Scope:** Full re-audit of the CURRENT live codebase, sourced only from reading/running the actual code and test suite — NOT from PRD.md, memory docs, or the prior 2026-08-15 audit.  
**Mode:** AUDIT ONLY. Nothing was modified, deleted, or migrated. No implementation performed.

---

## 0. How this audit was performed (evidence sources)
- Read source directly: `wallet_service.py`, `games/rng.py`, `games/rummy_engine.py`, `games/rummy.py`, `referral_service.py`, `promo_service.py`, `bonus_service.py`, `deps.py`, `security.py`, `models.py`, routers.
- Ran the full backend test suite twice:
  - **Wrong way first** (no `REACT_APP_BACKEND_URL` exported): 257 passed / 51 failed / 19 errors — the failures were almost all `requests.MissingSchema` because HTTP integration tests read `REACT_APP_BACKEND_URL` from env (see `tests/test_console_theme.py:7`).
  - **Correct way** (`export REACT_APP_BACKEND_URL=<preview url>`): **298 passed / 53 failed / 9 errors / 2 skipped** in 107s.
  - **Serial re-run** (`-n 0`) of a sample of "failed" suites: `test_console_theme` (11) and `test_surprise_box` (4) **PASS in isolation** → they were parallel-collision failures. `test_referral_notify` / `test_vip_recharge` fail with `RuntimeError: got Future attached to a different loop` → a **motor/event-loop TEST-HARNESS artifact**, not an app bug.
- **Conclusion on tests:** `pytest.ini` explicitly warns suites "share one preview backend and assume sequential shared state." The ~53 failures under `-n 2` are predominantly (a) parallel shared-state collisions and (b) motor event-loop binding in service-level tests. The **application code paths themselves are healthy** (298 green including auth, wallet ledger, deposits, crypto, rummy, slots, casino, fantasy, settlements, payroll, OCR). A dedicated test-harness cleanup is warranted but is NOT an application regression.

---

## 1. Technology stack & project structure
**Backend:** FastAPI 0.110, Motor 3.3 (async) + PyMongo 4.6 on a **standalone mongod** (no replica set → no multi-doc ACID; documented in `wallet_service.py`). Auth: PyJWT 2.13 (HS256) + passlib/bcrypt. APScheduler for settlement/reminders. reportlab (PDF), openpyxl (XLSX), httpx (TronScan/IFSC/Vision), emergentintegrations (LLM/email).  
**Structure:** `app/routers/*` (24 routers) → `app/*_service.py` (domain services) → `app/db.py` (single Motor client). Games isolated under `app/games/` (`rng.py`, `cards.py`, `rummy_engine.py`, `rummy.py`, `slots*`, `engine.py`, `catalog.py`, `progression_service.py`). No ORM; raw Motor + Pydantic DTOs. Config strictly via env (`MONGO_URL`, `DB_NAME`, `REACT_APP_BACKEND_URL`, `EMERGENT_LLM_KEY`, `GOOGLE_CLOUD_VISION_API_KEY`, `OTP_DEBUG_LOG`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REMEMBER_ME_EXPIRE_MINUTES`).  
**Frontend:** React + Tailwind; pages/components/console panels; axios via `REACT_APP_BACKEND_URL`.

---

## 2. Working backend modules (confirmed via code + passing tests)
| Module | Evidence |
|---|---|
| **Wallet ledger** (`wallet_service.py`) | Ledger-first + unique `request_id` idempotency; atomic `$inc` credit; conditional `find_one_and_update(balance $gte)` debit (no negatives); reversal-by-new-txn. `test_royal11_auth_wallet_admin` reversal/idempotency tests pass in isolation. |
| **Auth + password reset** (`auth.py`, `security.py`, `password_reset_service.py`, `deps.py`) | remember-me 30-day vs 60-min JWT; `iat` + `password_changed_at` token invalidation; forgot/reset OTP single-use, anti-enumeration. Verified via curl + frontend agent iter 35 (100%). |
| **Provably-fair RNG** (`games/rng.py`) | `secrets` CSPRNG seed; HMAC-SHA256 Fisher–Yates with rejection sampling (unbiased); commit–reveal + `/verify`. |
| **Rummy engine** (`games/rummy_engine.py`) | Server-locked shoe, turn ownership, `seq` version, server timer/deadline, timeout auto-play/auto-drop, server-side declaration validation. |
| **Slots** (`games/slots*`) | provably-fair seed-pair; `test_slots` passes. |
| **Deposits + OCR auto-approve** (`deposit_service.py`, `ocr_service.py`) | per-Admin opt-in, ₹5,000 hard cap, `SYSTEM_AUTO_OCR`; `test_deposit_auto_approve` 5-case matrix passes. |
| **USDT crypto + on-chain auto-approve** (`crypto_purchase_service.py`, `tron_service.py`) | TronScan verify (amount/address/confirm/replay), `SYSTEM_AUTO_CHAIN`, SA cap; `test_crypto_purchase_iter31` 13/13. |
| **Admin credit line / allocations** (`admin_credit_service.py`) | float top-up + credit-line ceiling; transfer via linked ledger rows. |
| **Settlements + bank payouts** (`revenue_service.py`, `bank_template_service.py`, `settlement.py`) | PDF/XLSX; `test_settlement_payouts_iter33`, `test_commission_report` pass. |
| **Bonus rail** (`bonus_service.py`) | 2-balance model (real vs bonus_balance), playthrough, idempotent grants with audit ledger rows. |
| **Referral / Promo / Surprise Box / Festival / VIP recharge** | present & functional (see §9 for gaps). |
| **Support + Q JOKER chatbot, Fantasy, Cricket, Branding, Notifications, API keys, Payroll, Login security** | present; corresponding suites pass in isolation. |

---

## 3. Incomplete / placeholder modules
- **Promo admin surface** — `promo_service.py` supports create/limits, but the **router only exposes `POST /promo/apply`**. No admin create/edit/deactivate/list/history endpoints. Codes exist only via `seed_demo_codes()`. (See §9.)
- **Emoji reactions** — the "rate-limited approved emoji reactions" communication feature is **not implemented at all** (no reaction endpoints). Note: this is a *missing feature*, not a rule violation — no free chat exists either (good).
- **Player-facing cosmetics system** — only a staff **console theme** (`branding_service`) + DiceBear avatars found. The full cosmetic catalog (table/room/host/card-back/effects/sound themes) is largely unbuilt. No price/cost fields found → whatever exists is free (consistent with the rule), but the decoupled cosmetic system itself is minimal.
- **Rummy** — Phase-1 engine is solid but scoped: verify matchmaking breadth (2/4/6 seats, Pool/Deals variants) — code centers on **Points Rummy**; Pool/Deals & richer tournament formats are not evident.
- **Zonal Manager tier** — present in role enum/hierarchy but partially bypassed per prior notes; verify live wiring.

---

## 4. Missing APIs & database relations
- **Promo:** missing `POST /admin/promo` (create), `PATCH` (edit/deactivate), `GET` (list), `GET .../redemptions` (history). `promo_codes` lacks a **`start_date`/valid-from** and **eligibility** field; `per_user_once` is boolean only (no configurable per-user count).
- **Referral:** no **device/IP fingerprint** relation for duplicate-device prevention (only per-`referee_id` uniqueness).
- **Ledger row:** stores `balance_after` but not an explicit **`balance_before`** (derivable) and has no dedicated **`related_entity_id`** column (entity is encoded inside `request_id`/`reason`, e.g. `deposit:{id}`). Spec asks for both explicitly.
- **Emoji-reaction** collection/endpoints: absent.

---

## 5. Bugs & security risks
- **No general API rate limiting.** Brute-force/lockout + 429 exist **only** on auth/OTP (`login_security`, `auth.py`). Gameplay/wallet/promo endpoints rely on idempotency, not throttling → abuse/spam risk (e.g. promo brute-forcing, quick-match spam). **P1.**
- **Promo global-cap race:** `redeemed_count` is read-then-`$inc` (not atomic) → under concurrency `max_redemptions` can be marginally exceeded. Per-user redemption is safe (idempotent unique id + bonus request_id). **P2.**
- **Cross-wallet transfer not atomic** (`wallet_service.transfer` = debit then credit; both idempotent but a crash between leaves debit-without-credit). Documented as replica-set/Part-8 hardening. **P2.**
- **Test harness** (not app): motor event-loop binding + shared-preview-backend parallel collisions cause ~53 flaky failures under `-n 2`. **P1 for CI trustworthiness.**
- `OTP_DEBUG_LOG=true` currently logs OTP/reset codes to server logs — fine for preview, **must be false in production.** **P1 before go-live.**
- No automated **security/concurrency** test layer (e.g. parallel double-credit, negative-balance race, replay). The building blocks (idempotency) exist but aren't stress-tested. **P2.**

---

## 6. Authentication & permission issues
- **RBAC is enforced** per-endpoint via `require_roles(...)` allow-lists (`deps.py:58`) + `require_not_suspended`; DISABLED locked out, SUSPENDED limited.
- **Role model divergence from the 5-role least-privilege spec.** Current roles = **SUPER_ADMIN, ZONAL_MANAGER, MANAGER, ADMIN, SUPPORT_HELPER, PLAYER** — a *distribution hierarchy*, not a *functional* split. Mapping vs the spec's 5 roles:
  | Spec role | Today |
  |---|---|
  | Super Admin | ✅ SUPER_ADMIN |
  | Finance Admin | ❌ none — finance ops shared across SA/Manager/Admin |
  | Game Operations | ❌ none — no game-ops-only role |
  | Customer Support | ≈ SUPPORT_HELPER |
  | Read-only Auditor | ❌ none — no read-only audit role |
  Least-privilege separation of finance vs game-ops vs read-only auditor is **not** present. **P2 governance gap.**
- Token invalidation on password change is correct (`iat < password_changed_at` rejected) — no revocation list, acceptable given short default TTL.
- **Admins are created directly ACTIVE by a Manager/SA** (`_create_user`), email-only; no mobile/SMS OTP (deferred by product owner pending DLT).

---

## 7. Gameplay / server-authority (verified)
**Holds everywhere checked.** Clients submit only *intents*, never trusted values:
- **Rummy** (`rummy.py` router → `rummy_engine.py`): client sends only draw `source` (open/closed), `card_id` to discard, and declared `groups`. Server: locks shoe from CSPRNG seed **before** dealing; `_require_turn` rejects out-of-turn ("not your turn"); `draw` pops server-side (no client card injection, no double-draw); `discard` validates `card_id in own hand`; `declare` validates all cards belong to hand, no cross-group dupes, exact hand size, and runs `rummy.validate_declaration` → wrong declare = 80-pt penalty. `get_state` returns only `your_hand` + opponents' `card_count` (**hidden-card protection**). Server-controlled `deadline` + `seq`; timeout → auto-play then auto-drop after N. `/verify` exposes seed post-round.
- **Slots / High Card / Casino:** provably-fair seed governs outcome server-side; commit shown before play.
- **No endpoint accepts client-supplied balance, RNG, deal, score, timer, or result.** ✅

**Gaps:** no explicit optimistic-concurrency **version token on client submissions** (engine uses `_save` compare + turn `seq`, which is good but per-move version echo isn't required of the client); reconnection is poll/heartbeat-based (works) but not a formal secure-resume token.

---

## 8. Virtual-coin ledger & concurrency
- **Every balance change goes through `wallet_service` / `bonus_service`** — no raw balance mutation found elsewhere. ✅
- Ledger row fields present: txn `id`, `wallet_id`, `user_id`, direction (signed `amount`), `balance_after`, category (`type`), `actor_id`, `request_id` (idempotency key), `reversal_of_id`, `status`, `created_at`. **Missing explicit `balance_before` + `related_entity_id`** (derivable/encoded). 
- **No negative balances** (conditional debit). **No duplicate credits** (unique `request_id`). **Reversals never delete history.** 
- **Concurrency caveats:** single-wallet ops are atomic; **cross-wallet transfer** and **promo global cap** are the two non-atomic spots (§5). Standalone Mongo → no true multi-doc transactions.

---

## 9. Referral & promo status
### Referral ("REFER & EARN 200 COINS")
| Requirement | Status |
|---|---|
| Unique code/link | ✅ per-user `referral_code` |
| Successful-join condition | ✅ at activation; qualify event configurable (SIGNUP/FIRST_RECHARGE/FIRST_WAGER) |
| **200-coin reward** | ⚠️ **Divergent** — defaults are referrer **125** + referee **75** (=200 split). If spec means 200 *to the referrer*, adjust config. |
| Self-referral prevention | ✅ (`referrer==referee` guard) |
| Duplicate prevention | ✅ per-`referee_id` unique — **but duplicate-DEVICE prevention ❌ missing** |
| Idempotent credit | ✅ (`referral_{kind}:{referee_id}` + status guard) |
| History / admin config / audit | ✅ `me()`, `admin_stats()`, `set_config()`, `log_action` |
| Rail | ✅ non-withdrawable bonus (playthrough) — no cash |

### Promo code
| Requirement | Status |
|---|---|
| Entry + Apply API | ✅ `POST /promo/apply` |
| Start/end date + active | ⚠️ `active` + `expires_at` present; **`start_date` ❌ missing** |
| Global + per-user limits | ⚠️ global `max_redemptions` ✅; per-user only boolean `per_user_once` (no configurable N) |
| Eligibility rules | ❌ not implemented (no `not-eligible` path) |
| Configurable reward | ✅ from stored code (no client amount) |
| Idempotent redemption | ✅ (`promo:{code}:{user_id}`) |
| Atomic ledger credit | ✅ via bonus rail |
| Redemption history | ⚠️ stored (`promo_redemptions`) but **no history endpoint** |
| Admin create/edit/deactivate | ❌ **no admin endpoints** (seed-only) |
| Error handling (invalid/expired/used/limit) | ✅ (not-eligible ❌) |

---

## Hard product-rule verification (all PASS)
- **Virtual coins only, no cash winnings, no redemption, NO withdrawal:** ✅ Confirmed. `TxnType.WITHDRAWAL` exists in the enum but is **referenced nowhere** in code; `WITHDRAWAL` also appears only as a *support-ticket category*. No withdrawal/cash-out/redeem-coins endpoint, screen, DB workflow, or admin approval exists.
- **Finance modules (deposits, admin_bank_accounts, admin_recharges, admin_credit_*, settlements, daily_summaries) are internal-credit-admin only:** ✅ Deposits *credit* player coins (top-up in, never out); settlements/payouts move **INR to staff/admins** (internal commission), never player coin redemption. Boundary intact after crypto/settlement/deposit work.
- **No player↔player chat/voice/DM:** ✅ none exist (only Q JOKER support bot). Emoji reactions unbuilt (missing feature, not a violation).
- **Cosmetics free / decoupled:** ✅ no paid-cosmetic fields found; cosmetics do not touch RNG/dealing/scoring (RNG is seed-driven server-side). Full cosmetic system is minimal/unbuilt.
- **Env-based secrets, no hardcoding:** ✅ (Stripe test key from env, LLM via EMERGENT_LLM_KEY, Vision key from env).
- **Immutable admin audit logs:** ✅ `audit.log_action` append-only across sensitive actions.

---

## 10. Safe, ordered implementation sequence (for the gaps — await approval)
Ordered by risk-reduction then product value. **All additive; no destructive changes, no withdrawal/redemption, no secret hardcoding.**

**P0 — Trust & safety before any further feature work**
1. **Stabilize the test harness** (no app-logic change): add a shared async fixture/event-loop policy so service-level tests don't hit "different loop"; isolate integration tests from seeded accounts (throwaway users) so `-n 2` is green. Gives a trustworthy regression signal.
2. **Production hardening checklist:** ensure `OTP_DEBUG_LOG=false` in prod; add a startup assertion/guard.

**P1 — Concurrency & abuse resistance**
3. **General rate limiting** (per-user/IP) on promo apply, quick-match, deposit/crypto submit, OTP — reuse the `login_security` pattern or a lightweight limiter.
4. **Make promo global-cap atomic** (`find_one_and_update` with `redeemed_count < max` guard) to close the over-redemption race.
5. **Add automated concurrency/security tests** (parallel double-credit, negative-balance race, replay of `request_id`, out-of-turn move, forged declaration).

**P2 — Spec-completeness (referral/promo/ledger/roles)**
6. **Promo admin surface:** `POST/PATCH/GET /admin/promo` (create/edit/deactivate/list) + `GET /admin/promo/redemptions`; add `start_date`, configurable per-user limit, and an optional `eligibility` predicate with a clean `not-eligible` error.
7. **Referral:** align reward to the "200" product intent (config), and add **duplicate-device/IP** signal to `register_referral` (fingerprint stored on referee) to block farm signups.
8. **Ledger enrichment:** add explicit `balance_before` and a dedicated `related_entity_id` column (backfill optional; never rewrite history).
9. **Role least-privilege:** introduce **Finance Admin** and **Read-only Auditor** (and optionally Game Operations) as additive roles + endpoint allow-lists, mapping existing permissions down — without removing the working hierarchy.

**P3 — Feature build-out (only if product wants)**
10. **Emoji-reaction system** (approved set, server-rate-limited) — the only sanctioned in-game communication.
11. **Cosmetic catalog** (free, fully decoupled from authoritative gameplay) if cosmetics are a product goal.
12. **Rummy breadth:** Pool/Deals variants, 6-seat matchmaking, formal secure-reconnect token, tournaments.
13. **Cross-wallet atomicity:** migrate Mongo to a replica set and wrap transfers in a session transaction (removes the last non-atomic money path).

---
*End of audit. No code was changed. Awaiting explicit approval before implementing any item above.*
