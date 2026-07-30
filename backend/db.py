# ╔══════════════════════════════════════════════════════════════════════╗
# ║  db.py  —  Database engine and session handling                     ║
# ╚══════════════════════════════════════════════════════════════════════╝

import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# DigitalOcean and Heroku-style URLs start with postgres://, which SQLAlchemy 2
# no longer recognises — normalise to the psycopg driver.
_RAW_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://adlytix:adlytix_dev@localhost:5433/adlytix",
)
if _RAW_URL.startswith("postgres://"):
    _RAW_URL = _RAW_URL.replace("postgres://", "postgresql+psycopg://", 1)
elif _RAW_URL.startswith("postgresql://"):
    _RAW_URL = _RAW_URL.replace("postgresql://", "postgresql+psycopg://", 1)

DATABASE_URL = _RAW_URL

engine = create_engine(
    DATABASE_URL,
    # Managed databases drop idle connections; recycle before they do.
    pool_pre_ping=True,
    pool_recycle=1800,
    echo=os.getenv("SQL_ECHO", "").lower() in ("1", "true"),
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
