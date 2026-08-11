"""Tunable business constants for the coin top-up / revenue-share / settlement
system. Kept in one place so they're easy to change; several are surfaced as
per-Admin overrides elsewhere (e.g. revenue split lives on admin_allocations).
"""

# Part 1 — deposits
INR_TO_COIN_RATIO = 1  # 1 INR buys this many coins

# Part 5 — Admin self-recharge (Admin pays Super Admin directly for quota)
ADMIN_RECHARGE_BONUS_RATE = 1.5  # ₹100 paid → 150 coins credited

# Part 2 — revenue share + settlement
DEFAULT_SUPER_ADMIN_PCT = 70  # Super Admin's default share of an Admin's collections
SETTLEMENT_DUE_WEEKDAY = 2     # 0=Mon … 2=Wed → the Wednesday after the week ends

# Part 3 — balance-usage alert thresholds (percent of allocation used)
USAGE_WARN_PCT = 80
USAGE_DANGER_PCT = 90
USAGE_CRITICAL_PCT = 100  # fully used → auto-suspend until re-allocated

# Part 4 — referral + engagement
REFERRAL_BONUS_COINS = 200
INACTIVITY_NUDGE_DAYS = 2


# Suspension reasons (stored on the user doc so the Console can explain the state)
class SuspendReason:
    COINS_EXHAUSTED = "COINS_EXHAUSTED"
    SETTLEMENT_OVERDUE = "SETTLEMENT_OVERDUE"
