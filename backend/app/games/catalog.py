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
        # Rake = house/admin commission per pot. Super-Admin-configurable per table.
        # Default 70% (house keeps 70%, winner receives 30%) — applied uniformly to
        # every round; does NOT affect the provably-fair, genuinely-random outcome.
        "default_config": {"stake": 10, "rake_pct": 70, "rake_cap": 100000},
        "settle": _high_card_settle,
    },
    "rummy_points": {
        "label": "Points Rummy",
        "category": "rummy",
        "min_players": 2,
        "max_players": 6,
        "cards_per_player": 13,
        "has_turns": True,  # served by games.rummy_engine (NOT engine.start_round)
        # point_value = coins per point; escrow = 80 (max points) x point_value.
        # Default rake 70% of the settled pot (uniform, Super-Admin-configurable);
        # does NOT touch the provably-fair shoe.
        "default_config": {"point_value": 1, "rake_pct": 70, "rake_cap": 10_000_000,
                            "turn_seconds": 30, "max_timeouts": 3},
        "settle": None,
    },
    "rummy_pool": {
        "label": "Pool Rummy",
        "category": "rummy",
        "min_players": 2,
        "max_players": 6,
        "cards_per_player": 13,
        "has_turns": True,  # served by games.rummy_engine (multi-deal match)
        # Fixed entry charged ONCE at match start; players accumulate deal points
        # and are eliminated on reaching the pool limit (101 or 201). Last player
        # standing wins the whole prize pool. rake = house cut of the entry pot.
        "default_config": {"pool_type": 101, "entry_fee": 100, "rake_pct": 70,
                            "rake_cap": 10_000_000, "turn_seconds": 30, "max_timeouts": 3},
        "settle": None,
    },
    "rummy_deals": {
        "label": "Deals Rummy",
        "category": "rummy",
        "min_players": 2,
        "max_players": 6,
        "cards_per_player": 13,
        "has_turns": True,  # served by games.rummy_engine (multi-deal match)
        # Fixed entry charged ONCE at match start; a set number of deals is
        # played (2 or 3). Deal points accumulate; the LOWEST total after all
        # deals wins the prize pool. rake = house cut of the entry pot.
        "default_config": {"num_deals": 2, "entry_fee": 100, "rake_pct": 70,
                            "rake_cap": 10_000_000, "turn_seconds": 30, "max_timeouts": 3},
        "settle": None,
    },
}
