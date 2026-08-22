import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Make backend/*.py importable regardless of the working directory this is
# invoked from (`alembic` is normally run from backend/, but this makes the
# import robust either way).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Loads backend/.env the same way main.py does, so `alembic upgrade head` run
# by hand picks up DATABASE_URL without exporting it manually every time.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

# Every model module must be imported here (even if unused directly) so its
# tables register on Base.metadata before autogenerate compares against it.
import models  # noqa: E402
import integrations.models  # noqa: E402,F401
import audit.models  # noqa: E402,F401
import sync.models  # noqa: E402,F401
import shopify.models  # noqa: E402,F401
import meta.models  # noqa: E402,F401
import mapping.models  # noqa: E402,F401
from db import DATABASE_URL  # noqa: E402

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Real DATABASE_URL always wins over whatever alembic.ini has on disk — the
# same "environment always wins" rule db.py uses, so dev/staging/prod each
# migrate the database they are actually configured against.
config.set_main_option("sqlalchemy.url", DATABASE_URL)

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = models.Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
