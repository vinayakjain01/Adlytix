# ╔══════════════════════════════════════════════════════════════════════╗
# ║  models.py  —  Auth schema                                          ║
# ║                                                                      ║
# ║  Deliberately narrow: this stores who may sign in, nothing else.     ║
# ║  Uploaded files and analysis results are never persisted — they      ║
# ║  live in the browser for the duration of a session, exactly as       ║
# ║  before — so there is no per-client analysis data to isolate.        ║
# ╚══════════════════════════════════════════════════════════════════════╝

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, Enum as SAEnum, ForeignKey, Integer, String, func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Role(str, enum.Enum):
    """
    ADMIN is platform-level (your team) and has no client.
    The rest are client-scoped, matching the roles shown in the design.
    """
    ADMIN = "admin"
    OWNER = "owner"
    ANALYST = "analyst"
    VIEWER = "viewer"


class UserStatus(str, enum.Enum):
    """
    Stored status. `expired` is NOT stored — it is derived from the client's
    subscription date at request time, so a lapsed subscription locks the
    account without anything needing to run on a schedule.
    """
    ACTIVE = "active"
    INVITED = "invited"
    SUSPENDED = "suspended"


class Client(Base):
    """A customer account. Subscription lives here, so all of a client's users
    gain and lose access together."""

    __tablename__ = "clients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    # Null means no expiry (used for internal/never-expiring accounts).
    subscription_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    users: Mapped[list["User"]] = relationship(back_populates="client")

    def subscription_active(self, now: datetime | None = None) -> bool:
        if self.subscription_expires_at is None:
            return True
        return (now or utcnow()) < self.subscription_expires_at


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # Platform admins have no client.
    client_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=True, index=True
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    role: Mapped[Role] = mapped_column(
        SAEnum(Role, name="user_role", native_enum=False, length=20),
        nullable=False, default=Role.VIEWER,
    )
    status: Mapped[UserStatus] = mapped_column(
        SAEnum(UserStatus, name="user_status", native_enum=False, length=20),
        nullable=False, default=UserStatus.ACTIVE,
    )
    # Bumped to invalidate every existing session for this user — used on
    # password change and when an account is suspended.
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    client: Mapped[Client | None] = relationship(back_populates="users")

    # ── Derived access state ──────────────────────────────────────────
    @property
    def is_platform_admin(self) -> bool:
        return self.role is Role.ADMIN

    def subscription_expired(self, now: datetime | None = None) -> bool:
        # Platform admins are not bound to a client subscription.
        if self.is_platform_admin or self.client is None:
            return False
        return not self.client.subscription_active(now)

    def access_denied_reason(self, now: datetime | None = None) -> str | None:
        """None when the account may be used. Otherwise a stable machine code."""
        if self.status is UserStatus.SUSPENDED:
            return "suspended"
        if self.status is UserStatus.INVITED:
            return "invited"
        if self.subscription_expired(now):
            return "subscription_expired"
        return None

    def effective_status(self, now: datetime | None = None) -> str:
        """What the Users screen should display for this row."""
        if self.status is UserStatus.SUSPENDED:
            return "suspended"
        if self.status is UserStatus.INVITED:
            return "invited"
        if self.subscription_expired(now):
            return "expired"
        return "active"
