"""Provably-fair server RNG (server-seed commit–reveal).

Guarantee: the full deck order is derived deterministically from a secret
`server_seed` + public `nonce` and its SHA-256 commitment is published BEFORE any
card is shown or any player acts. After the round the seed is revealed, so anyone
can recompute the shuffle and confirm it matches the commitment — no admin, and
no stake size, can change the outcome after the fact.

Randomness source: `secrets` (CSPRNG) for the seed; an HMAC-SHA256 counter stream
for an unbiased Fisher–Yates shuffle (rejection sampling avoids modulo bias).
"""
import hashlib
import hmac
import secrets

from .cards import fresh_deck


def new_seed() -> str:
    return secrets.token_hex(32)


def new_nonce() -> str:
    return secrets.token_hex(8)


class _SeedStream:
    """Deterministic CSPRNG-style byte stream keyed by the seed+nonce."""

    def __init__(self, key: str):
        self._key = key.encode()
        self._counter = 0
        self._buf = b""

    def _refill(self) -> None:
        block = hmac.new(self._key, self._counter.to_bytes(8, "big"), hashlib.sha256).digest()
        self._counter += 1
        self._buf += block

    def rand_below(self, n: int) -> int:
        """Unbiased integer in [0, n) via rejection sampling."""
        if n <= 1:
            return 0
        k = (n.bit_length() + 7) // 8
        maxv = 256 ** k
        limit = maxv - (maxv % n)
        while True:
            while len(self._buf) < k:
                self._refill()
            chunk, self._buf = self._buf[:k], self._buf[k:]
            v = int.from_bytes(chunk, "big")
            if v < limit:
                return v % n


def shuffled_deck(server_seed: str, nonce: str) -> list[str]:
    deck = fresh_deck()
    stream = _SeedStream(f"{server_seed}:{nonce}")
    for i in range(len(deck) - 1, 0, -1):
        j = stream.rand_below(i + 1)
        deck[i], deck[j] = deck[j], deck[i]
    return deck


def shuffled_list(items: list[str], server_seed: str, nonce: str) -> list[str]:
    """Generic unbiased shuffle of ANY list (multi-deck shoes, symbol strips, …)
    using the same HMAC-Fisher–Yates stream. Reused by Rummy (106-card shoe) and
    future house-banked games — same provably-fair commit–reveal guarantee."""
    lst = list(items)
    stream = _SeedStream(f"{server_seed}:{nonce}")
    for i in range(len(lst) - 1, 0, -1):
        j = stream.rand_below(i + 1)
        lst[i], lst[j] = lst[j], lst[i]
    return lst


def commit_hash(server_seed: str, deck: list[str]) -> str:
    return hashlib.sha256((server_seed + "|" + ",".join(deck)).encode()).hexdigest()


def verify_list(server_seed: str, nonce: str, base_items: list[str],
                committed_hash: str) -> tuple[bool, list[str]]:
    """Recompute a generic shoe from the revealed seed and check the commitment."""
    shoe = shuffled_list(base_items, server_seed, nonce)
    return commit_hash(server_seed, shoe) == committed_hash, shoe


def verify(server_seed: str, nonce: str, committed_hash: str) -> tuple[bool, list[str]]:
    """Recompute the deck from the revealed seed and check it matches the
    pre-published commitment. Returns (ok, recomputed_deck)."""
    deck = shuffled_deck(server_seed, nonce)
    return commit_hash(server_seed, deck) == committed_hash, deck
