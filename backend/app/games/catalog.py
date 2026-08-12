"""Registry of playable games. Each entry is metadata + a pure `settle` function
that ranks the seats from a dealt-cards map. New games (Rummy, Teen Patti, …)
plug in here in later phases; the engine stays game-agnostic.
"""
from .cards import rank_value, suit

_SUIT_ORDER = {"s": 3, "h": 2, "d": 1, "c": 0}  # tie-break only


def _high_card_settle(hands: dict[int, list[str]]) -> list[int]:
    """Rank seats best-first by their single card (A high; suit breaks ties)."""
    def key(seat: int):
        c = hands[seat][0]
        return (rank_value(c), _SUIT_ORDER[suit(c)])
    return sorted(hands.keys(), key=key, reverse=True)


GAMES: dict[str, dict] = {
    "high_card": {
        "label": "High Card",
        "category": "casino",
        "min_players": 2,
        "max_players": 6,
        "cards_per_player": 1,
        "has_turns": False,  # instant showdown — proves the Phase 0 flow
        "default_config": {"stake": 10, "rake_pct": 10, "rake_cap": 500},
        "settle": _high_card_settle,
    },
}
