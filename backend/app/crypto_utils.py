"""Symmetric encryption for secrets at rest (e.g. third-party API keys).

We never store third-party API keys as plaintext. They are encrypted with
Fernet (AES-128-CBC + HMAC) using a key derived from APP_ENCRYPTION_KEY
(falling back to JWT_SECRET_KEY so the app still boots in dev). The derived
Fernet key is deterministic for a given passphrase, so previously-stored
ciphertext stays decryptable across restarts.
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet


def _derive_fernet_key() -> bytes:
    passphrase = os.environ.get("APP_ENCRYPTION_KEY") or os.environ.get("JWT_SECRET_KEY") or "dev-only-insecure-secret-change-me"
    digest = hashlib.sha256(passphrase.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


_fernet = Fernet(_derive_fernet_key())


def encrypt_secret(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> str:
    return _fernet.decrypt(token.encode("utf-8")).decode("utf-8")
