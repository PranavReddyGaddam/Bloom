"""Golden-output diff harness for the Supabase -> CockroachDB port.

Bloom has no test suite. This calls every read path in db.py for a fixed user
and prints canonical JSON (sorted keys, normalized timestamps), so the same
command run before and after the port produces diffable output:

    # before porting, against Supabase
    python scripts/dbdump.py --user <external_id> > /tmp/golden_supabase.json
    # after each ported slice, against CockroachDB
    python scripts/dbdump.py --user <external_id> > /tmp/after.json
    diff /tmp/golden_supabase.json /tmp/after.json

Normalization is what makes the diff meaningful. psycopg returns `datetime`
where supabase-py returned ISO strings, and that difference is a real bug at
call sites like db.py:958 -- but it would otherwise swamp the diff with noise
on every timestamp field. `_canon` renders both to the same string form, so
the diff surfaces *shape and value* changes (missing keys, flattened embeds,
reordered rows, wrong counts) rather than type churn. Check datetime handling
separately; see MIGRATION_COCKROACHDB.md "Timestamps -- will bite".

UUIDs are likewise rendered as strings: psycopg returns uuid.UUID objects
where supabase-py returned strings.

Read-only. Every function called here is a read; nothing mutates.
"""

import argparse
import json
import sys
import uuid
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app import db  # noqa: E402


def _canon(obj):
    """Render values so Supabase and CockroachDB return-shapes compare equal."""
    if isinstance(obj, dict):
        return {k: _canon(v) for k, v in sorted(obj.items())}
    if isinstance(obj, (list, tuple)):
        return [_canon(v) for v in obj]
    if isinstance(obj, datetime):
        # Normalize tz-aware and naive to the same UTC-ish string, second
        # precision -- microsecond drift is not a port regression.
        return obj.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if isinstance(obj, str):
        # Supabase returns ISO strings; parse and re-render to match the above.
        try:
            parsed = datetime.fromisoformat(obj.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return obj
        return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if isinstance(obj, (uuid.UUID, date)):
        return str(obj)
    if isinstance(obj, Decimal):
        return float(obj)
    return obj


def _call(label, fn, *args, **kwargs):
    """Run one read, capturing failures as data so one break doesn't end the run."""
    try:
        return {"ok": True, "value": _canon(fn(*args, **kwargs))}
    except Exception as e:  # noqa: BLE001 - failures are part of the report
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True, help="external_id (Supabase Auth uid)")
    ap.add_argument("--limit", type=int, default=20)
    args = ap.parse_args()
    ext = args.user

    out = {}

    # --- user / subjects -------------------------------------------------
    out["get_or_create_user"] = _call("u", db.get_or_create_user, ext)
    out["list_subjects"] = _call("s", db.list_subjects, ext)

    # --- attempts / analytics --------------------------------------------
    out["get_recent_attempts"] = _call("ra", db.get_recent_attempts, ext, args.limit)
    out["get_user_stats"] = _call("us", db.get_user_stats, ext)
    out["get_user_analytics"] = _call("ua", db.get_user_analytics, ext)

    # Per-attempt reads, driven off whatever the recent list returned.
    attempts = out["get_recent_attempts"].get("value") or []
    attempt_ids = [a["id"] for a in attempts[:3] if isinstance(a, dict) and "id" in a]
    out["_attempt_ids_sampled"] = attempt_ids
    for aid in attempt_ids:
        out[f"get_attempt_breakdown[{aid}]"] = _call("b", db.get_attempt_breakdown, aid)
        out[f"get_attempt_recap[{aid}]"] = _call("r", db.get_attempt_recap, aid, ext)

    # --- documents --------------------------------------------------------
    out["list_documents"] = _call("ld", db.list_documents, ext)
    docs = out["list_documents"].get("value") or []
    doc_ids = [d["id"] for d in docs[:3] if isinstance(d, dict) and "id" in d]
    out["_document_ids_sampled"] = doc_ids
    for did in doc_ids:
        out[f"get_document_content[{did}]"] = _call("dc", db.get_document_content, did, ext)

    # --- flashcards (embedded flashcard_sets(subject) + count="exact") ----
    out["get_due_flashcards"] = _call("df", db.get_due_flashcards, ext, 100)

    # --- concept reviews (embedded documents(filename); datetime crash site)
    out["get_due_concept_reviews"] = _call("dcr", db.get_due_concept_reviews, ext, 10)

    # --- tutor sessions ---------------------------------------------------
    # No list-sessions read exists in db.py; rehydration is exercised by the
    # restart-mid-session manual test in MIGRATION_COCKROACHDB.md instead.

    json.dump(out, sys.stdout, indent=2, sort_keys=True, default=str)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
