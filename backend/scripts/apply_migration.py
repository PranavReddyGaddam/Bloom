#!/usr/bin/env python
"""Apply one CockroachDB migration file, statement by statement.

    cd backend && venv/bin/python scripts/apply_migration.py sql/cockroach/005_roleplay.sql

Splits on semicolons and executes each statement separately, so a partial
failure names the statement that failed rather than the whole file. Every
migration in this series is idempotent (IF NOT EXISTS throughout), so
re-running is safe.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).resolve().parent.parent / ".env")

from app.database import cursor


def statements(sql: str):
    """Yield executable statements, dropping comment-only chunks."""
    for chunk in sql.split(";"):
        lines = [
            line for line in chunk.strip().splitlines()
            if line.strip() and not line.strip().startswith("--")
        ]
        if lines:
            yield " ".join(line.strip() for line in lines)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2

    path = pathlib.Path(sys.argv[1])
    if not path.is_absolute():
        path = pathlib.Path(__file__).resolve().parent.parent / path
    if not path.exists():
        print(f"No such file: {path}")
        return 2

    stmts = list(statements(path.read_text()))
    print(f"{path.name}: {len(stmts)} statement(s)\n")

    for i, stmt in enumerate(stmts, 1):
        preview = stmt if len(stmt) <= 100 else stmt[:97] + "..."
        print(f"  [{i}/{len(stmts)}] {preview}")
        try:
            with cursor() as cur:
                cur.execute(stmt)
        except Exception as exc:
            print(f"\nFAILED on statement {i}: {exc}")
            return 1

    print(f"\n{path.name} applied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
