"""Tiny idempotent migrations that run at startup (PostgreSQL).

create_all() makes new tables but never changes existing ones, so columns added after the
first release are listed here. Safe to run every time. Replace with Alembic when the schema
starts changing often.
"""
from sqlalchemy import text
from sqlalchemy.engine import Engine

STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS apps JSON NOT NULL DEFAULT '[\"library\"]'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ",
    "ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS mixed BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS chunk_seconds INTEGER",
    "ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS notes JSON NOT NULL DEFAULT '[]'",
    "ALTER TABLE transcriptions ALTER COLUMN size TYPE BIGINT",
]


def run_migrations(engine: Engine) -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        for statement in STATEMENTS:
            conn.execute(text(statement))
