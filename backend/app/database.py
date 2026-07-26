"""CockroachDB connection infrastructure.

Deliberately contains no queries. Keeping the pool, the cursor helper, and the
retry decorator here means db.py's migration off supabase-py is 100% query
translation with nothing else mixed in.

Driver choice (see MIGRATION_COCKROACHDB.md for the full rationale):

  * psycopg 3, **sync**. Every call site in db.py is a sync function and
    callers already wrap blocking work in asyncio.to_thread. Going async would
    mean rewriting every db.* signature and every caller in tutor_agent.py --
    a whole-app refactor rather than a port.
  * `row_factory=dict_row` makes every query return list[dict] with string
    keys, exactly what supabase-py's `.execute().data` returned. This is the
    single choice that keeps consumers like row["front"] working untouched.
  * psycopg3 adapts dict/list <-> jsonb automatically, which is what keeps
    tutor-session rehydration (6 jsonb columns) correct. asyncpg does not.
  * pgvector.psycopg.register_vector() handles list[float] <-> VECTOR.

CockroachDB uses SERIALIZABLE isolation by default and aborts transactions
that conflict rather than blocking, so client-side retry on error 40001 is a
requirement of the database, not defensive padding.
"""

import logging
import os
import random
import time
from contextlib import contextmanager
from functools import wraps
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)

_pool: ConnectionPool = None

# Retry budget for serialization failures. Five attempts with exponential
# backoff plus jitter covers realistic contention; beyond that the error is
# almost certainly not transient and should surface.
MAX_RETRIES = 5
BASE_BACKOFF_SECONDS = 0.05
MAX_BACKOFF_SECONDS = 1.0


def _configure(conn: psycopg.Connection) -> None:
    """Per-connection setup, run once by the pool for each new connection.

    pgvector's register_vector() is called for the *read* path: it makes a
    VECTOR column come back as a numpy ndarray rather than a string. It does
    NOT give us the write path on CockroachDB -- see to_vector() below.
    """
    from pgvector.psycopg import register_vector

    try:
        register_vector(conn)
    except Exception as e:  # noqa: BLE001
        # Non-fatal: without it, reads yield the raw text form. Writes go
        # through to_vector() either way, so the app still functions.
        logger.warning("register_vector failed, VECTOR reads will be strings: %s", e)


def to_vector(values) -> str:
    """Render an embedding for sending to a VECTOR column.

    Required because register_vector()'s *input* adapter does not bind on
    CockroachDB. Cockroach reports the vector type under its own OID (90006)
    rather than the one pgvector discovers from `CREATE EXTENSION vector`, so
    a plain list[float] is adapted as a Postgres array -- rendering
    `{0.1,0.2}` where the server demands `[0.1,0.2]`, and failing with
    "malformed vector literal". Verified against CockroachDB v26.2.1.

    The string form casts cleanly on the server side, so every embedding
    parameter goes through here:

        cur.execute("... VALUES (%s)", (to_vector(embedding),))

    Accepts a list, tuple, or numpy array (reads come back as ndarray, so a
    round-tripped value can be written straight back).
    """
    if values is None:
        return None
    return "[" + ",".join(str(float(v)) for v in values) + "]"


def from_vector(value) -> list:
    """Normalize a VECTOR read back to list[float].

    Reads arrive as a numpy ndarray via register_vector(). That breaks the
    supabase-py contract in two places that matter: `if embedding:` raises
    ValueError on an array, and json.dumps() cannot serialize one. Call this
    on any embedding that leaves the data layer.
    """
    if value is None:
        return None
    return [float(v) for v in value]


def get_pool() -> ConnectionPool:
    """Lazily build the process-wide pool.

    Mirrors the lazy-singleton shape of db._get_client() so startup ordering
    and error behavior are unchanged: no connection is attempted at import
    time, and a missing DATABASE_URL raises on first use with a clear message.
    """
    global _pool
    if _pool is None:
        url = os.getenv("DATABASE_URL")
        if not url:
            raise ValueError("DATABASE_URL environment variable is required")
        _pool = ConnectionPool(
            conninfo=url,
            min_size=1,
            max_size=int(os.getenv("DB_POOL_MAX_SIZE", "10")),
            kwargs={"row_factory": dict_row, "autocommit": True},
            configure=_configure,
            open=True,
        )
    return _pool


@contextmanager
def cursor() -> Iterator[psycopg.Cursor]:
    """A dict_row cursor on a pooled connection, in autocommit.

    Autocommit is the right default here because nearly every db.py function
    is a single statement. Use transaction() for the compound ones.
    """
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            yield cur


@contextmanager
def transaction() -> Iterator[psycopg.Cursor]:
    """A dict_row cursor inside an explicit transaction.

    Commits on clean exit, rolls back on exception. Pair with
    @retry_on_serialization_failure on any function that uses it -- under
    SERIALIZABLE isolation a conflicting transaction is aborted by the server,
    and retrying is the caller's job.
    """
    with get_pool().connection() as conn:
        # The pool hands out autocommit connections; suspend that so
        # conn.transaction() delimits a real transaction.
        prev_autocommit = conn.autocommit
        conn.autocommit = False
        try:
            with conn.transaction():
                with conn.cursor() as cur:
                    yield cur
        finally:
            conn.autocommit = prev_autocommit


def retry_on_serialization_failure(fn):
    """Retry a function whose body may abort with a serialization failure.

    CockroachDB raises SQLSTATE 40001 when SERIALIZABLE isolation cannot order
    two concurrent transactions. The documented client responsibility is to
    retry the whole transaction, so the decorated function must be idempotent
    with respect to its own retries -- which holds for the compound writes it
    is applied to, since each re-runs from a clean rollback.
    """

    @wraps(fn)
    def wrapper(*args, **kwargs):
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                return fn(*args, **kwargs)
            except psycopg.errors.SerializationFailure as e:
                last_error = e
                if attempt == MAX_RETRIES - 1:
                    break
                backoff = min(
                    BASE_BACKOFF_SECONDS * (2**attempt), MAX_BACKOFF_SECONDS
                )
                # Jitter prevents retried transactions from re-colliding in
                # lockstep.
                time.sleep(backoff * (0.5 + random.random()))
                logger.warning(
                    "serialization failure in %s, retry %d/%d",
                    fn.__name__,
                    attempt + 1,
                    MAX_RETRIES,
                )
        raise last_error

    return wrapper


def close_pool() -> None:
    """Close the pool. For test teardown and clean shutdown; not used in the
    request path."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
