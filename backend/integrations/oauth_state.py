# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/oauth_state.py  —  Signed, stateless OAuth `state`      ║
# ║                                                                      ║
# ║  The `state` parameter in an OAuth authorize URL is the CSRF defence: ║
# ║  it proves the callback belongs to a flow *this* server started, not  ║
# ║  a request an attacker tricked a signed-in user into completing.      ║
# ║  Signing it (rather than storing it server-side) needs no extra table ║
# ║  or Redis — consistent with the Phase 7 "no new infrastructure"       ║
# ║  decision — and it doubles as the source of truth for which tenant    ║
# ║  the callback belongs to, which is more robust than re-deriving that  ║
# ║  from the session cookie on a cross-site provider redirect.           ║
# ╚══════════════════════════════════════════════════════════════════════╝

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import jwt

STATE_TTL_MINUTES = 10


class InvalidOAuthState(Exception):
    pass


def _secret() -> str:
    # Deliberately its own env var, not JWT_SECRET — an OAuth state token and
    # a session token authorize completely different things, and rotating
    # one should never silently invalidate the other.
    secret = os.getenv("OAUTH_STATE_SECRET", "").strip()
    if secret:
        return secret
    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        raise RuntimeError("OAUTH_STATE_SECRET must be set when ENVIRONMENT=production.")
    print(
        "[integrations] OAUTH_STATE_SECRET not set — falling back to JWT_SECRET "
        "for local development only.",
        file=sys.stderr,
    )
    from security import JWT_SECRET
    return JWT_SECRET


def create_state(*, provider: str, client_id: str, user_id: str, extra: dict | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "purpose": "integration_oauth",
        "provider": provider,
        "client_id": client_id,
        "user_id": user_id,
        "nonce": uuid.uuid4().hex,
        "extra": extra or {},
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=STATE_TTL_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, _secret(), algorithm="HS256")


def verify_state(token: str, *, provider: str) -> dict:
    """Returns the payload dict, or raises InvalidOAuthState."""
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise InvalidOAuthState(f"State token is invalid or expired: {exc}") from exc

    if payload.get("purpose") != "integration_oauth" or payload.get("provider") != provider:
        raise InvalidOAuthState("State token does not match this OAuth flow.")
    return payload
