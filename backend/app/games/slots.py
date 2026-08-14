"""777 Slots — pure math + provably-fair outcome (no DB, no I/O).

A classic 3-reel, single-centre-payline slot. Each reel is a 32-stop virtual
strip built from per-symbol weights. The outcome for a spin is derived from the
seed-pair + nonce provably-fair model (see rng.spin_indices) BEFORE any reel
animation plays on the client — the animation only reveals an already-locked
result.

Default math targets the platform-wide ~30% RTP (70% house edge). The RTP for
3-of-a-kind on a single payline is Σ p_i^3 · M_i where p_i = weight_i / 32.
`rtp()` computes it so a pytest can assert it stays ~0.30 if the config changes.
"""
from __future__ import annotations

# Ordered high → low. Weights sum to the strip length (32 stops per reel).
DEFAULT_SYMBOLS: list[dict] = [
    {"key": "crown", "label": "Royal Crown", "weight": 1, "payout": 450.0},
    {"key": "seven", "label": "R11 Seven", "weight": 2, "payout": 66.0},
    {"key": "diamond", "label": "Diamond", "weight": 3, "payout": 22.0},
    {"key": "bell", "label": "Royal Bell", "weight": 4, "payout": 9.0},
    {"key": "star", "label": "Star", "weight": 6, "payout": 5.0},
    {"key": "coin", "label": "ROYAL11 Coin", "weight": 16, "payout": 1.6},
]

DEFAULT_CONFIG: dict = {
    "symbols": DEFAULT_SYMBOLS,
    "reels": 3,
    "strip_len": 32,
    "min_stake": 10,
    "max_stake": 5_000,
    "max_payout_cap": 2_000_000,
    "rake_pct": 70,  # informational; house edge is baked into the paytable
}


def build_strip(symbols: list[dict], strip_len: int) -> list[str]:
    """Expand weighted symbols into a fixed-length virtual reel strip."""
    strip: list[str] = []
    for s in symbols:
        strip.extend([s["key"]] * int(s["weight"]))
    # Pad/trim defensively so len == strip_len (weights should already sum to it).
    if len(strip) < strip_len:
        strip.extend([symbols[-1]["key"]] * (strip_len - len(strip)))
    return strip[:strip_len]


def rtp(symbols: list[dict], strip_len: int) -> float:
    """Return-to-player for 3-of-a-kind on one payline = Σ p^3 · payout."""
    total = 0.0
    for s in symbols:
        p = s["weight"] / strip_len
        total += (p ** 3) * s["payout"]
    return total


def evaluate(stops: list[int], strip: list[str], symbols: list[dict], stake: int,
             max_payout_cap: int) -> dict:
    """Map reel stops → symbols, decide the payline outcome + payout."""
    by_key = {s["key"]: s for s in symbols}
    result_syms = [strip[st % len(strip)] for st in stops]
    is_win = len(set(result_syms)) == 1
    win_key = result_syms[0] if is_win else None
    multiplier = by_key[win_key]["payout"] if is_win else 0.0
    payout = min(int(stake * multiplier), max_payout_cap) if is_win else 0
    return {
        "stops": stops,
        "symbols": result_syms,
        "is_win": is_win,
        "win_symbol": win_key,
        "is_jackpot": win_key == "crown",
        "multiplier": multiplier,
        "payout": payout,
    }
