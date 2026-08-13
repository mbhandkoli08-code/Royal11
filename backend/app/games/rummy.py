"""13-card Indian Rummy — pure rules engine (no DB, no I/O).

This module is the SINGLE source of truth for meld validation + scoring. The
frontend mirrors the same algorithm in `lib/rummy.js` for instant live
meld-assistance, but the server ALWAYS re-validates a declaration here — the
client feedback is only a UX aid, never authoritative.

Card model (a dealt instance):
    {"id": "c17", "code": "Ts", "rank": "T", "suit": "s", "printed_joker": False}
A "printed joker" has code "JK" (rank/suit None). A card is a JOKER for melding
if it is a printed joker OR its rank equals the round's wild rank.

Duplicate-card handling (2-deck shoe): every dealt card is a distinct instance,
so TWO pure sequences using identical values (e.g. 5s6s7s twice) are BOTH valid.
Sets still require DISTINCT suits among natural (non-joker) cards.
"""

# Point values: face cards + T + A = 10, pips = face value, jokers = 0.
_BASE = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
         "T": 10, "J": 10, "Q": 10, "K": 10, "A": 10}
# Sequence ordering value (A handled specially as 1 or 14).
_SEQ = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
        "T": 10, "J": 11, "Q": 12, "K": 13}
MAX_POINTS = 80


def is_joker(card: dict, wild_rank: str | None) -> bool:
    return bool(card.get("printed_joker")) or (wild_rank is not None and card.get("rank") == wild_rank)


def card_points(card: dict, wild_rank: str | None) -> int:
    if is_joker(card, wild_rank):
        return 0
    return _BASE.get(card.get("rank"), 0)


def _naturals_fit_run(rank_letters: list[str], total_len: int) -> bool:
    """Can the given natural ranks (same suit assumed) sit inside a consecutive
    window of `total_len` ranks, with distinct positions? Jokers fill the rest.
    Ace may be low (A,2,3) or high (Q,K,A) — never round-the-corner (K,A,2)."""
    aces = rank_letters.count("A")
    if aces > 1:
        return False
    others = [r for r in rank_letters if r != "A"]
    vals = [_SEQ[r] for r in others]
    if len(set(vals)) != len(vals):  # duplicate non-ace rank in a run
        return False
    candidates = [vals] if aces == 0 else [vals + [1], vals + [14]]
    for cand in candidates:
        if not cand:
            return True
        s = sorted(cand)
        if len(set(s)) != len(s):
            continue
        if s[-1] - s[0] <= total_len - 1 and s[0] >= 1 and s[-1] <= 14:
            return True
    return False


def is_pure_sequence(cards: list[dict], wild_rank: str | None) -> bool:
    """3+ same-suit consecutive cards with NO printed joker (a wild-rank card in
    its natural position is allowed and keeps the sequence pure)."""
    if len(cards) < 3:
        return False
    if any(c.get("printed_joker") for c in cards):
        return False
    if len({c["suit"] for c in cards}) != 1:
        return False
    ranks = [c["rank"] for c in cards]
    if len(set(ranks)) != len(ranks):
        return False
    return _naturals_fit_run(ranks, len(cards))


def is_sequence(cards: list[dict], wild_rank: str | None) -> bool:
    """3+ cards forming a run of one suit, jokers substituting missing cards."""
    if len(cards) < 3:
        return False
    naturals = [c for c in cards if not is_joker(c, wild_rank)]
    if not naturals:
        return True  # all jokers → treated as a valid (impure) run
    if len({c["suit"] for c in naturals}) != 1:
        return False
    return _naturals_fit_run([c["rank"] for c in naturals], len(cards))


def is_set(cards: list[dict], wild_rank: str | None) -> bool:
    """3-4 cards of the same rank with DISTINCT suits; jokers substitute."""
    if len(cards) not in (3, 4):
        return False
    naturals = [c for c in cards if not is_joker(c, wild_rank)]
    if not naturals:
        return True
    if len({c["rank"] for c in naturals}) != 1:
        return False
    suits = [c["suit"] for c in naturals]
    return len(set(suits)) == len(suits)  # no duplicate suit among naturals


def classify_group(cards: list[dict], wild_rank: str | None) -> dict:
    """Label a group: pure_seq / impure_seq / set / invalid."""
    if is_pure_sequence(cards, wild_rank):
        return {"type": "pure_seq", "is_sequence": True, "is_pure": True, "valid": True}
    if is_sequence(cards, wild_rank):
        return {"type": "impure_seq", "is_sequence": True, "is_pure": False, "valid": True}
    if is_set(cards, wild_rank):
        return {"type": "set", "is_sequence": False, "is_pure": False, "valid": True}
    return {"type": "invalid", "is_sequence": False, "is_pure": False, "valid": False}


_LABELS = {"pure_seq": "Pure Sequence", "impure_seq": "Sequence", "set": "Set", "invalid": "Invalid"}


def label_for(type_: str) -> str:
    return _LABELS.get(type_, "Invalid")


def validate_declaration(groups: list[list[dict]], wild_rank: str | None,
                         expected_cards: int = 13) -> dict:
    """Authoritative check of a submitted grouping.

    Rules: every card grouped exactly once (expected_cards total), every group a
    valid sequence/set, at least 2 sequences of which at least 1 is pure.
    Returns {valid, reason, breakdown:[{type,label,is_pure,valid,card_ids}]}.
    """
    breakdown = []
    total = 0
    for g in groups:
        info = classify_group(g, wild_rank)
        info = {**info, "label": label_for(info["type"]), "card_ids": [c["id"] for c in g]}
        breakdown.append(info)
        total += len(g)

    result = {"breakdown": breakdown}
    if total != expected_cards:
        return {**result, "valid": False, "reason": f"All {expected_cards} cards must be grouped"}
    if any(not b["valid"] for b in breakdown):
        return {**result, "valid": False, "reason": "One or more groups is not a valid sequence or set"}
    seqs = sum(1 for b in breakdown if b["is_sequence"])
    pures = sum(1 for b in breakdown if b["is_pure"])
    if pures < 1:
        return {**result, "valid": False, "reason": "You need at least one pure sequence"}
    if seqs < 2:
        return {**result, "valid": False, "reason": "You need at least two sequences (one must be pure)"}
    return {**result, "valid": True, "reason": "Valid declaration"}


# ---------------------------------------------------------------------------
# Deadwood scoring for non-winners (greedy heuristic — deterministic & fair).
# ---------------------------------------------------------------------------
def _extract_pure_runs(cards: list[dict]) -> tuple[list[list[dict]], list[dict]]:
    """Greedily pull maximal same-suit consecutive runs (len>=3) from naturals."""
    melds: list[list[dict]] = []
    remaining = list(cards)
    by_suit: dict[str, list[dict]] = {}
    for c in remaining:
        by_suit.setdefault(c["suit"], []).append(c)
    used_ids = set()
    for suit, cs in by_suit.items():
        # order by seq value; A both ends
        def val(c):
            return 14 if c["rank"] == "A" else _SEQ[c["rank"]]
        uniq = {}
        for c in sorted(cs, key=val):
            uniq.setdefault(val(c), c)  # one per rank value in a run
        vals = sorted(uniq.keys())
        run: list[dict] = []
        prev = None
        for v in vals:
            if prev is not None and v == prev + 1:
                run.append(uniq[v])
            else:
                if len(run) >= 3:
                    melds.append(run)
                    used_ids.update(c["id"] for c in run)
                run = [uniq[v]]
            prev = v
        if len(run) >= 3:
            melds.append(run)
            used_ids.update(c["id"] for c in run)
    leftover = [c for c in cards if c["id"] not in used_ids]
    return melds, leftover


def _extract_sets(cards: list[dict], jokers: list[dict]) -> tuple[list[list[dict]], list[dict], list[dict]]:
    """Greedily form sets (same rank, distinct suits, len>=3) padding with jokers."""
    melds: list[list[dict]] = []
    by_rank: dict[str, list[dict]] = {}
    for c in cards:
        by_rank.setdefault(c["rank"], []).append(c)
    used = set()
    jk = list(jokers)
    for rank, cs in by_rank.items():
        seen_suits: dict[str, dict] = {}
        for c in cs:
            if c["suit"] not in seen_suits:
                seen_suits[c["suit"]] = c
        group = list(seen_suits.values())
        if len(group) >= 3:
            melds.append(group[:4])
            used.update(c["id"] for c in group[:4])
        elif len(group) == 2 and jk:
            g = group + [jk.pop()]
            melds.append(g)
            used.update(c["id"] for c in g)
    leftover = [c for c in cards if c["id"] not in used]
    return melds, leftover, jk


def best_deadwood(cards: list[dict], wild_rank: str | None) -> int:
    """Minimum-ish points of a losing hand under the standard scoring gate:
    no pure sequence → full count; a pure sequence but <2 sequences → only
    sequences reduce points; otherwise all valid melds reduce points."""
    jokers = [c for c in cards if is_joker(c, wild_rank)]
    naturals = [c for c in cards if not is_joker(c, wild_rank)]

    pure_runs, after_pure = _extract_pure_runs(naturals)
    sets, after_sets, _jk = _extract_sets(after_pure, jokers)

    sequences = list(pure_runs)  # (impure-sequence extraction omitted in MVP heuristic)
    if not pure_runs:
        counted: list[list[dict]] = []
    elif len(sequences) < 2:
        counted = sequences
    else:
        counted = sequences + sets

    melded_ids = {c["id"] for g in counted for c in g}
    dead = sum(card_points(c, wild_rank) for c in cards if c["id"] not in melded_ids)
    return min(MAX_POINTS, dead)
