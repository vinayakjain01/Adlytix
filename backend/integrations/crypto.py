# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/crypto.py  —  Envelope encryption for OAuth credentials ║
# ║                                                                      ║
# ║  Shopify/Meta access and refresh tokens must never be stored in       ║
# ║  plaintext (architecture brief, Sections 12/16). This module is the  ║
# ║  only place that encrypts or decrypts them. Callers pass a plain      ║
# ║  dict; everything else about the ciphertext format is private to      ║
# ║  this module so it can change without touching call sites.           ║
# ╚══════════════════════════════════════════════════════════════════════╝

import json
import os
import sys

from cryptography.fernet import Fernet, InvalidToken


class EncryptionNotConfigured(RuntimeError):
    pass


def _load_key() -> bytes:
    key = os.getenv("ENCRYPTION_KEY", "").strip()
    if not key:
        if os.getenv("ENVIRONMENT", "development").lower() == "production":
            raise RuntimeError(
                "ENCRYPTION_KEY must be set when ENVIRONMENT=production — it "
                "protects every stored Shopify/Meta credential."
            )
        # Ephemeral dev key: nothing encrypted with it survives a restart,
        # which is fine — there is no OAuth flow to reconnect in dev without
        # a real Shopify/Meta app anyway.
        generated = Fernet.generate_key()
        print(
            "[integrations] ENCRYPTION_KEY not set — generated an ephemeral "
            "development key. Any stored integration credentials will not "
            "decrypt after a restart.",
            file=sys.stderr,
        )
        return generated
    try:
        return key.encode("utf-8")
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"ENCRYPTION_KEY is not valid: {exc}")


_FERNET: Fernet | None = None


def _fernet() -> Fernet:
    global _FERNET
    if _FERNET is None:
        _FERNET = Fernet(_load_key())
    return _FERNET


def encrypt_credentials(data: dict) -> str:
    """Serializes and encrypts a credentials dict (tokens, expiry, scopes, ...)."""
    payload = json.dumps(data, separators=(",", ":")).encode("utf-8")
    return _fernet().encrypt(payload).decode("utf-8")


def decrypt_credentials(ciphertext: str) -> dict:
    """
    Reverses encrypt_credentials. Raises EncryptionNotConfigured if the
    ciphertext cannot be decrypted with the current ENCRYPTION_KEY — e.g. the
    key rotated without re-encrypting stored rows. Callers must treat that as
    "this integration needs to be reconnected", never as an empty credential.
    """
    try:
        payload = _fernet().decrypt(ciphertext.encode("utf-8"))
    except InvalidToken as exc:
        raise EncryptionNotConfigured(
            "Stored credentials could not be decrypted with the current "
            "ENCRYPTION_KEY. The integration must be reconnected."
        ) from exc
    return json.loads(payload.decode("utf-8"))
