# ╔══════════════════════════════════════════════════════════════════════╗
# ║  auth.py  —  Sign-in, session and the access dependency             ║
# ╚══════════════════════════════════════════════════════════════════════╝

import os
import sys
from datetime import datetime

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field, TypeAdapter, ValidationError
from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session, joinedload

from db import SessionLocal, engine, get_db
from models import Client, Role, User, UserStatus, utcnow
from security import (
    COOKIE_NAME, clear_session_cookie, create_token, decode_token,
    hash_password, set_session_cookie, verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Deliberately identical for "unknown email" and "wrong password" so the
# endpoint cannot be used to discover which addresses have accounts.
INVALID_CREDENTIALS = "Email or password is incorrect."

# Sign-in validates the email through EmailStr, which rejects reserved TLDs
# such as .local, .test and .example. Seeding is validated with the same
# adapter so an administrator can never be created with an address that the
# login endpoint would then refuse — which would lock the account out silently.
_EMAIL_ADAPTER = TypeAdapter(EmailStr)

# One policy for every password the system accepts, so an account an
# administrator creates can never be weaker than the seeded administrator's.
PASSWORD_MIN_LENGTH = 12


def email_is_usable(email: str) -> bool:
    try:
        _EMAIL_ADAPTER.validate_python(email)
        return True
    except ValidationError:
        return False


DENIAL_MESSAGES = {
    "suspended": "This account has been suspended. Contact your administrator.",
    "invited": "This account has not been activated yet. Contact your administrator.",
    "subscription_expired": "This subscription has expired. Contact your administrator to restore access.",
}


# ── Wire shapes ───────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)
    remember: bool = False


class ClientOut(BaseModel):
    id: str
    name: str
    subscriptionExpiresAt: datetime | None


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    status: str
    isPlatformAdmin: bool
    client: ClientOut | None
    lastLoginAt: datetime | None


def to_user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        status=user.effective_status(),
        isPlatformAdmin=user.is_platform_admin,
        lastLoginAt=user.last_login_at,
        client=(
            ClientOut(
                id=user.client.id,
                name=user.client.name,
                subscriptionExpiresAt=user.client.subscription_expires_at,
            )
            if user.client
            else None
        ),
    )


# ── The access dependency ─────────────────────────────────────────────
def current_user(
    adlytix_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User:
    """
    Resolves the signed-in user, or raises 401.

    Every request re-reads the account from the database rather than trusting
    the token's contents. That is what makes suspension and subscription expiry
    take effect immediately: there is no window where a still-valid token keeps
    working after access is withdrawn.
    """
    if not adlytix_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in.")

    payload = decode_token(adlytix_session)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is invalid or has expired.")

    user = db.execute(
        select(User).options(joinedload(User.client)).where(User.id == payload.get("sub"))
    ).scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is no longer valid.")

    # A bumped token_version revokes every session issued before it.
    if int(payload.get("ver", 0)) != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been revoked. Sign in again.")

    reason = user.access_denied_reason()
    if reason:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIAL_MESSAGES[reason])

    return user


def require_admin(user: User = Depends(current_user)) -> User:
    """Guards the admin-only endpoints added in the Users & access phase."""
    if not user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires an administrator account.",
        )
    return user


def require_client_scope(user: User = Depends(current_user)) -> User:
    """
    Guards every tenant-owned resource added from the integrations phase
    onward (integrations, Shopify/Meta data, analytics, ...).

    This is the single place that resolves "which tenant can this request
    see" — every such endpoint depends on this instead of accepting a
    client_id from the request, so a client-supplied tenant id is never
    trusted (architecture brief, Section 27). Platform admins have no
    client_id and are deliberately excluded: they manage clients/users, not
    a client's own integrations or data.
    """
    if user.client_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires a client-scoped account.",
        )
    return user


# ── Endpoints ─────────────────────────────────────────────────────────
@router.post("/login", response_model=UserOut)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)) -> UserOut:
    email = body.email.strip().lower()

    user = db.execute(
        select(User).options(joinedload(User.client)).where(func.lower(User.email) == email)
    ).scalar_one_or_none()

    # Hash even when the user is missing, so a wrong email and a wrong password
    # take comparable time and cannot be told apart by response timing.
    if user is None:
        verify_password(body.password, "$2b$12$" + "." * 53)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)

    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)

    # Credentials are correct — now decide whether the account may be used.
    # Checked after the password so the specific reason is only ever revealed
    # to someone who already proved they own the account.
    reason = user.access_denied_reason()
    if reason:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIAL_MESSAGES[reason])

    token, _ = create_token(user.id, user.token_version, body.remember)
    set_session_cookie(response, token, body.remember)

    user.last_login_at = utcnow()
    db.commit()

    return to_user_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    """Used by the client on load to restore a session from the cookie."""
    return to_user_out(user)


@router.post("/logout-everywhere", status_code=status.HTTP_204_NO_CONTENT)
def logout_everywhere(
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Revokes this account's sessions on every device."""
    user.token_version += 1
    db.commit()
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


# ╔══════════════════════════════════════════════════════════════════════╗
# ║  Administration — clients and users                                  ║
# ║                                                                      ║
# ║  Every endpoint below is behind require_admin. There is deliberately  ║
# ║  no self-service signup anywhere in the system: an account exists     ║
# ║  only because an administrator created it.                           ║
# ║                                                                      ║
# ║  Note what is NOT here: nothing revokes sessions when a user is       ║
# ║  suspended, demoted or reassigned. It does not need to — current_user ║
# ║  re-reads the account on every request, so those changes bite on the  ║
# ║  user's very next call. A password reset is the one exception, and it ║
# ║  bumps token_version explicitly; see admin_set_password.             ║
# ╚══════════════════════════════════════════════════════════════════════╝

class AdminClientOut(BaseModel):
    id: str
    name: str
    subscriptionExpiresAt: datetime | None
    subscriptionActive: bool
    userCount: int
    createdAt: datetime


class AdminUserOut(UserOut):
    createdAt: datetime
    mustChangePassword: bool


class ClientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    subscriptionExpiresAt: datetime | None = None


class ClientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    subscriptionExpiresAt: datetime | None = None


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str = Field(default="", max_length=200)
    role: Role
    status: UserStatus = UserStatus.ACTIVE
    clientId: str | None = None


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    role: Role | None = None
    status: UserStatus | None = None
    clientId: str | None = None


class PasswordSet(BaseModel):
    password: str


def to_admin_client_out(client: Client, user_count: int) -> AdminClientOut:
    return AdminClientOut(
        id=client.id,
        name=client.name,
        subscriptionExpiresAt=client.subscription_expires_at,
        subscriptionActive=client.subscription_active(),
        userCount=user_count,
        createdAt=client.created_at,
    )


def to_admin_user_out(user: User) -> AdminUserOut:
    base = to_user_out(user)
    return AdminUserOut(
        **base.model_dump(),
        createdAt=user.created_at,
        mustChangePassword=user.must_change_password,
    )


# ── Validation shared by create and update ────────────────────────────
def _check_password(password: str) -> None:
    if len(password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must be at least {PASSWORD_MIN_LENGTH} characters.",
        )


def _resolve_client(db: Session, role: Role, client_id: str | None) -> str | None:
    """
    Enforces the one structural rule of the role model: platform admins belong
    to no client, and everyone else must belong to one.

    Without this a client-scoped user could be created with no client, which
    would leave them permanently unable to see data while appearing active, or
    an admin could be tied to a client whose expiry would then lock out the
    administrator.
    """
    if role is Role.ADMIN:
        if client_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="An administrator is platform-level and cannot belong to a client.",
            )
        return None

    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose the client this user belongs to.",
        )

    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="That client no longer exists."
        )
    return client.id


def _active_admin_count(db: Session, excluding: str | None = None) -> int:
    query = select(func.count()).select_from(User).where(
        User.role == Role.ADMIN, User.status == UserStatus.ACTIVE
    )
    if excluding:
        query = query.where(User.id != excluding)
    return int(db.execute(query).scalar() or 0)


def _guard_last_admin(db: Session, target: User, new_role: Role, new_status: UserStatus) -> None:
    """
    Refuses any change that would leave the platform with no usable
    administrator — which would make the admin surface permanently
    unreachable, recoverable only by editing the database by hand.
    """
    still_admin = new_role is Role.ADMIN and new_status is UserStatus.ACTIVE
    if still_admin:
        return
    if _active_admin_count(db, excluding=target.id) == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This is the only active administrator. Promote another account first.",
        )


# ── Clients ───────────────────────────────────────────────────────────
@router.get("/clients", response_model=list[AdminClientOut])
def admin_list_clients(
    _: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[AdminClientOut]:
    counts = dict(
        db.execute(select(User.client_id, func.count()).group_by(User.client_id)).all()
    )
    clients = db.execute(select(Client).order_by(Client.name)).scalars().all()
    return [to_admin_client_out(c, int(counts.get(c.id, 0))) for c in clients]


@router.post("/clients", response_model=AdminClientOut, status_code=status.HTTP_201_CREATED)
def admin_create_client(
    body: ClientCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminClientOut:
    name = body.name.strip()
    clash = db.execute(
        select(Client).where(func.lower(Client.name) == name.lower())
    ).scalar_one_or_none()
    if clash is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"A client named '{name}' already exists."
        )

    client = Client(name=name, subscription_expires_at=body.subscriptionExpiresAt)
    db.add(client)
    db.commit()
    db.refresh(client)
    return to_admin_client_out(client, 0)


@router.patch("/clients/{client_id}", response_model=AdminClientOut)
def admin_update_client(
    client_id: str,
    body: ClientUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminClientOut:
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found.")

    fields = body.model_fields_set

    if "name" in fields and body.name is not None:
        name = body.name.strip()
        clash = db.execute(
            select(Client).where(func.lower(Client.name) == name.lower(), Client.id != client.id)
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A client named '{name}' already exists.",
            )
        client.name = name

    # Distinguished via model_fields_set: an explicit null means "no expiry",
    # while an absent key means "leave the expiry alone". Collapsing the two
    # would silently grant perpetual access on an unrelated rename.
    if "subscriptionExpiresAt" in fields:
        client.subscription_expires_at = body.subscriptionExpiresAt

    db.commit()
    db.refresh(client)
    count = int(
        db.execute(
            select(func.count()).select_from(User).where(User.client_id == client.id)
        ).scalar()
        or 0
    )
    return to_admin_client_out(client, count)


# ── Users ─────────────────────────────────────────────────────────────
@router.get("/users", response_model=list[AdminUserOut])
def admin_list_users(
    _: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[AdminUserOut]:
    users = (
        db.execute(
            select(User).options(joinedload(User.client)).order_by(User.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [to_admin_user_out(u) for u in users]


@router.post("/users", response_model=AdminUserOut, status_code=status.HTTP_201_CREATED)
def admin_create_user(
    body: UserCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserOut:
    email = body.email.strip().lower()

    # The same guard the seeder uses. EmailStr has already accepted the address,
    # but this keeps the rule in one place and the failure explicit.
    if not email_is_usable(email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Use a real email domain — reserved domains such as .local and .test cannot sign in.",
        )

    _check_password(body.password)

    clash = db.execute(
        select(User).where(func.lower(User.email) == email)
    ).scalar_one_or_none()
    if clash is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="An account with that email already exists."
        )

    user = User(
        email=email,
        password_hash=hash_password(body.password),
        name=body.name.strip(),
        role=body.role,
        status=body.status,
        client_id=_resolve_client(db, body.role, body.clientId),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return to_admin_user_out(user)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def admin_update_user(
    user_id: str,
    body: UserUpdate,
    actor: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserOut:
    user = db.execute(
        select(User).options(joinedload(User.client)).where(User.id == user_id)
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    fields = body.model_fields_set
    new_role = body.role if body.role is not None else user.role
    new_status = body.status if body.status is not None else user.status

    # An administrator changing their own role or status is almost always a
    # mistake, and one that can lock them out of this very screen.
    if user.id == actor.id:
        if body.role is not None and body.role is not user.role:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You cannot change your own role. Ask another administrator.",
            )
        if body.status is not None and body.status is not user.status:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You cannot change your own account status.",
            )

    if user.role is Role.ADMIN:
        _guard_last_admin(db, user, new_role, new_status)

    if "name" in fields and body.name is not None:
        user.name = body.name.strip()

    # Role and client are resolved together: the valid client depends on the
    # role, so applying them independently could leave an invalid combination.
    if body.role is not None or "clientId" in fields:
        client_id = body.clientId if "clientId" in fields else user.client_id
        user.client_id = _resolve_client(db, new_role, client_id)
        user.role = new_role

    if body.status is not None:
        user.status = new_status

    db.commit()
    db.refresh(user)
    return to_admin_user_out(user)


@router.post("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def admin_set_password(
    user_id: str,
    body: PasswordSet,
    response: Response,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    """
    Sets a new password and signs the account out everywhere.

    The revocation is the point: a password reset exists to cut off whoever had
    the old one, and a session that survived it would defeat that entirely.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    _check_password(body.password)

    user.password_hash = hash_password(body.password)
    user.token_version += 1
    db.commit()

    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/users/{user_id}/revoke-sessions", status_code=status.HTTP_204_NO_CONTENT)
def admin_revoke_sessions(
    user_id: str,
    response: Response,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    """Signs an account out of every device without changing its password."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    user.token_version += 1
    db.commit()

    response.status_code = status.HTTP_204_NO_CONTENT
    return response


# ── First-run seeding ─────────────────────────────────────────────────
def init_auth() -> None:
    """
    Seeds the first administrator, if none exists yet, as described by
    ADMIN_EMAIL / ADMIN_PASSWORD. Runs once at startup and is a no-op
    afterwards, so redeploying never resets or duplicates the account.

    Schema creation/evolution is Alembic's job (backend/alembic/), not this
    function's — run `alembic upgrade head` before starting the app. This
    only verifies that migrations have actually been applied, so a forgotten
    `alembic upgrade head` fails loudly at startup instead of the seeder
    hitting "relation does not exist" with a confusing traceback.
    """
    inspector = inspect(engine)
    if not inspector.has_table("clients") or not inspector.has_table("users"):
        print(
            "[auth] Required tables are missing. Run `alembic upgrade head` "
            "(see backend/alembic/) before starting the app. Skipping seeding.",
            file=sys.stderr,
        )
        return

    email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("ADMIN_PASSWORD", "")

    # Validated before the "does an admin already exist" check on purpose.
    # Checking afterwards meant a typo in ADMIN_EMAIL was silently ignored
    # whenever any admin row existed — no account created, and no message
    # explaining why. A misconfiguration should always say so.
    if email and not email_is_usable(email):
        print(
            f"[auth] ADMIN_EMAIL='{email}' is not a valid address and will be "
            "ignored. Check for typos such as a doubled '@'. Reserved domains "
            "(.local, .test, .example) are rejected too.",
            file=sys.stderr,
        )
    if password and len(password) < PASSWORD_MIN_LENGTH:
        print(
            f"[auth] ADMIN_PASSWORD is {len(password)} characters; at least "
            f"{PASSWORD_MIN_LENGTH} are required, so it will be ignored.",
            file=sys.stderr,
        )

    with SessionLocal() as db:
        existing_admin = db.execute(
            select(User).where(User.role == Role.ADMIN).limit(1)
        ).scalar_one_or_none()

        if existing_admin is not None:
            # Seeding is a one-time bootstrap, so this is normal — but say which
            # account already holds the role, or an operator waiting for their
            # ADMIN_EMAIL to appear has nothing to go on.
            print(
                f"[auth] An administrator already exists ({existing_admin.email}); "
                "skipping first-run seeding. Create further accounts from "
                "Users & access.",
                file=sys.stderr,
            )
            return

        if not email or not password:
            print(
                "[auth] No administrator exists and ADMIN_EMAIL / ADMIN_PASSWORD "
                "are not set — nobody can sign in. Set both and restart.",
                file=sys.stderr,
            )
            return

        if len(password) < PASSWORD_MIN_LENGTH:
            print(
                "[auth] Refusing to seed the administrator: ADMIN_PASSWORD is "
                f"shorter than {PASSWORD_MIN_LENGTH} characters.",
                file=sys.stderr,
            )
            return

        if not email_is_usable(email):
            print(
                f"[auth] Refusing to seed the administrator: '{email}' is not an "
                "address the sign-in endpoint accepts. Reserved domains such as "
                ".local, .test and .example are rejected — use a real domain.",
                file=sys.stderr,
            )
            return

        # Guard against the email already existing as a non-admin account.
        clash = db.execute(
            select(User).where(func.lower(User.email) == email)
        ).scalar_one_or_none()
        if clash is not None:
            print(
                f"[auth] Cannot seed administrator: {email} already exists with "
                f"role {clash.role.value}.",
                file=sys.stderr,
            )
            return

        db.add(
            User(
                email=email,
                password_hash=hash_password(password),
                name=os.getenv("ADMIN_NAME", "Administrator"),
                role=Role.ADMIN,
                status=UserStatus.ACTIVE,
                client_id=None,
            )
        )
        db.commit()
        print(f"[auth] Seeded administrator {email}.", file=sys.stderr)
