#!/usr/bin/env python
"""Report which CockroachDB migrations are already applied. Read-only.

    cd backend && venv/bin/python scripts/check_schema.py

Writes nothing. Use it before and after applying migrations to see what
changed. There is no migrations table in this project, so state is inferred
from the tables and columns each file creates.
"""
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).resolve().parent.parent / ".env")

if not os.getenv("DATABASE_URL"):
    print("DATABASE_URL is not set — nothing to check.")
    sys.exit(2)

from app.database import cursor

# What each migration file leaves behind, as (label, table, column-or-None).
CHECKS = [
    ("001_schema.sql", [
        ("users", None), ("documents", None), ("tutor_sessions", None),
        ("quiz_attempts", None), ("question_attempts", None),
        ("concept_mastery", None), ("flashcards", None),
    ]),
    ("002_vector_indexes.sql", [("document_chunks", "embedding")]),
    ("003_podcasts.sql", [("podcasts", None)]),
    ("004_document_originals.sql", [
        ("documents", "source_key"), ("documents", "source_content_type"),
    ]),
    ("005_roleplay.sql", [
        ("tutor_sessions", "scenario"), ("tutor_sessions", "transcript"),
        ("tutor_sessions", "rubric_result"), ("tutor_sessions", "turns_taken"),
    ]),
]


def main() -> int:
    try:
        with cursor() as cur:
            cur.execute(
                "SELECT table_name, column_name FROM information_schema.columns"
                " WHERE table_schema = 'public'"
            )
            rows = cur.fetchall()
    except Exception as exc:
        print(f"Could not reach the database: {exc}")
        return 2

    if not rows:
        print("Connected, but the public schema is EMPTY — no migrations applied.\n")

    tables = {r["table_name"] for r in rows}
    columns = {(r["table_name"], r["column_name"]) for r in rows}

    pending = []
    for label, items in CHECKS:
        missing = [
            f"{t}.{c}" if c else t
            for t, c in items
            if (t not in tables) or (c is not None and (t, c) not in columns)
        ]
        if missing:
            pending.append(label)
            print(f"[ ] {label:32} MISSING: {', '.join(missing)}")
        else:
            print(f"[x] {label:32} applied")

    print()
    if pending:
        print("Apply, in this order:")
        for label in pending:
            print(f"  backend/sql/cockroach/{label}")
        return 1

    print("All migrations applied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
