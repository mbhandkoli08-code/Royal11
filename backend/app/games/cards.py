"""Standard 52-card deck helpers shared by all card games."""

RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
SUITS = ["s", "h", "d", "c"]  # spades, hearts, diamonds, clubs
_RANK_VALUE = {r: i for i, r in enumerate(RANKS, start=2)}  # 2..14 (A high)


def fresh_deck() -> list[str]:
    """Ordered 52-card deck, e.g. '2s', 'Th', 'Ac'. Shuffled by rng.shuffled_deck."""
    return [r + s for s in SUITS for r in RANKS]


def rank_value(card: str) -> int:
    return _RANK_VALUE[card[0]]


def suit(card: str) -> str:
    return card[1]
