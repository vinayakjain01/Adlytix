# ╔══════════════════════════════════════════════════════════════════════╗
# ║  security.py  —  Password hashing, JWTs and cookie policy           ║
# ╚══════════════════════════════════════════════════════════════════════╝

import base64
import hashlib
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Response

ALGORITHM = "HS256"
COOKIE_NAME = "adlytix_session"

# Matches the design: a normal sign-in lasts a working day, "keep me signed
# in" lasts a month.
SESSION_HOURS = int(os.getenv("SESSION_HOURS", "12"))
REMEMBER_DAYS = int(os.getenv("REMEMBER_DAYS", "30"))


def _load_secret() -> str:
    secret = os.getenv("JWT_SECRET", "").strip()
    if secret:
        if len(secret) < 32:
            print(
                "[auth] WARNING: JWT_SECRET is shorter than 32 characters.",
                file=sys.stderr,
            )
        return secret

    # No secret configured. Refuse to run in production rather than silently
    # signing tokens with a value an attacker could guess; in development,
    # generate an ephemeral one so the app still boots (restarts log everyone
    # out, which is the intended trade-off).
    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        raise RuntimeError(
            "JWT_SECRET must be set when ENVIRONMENT=production."
        )
    generated = secrets.token_urlsafe(48)
    print(
        "[auth] JWT_SECRET not set — generated an ephemeral development secret. "
        "Sessions will not survive a restart.",
        file=sys.stderr,
    )
    return generated


JWT_SECRET = _load_secret()


# ── Passwords ─────────────────────────────────────────────────────────
# bcrypt silently truncates at 72 bytes, so a long passphrase would have its
# tail ignored. Pre-hashing with SHA-256 and base64-encoding gives a fixed
# 44-byte input, which removes the limit without weakening anything.
def _prepare(password: str) -> bytes:
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        # Malformed hash in the database — treat as a failed login, never a 500.
        return False


# ── Tokens ────────────────────────────────────────────────────────────
def session_lifetime(remember: bool) -> timedelta:
    return timedelta(days=REMEMBER_DAYS) if remember else timedelta(hours=SESSION_HOURS)


def create_token(user_id: str, token_version: int, remember: bool) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    expires_at = now + session_lifetime(remember)
    payload = {
        "sub": user_id,
        "ver": token_version,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "rem": remember,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM), expires_at


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


# ── Cookie policy ─────────────────────────────────────────────────────
# In production the frontend and API share a domain, so SameSite=Lax both
# works and blocks cross-site POSTs (which is the CSRF defence). In
# development they are different origins, so the cookie has to be SameSite=None
# — which requires Secure. Browsers treat http://localhost as a secure context,
# so this works locally without TLS.
def _cookie_flags() -> tuple[str, bool]:
    same_site = os.getenv("COOKIE_SAMESITE", "").strip().lower()
    if same_site not in ("lax", "strict", "none"):
        same_site = "lax" if os.getenv("ENVIRONMENT", "development").lower() == "production" else "none"

    secure_env = os.getenv("COOKIE_SECURE", "").strip().lower()
    if secure_env in ("1", "true", "yes"):
        secure = True
    elif secure_env in ("0", "false", "no"):
        secure = False
    else:
        # SameSite=None is only honoured on Secure cookies.
        secure = same_site == "none" or os.getenv("ENVIRONMENT", "development").lower() == "production"

    return same_site, secure


def set_session_cookie(response: Response, token: str, remember: bool) -> None:
    same_site, secure = _cookie_flags()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=int(session_lifetime(remember).total_seconds()),
        httponly=True,      # unreadable from JavaScript, so XSS cannot steal it
        secure=secure,
        samesite=same_site,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    same_site, secure = _cookie_flags()
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        secure=secure,
        samesite=same_site,
    )
