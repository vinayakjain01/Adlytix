# ╔══════════════════════════════════════════════════════════════════════╗
# ║  audit/service.py  —  Write path for audit_logs                      ║
# ╚══════════════════════════════════════════════════════════════════════╝

from sqlalchemy.orm import Session

from audit.models import AuditLog


def record(
    db: Session,
    *,
    action: str,
    client_id: str | None = None,
    user_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    metadata: dict | None = None,
) -> AuditLog:
    """
    Appends one audit row. Does not commit — callers batch this into the same
    transaction as the action it describes, so the log entry and the change
    it records are never split across a partial failure.

    `metadata` must never contain secrets (tokens, passwords, full OAuth
    payloads) — see the AuditLog model docstring. This is enforced by
    convention at call sites, not by this function, so review new call sites
    for that when adding them.
    """
    entry = AuditLog(
        client_id=client_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata_json=metadata or {},
    )
    db.add(entry)
    return entry
