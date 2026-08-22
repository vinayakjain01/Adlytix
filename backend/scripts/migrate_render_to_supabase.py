# ╔══════════════════════════════════════════════════════════════════════╗
# ║  scripts/migrate_render_to_supabase.py  —  One-time data cutover     ║
# ║                                                                      ║
# ║  Copies `clients` and `users` from the old Render-managed Postgres    ║
# ║  (the live production database before the Phase 1 migration) into    ║
# ║  Supabase (the new system of record), preserving primary keys so     ║
# ║  every foreign key (users.client_id) still resolves correctly.        ║
# ║                                                                      ║
# ║  Idempotent: uses INSERT ... ON CONFLICT (id) DO NOTHING, so running  ║
# ║  it twice does not duplicate or corrupt anything. Safe to run before  ║
# ║  or after Render's database is decommissioned — running it again      ║
# ║  after decommissioning simply finds no source rows.                   ║
# ║                                                                      ║
# ║  Usage (run from backend/, with the venv active):                     ║
# ║    RENDER_DATABASE_URL="<old DATABASE_URL>" \                         ║
# ║      venv/Scripts/python.exe scripts/migrate_render_to_supabase.py    ║
# ║                                                                      ║
# ║  Reads the *target* (Supabase) DATABASE_URL the normal way, via        ║
# ║  backend/.env — same as the running app. Never hardcode either        ║
# ║  connection string in this file.                                      ║
# ╚══════════════════════════════════════════════════════════════════════╝

import os
import sys

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))


def _normalise(url: str) -> str:
    # psycopg2 doesn't understand the postgresql+psycopg:// SQLAlchemy dialect
    # suffix that db.py adds; strip it back to a plain libpq URL.
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def main() -> int:
    source_url = os.environ.get("RENDER_DATABASE_URL", "").strip()
    target_url = os.environ.get("DATABASE_URL", "").strip()

    if not source_url:
        print("RENDER_DATABASE_URL is not set — nothing to migrate from.", file=sys.stderr)
        return 1
    if not target_url:
        print("DATABASE_URL is not set (checked backend/.env) — nothing to migrate to.", file=sys.stderr)
        return 1
    if "supabase.co" not in target_url and "supabase.com" not in target_url:
        print(
            "DATABASE_URL does not look like the Supabase target — refusing to "
            "run to avoid migrating into the wrong database. Check backend/.env.",
            file=sys.stderr,
        )
        return 1

    source = psycopg2.connect(_normalise(source_url))
    target = psycopg2.connect(_normalise(target_url))
    source.autocommit = False
    target.autocommit = False

    try:
        with source.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as src_cur:
            src_cur.execute(
                "select id, name, subscription_expires_at, created_at from clients order by created_at;"
            )
            clients = src_cur.fetchall()

            src_cur.execute(
                """
                select id, client_id, email, password_hash, name, role, status,
                       token_version, must_change_password, last_login_at, created_at
                from users order by created_at;
                """
            )
            users = src_cur.fetchall()

        print(f"Source (Render): {len(clients)} client(s), {len(users)} user(s).")

        with target.cursor() as tgt_cur:
            for c in clients:
                tgt_cur.execute(
                    """
                    insert into clients (id, name, subscription_expires_at, created_at)
                    values (%(id)s, %(name)s, %(subscription_expires_at)s, %(created_at)s)
                    on conflict (id) do nothing;
                    """,
                    c,
                )
            for u in users:
                tgt_cur.execute(
                    """
                    insert into users (
                        id, client_id, email, password_hash, name, role, status,
                        token_version, must_change_password, last_login_at, created_at
                    ) values (
                        %(id)s, %(client_id)s, %(email)s, %(password_hash)s, %(name)s,
                        %(role)s, %(status)s, %(token_version)s, %(must_change_password)s,
                        %(last_login_at)s, %(created_at)s
                    )
                    on conflict (id) do nothing;
                    """,
                    u,
                )

            tgt_cur.execute("select count(*) from clients;")
            (target_clients,) = tgt_cur.fetchone()
            tgt_cur.execute("select count(*) from users;")
            (target_users,) = tgt_cur.fetchone()

        target.commit()
        print(f"Target (Supabase) now has: {target_clients} client(s), {target_users} user(s).")
        return 0
    except Exception:
        target.rollback()
        raise
    finally:
        source.close()
        target.close()


if __name__ == "__main__":
    raise SystemExit(main())
