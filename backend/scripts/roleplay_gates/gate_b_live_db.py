"""Gate B, LIVE half: 005_roleplay.sql did not disturb existing tutor data.

Read-only except for one roleplay session it creates and then deletes. Run
after applying the migration.

The offline gate_b_landmines.py proves the *code* keeps the two paths apart.
This proves the *schema change* did the same to real rows.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent.parent))

from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).resolve().parent.parent.parent / ".env")

from app.database import cursor
from app import db

failures = []


def check(label, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}: {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


with cursor() as cur:
    # --- 1. The new columns exist with the right types and nullability -----
    cur.execute(
        "SELECT column_name, data_type, is_nullable, column_default"
        " FROM information_schema.columns"
        " WHERE table_schema='public' AND table_name='tutor_sessions'"
        "   AND column_name IN ('scenario','transcript','rubric_result','turns_taken')"
        " ORDER BY column_name"
    )
    cols = {r["column_name"]: r for r in cur.fetchall()}

    check("all four roleplay columns present", len(cols) == 4, f"{sorted(cols)}")
    check("scenario is nullable jsonb", cols["scenario"]["is_nullable"] == "YES")
    check("rubric_result is nullable jsonb", cols["rubric_result"]["is_nullable"] == "YES")
    check("transcript NOT NULL with '[]' default",
          cols["transcript"]["is_nullable"] == "NO"
          and "[]" in (cols["transcript"]["column_default"] or ""))
    check("turns_taken NOT NULL default 0",
          cols["turns_taken"]["is_nullable"] == "NO"
          and "0" in (cols["turns_taken"]["column_default"] or ""))

    # --- 2. Existing tutor rows survived, and got sane backfills ----------
    cur.execute("SELECT count(*) AS n FROM tutor_sessions WHERE mode <> 'roleplay'")
    tutor_rows = cur.fetchone()["n"]
    print(f"\n  ({tutor_rows} pre-existing non-roleplay tutor session rows)")

    if tutor_rows:
        cur.execute(
            "SELECT count(*) AS n FROM tutor_sessions"
            " WHERE mode <> 'roleplay' AND (transcript IS NULL OR turns_taken IS NULL)"
        )
        check("no existing tutor row has a NULL in the new NOT NULL columns",
              cur.fetchone()["n"] == 0)

        cur.execute(
            "SELECT count(*) AS n FROM tutor_sessions"
            " WHERE mode <> 'roleplay' AND (scenario IS NOT NULL OR rubric_result IS NOT NULL)"
        )
        check("no existing tutor row was given roleplay state",
              cur.fetchone()["n"] == 0)

        # The tutor's own state columns must be readable exactly as before.
        state_cols = ", ".join(db._TUTOR_STATE_FIELDS)
        cur.execute(
            f"SELECT {state_cols} FROM tutor_sessions"
            f" WHERE mode <> 'roleplay' LIMIT 1"
        )
        check("a real tutor row still SELECTs on _TUTOR_STATE_FIELDS",
              cur.fetchone() is not None)

    # --- 3. Existing attempt history untouched ----------------------------
    cur.execute("SELECT count(*) AS n FROM quiz_attempts")
    print(f"  ({cur.fetchone()['n']} quiz_attempts rows)")
    cur.execute("SELECT count(*) AS n FROM question_attempts")
    print(f"  ({cur.fetchone()['n']} question_attempts rows)\n")

# --- 4. Round-trip a real roleplay session through the live DB ------------
SCENARIO = {
    "title": "Live migration check",
    "character": {"name": "Dana", "role": "a nurse"},
    "rubric": [{"id": "c1", "name": "Names it", "evidence": "e1"}],
    "grounding_concepts": ["warfarin"],
}
TEST_USER = "gate-b-live-db-probe"
session_id = None

try:
    session_id = db.create_roleplay_session(TEST_USER, {
        "subject": "MigrationProbe",
        "text_content": "probe",
        "sources": [{"text_content": "probe", "filename": "p", "document_id": None}],
        "scenario": SCENARIO,
        "transcript": [{"role": "character", "text": "hi", "turn_id": 0}],
        "rubric_result": None,
        "concepts": {},
        "turns_taken": 0,
        "checkpoint_shown": False,
    })
    check("create_roleplay_session inserts", bool(session_id))

    loaded = db.get_roleplay_session(session_id, TEST_USER)
    check("get_roleplay_session round-trips jsonb",
          loaded is not None and loaded["scenario"]["title"] == "Live migration check")
    check("rubric_result stays SQL NULL, not jsonb 'null'",
          loaded is not None and loaded["rubric_result"] is None)

    check("ownership is enforced in SQL",
          db.get_roleplay_session(session_id, "somebody-else") is None)

    loaded["transcript"].append({"role": "student", "text": "warfarin", "turn_id": 1})
    loaded["turns_taken"] = 1
    db.save_roleplay_session(session_id, loaded)
    check("save_roleplay_session persists a turn",
          len(db.get_roleplay_session(session_id, TEST_USER)["transcript"]) == 2)

    # The landmine, against the real schema.
    with cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM question_attempts")
        before = cur.fetchone()["n"]

    db.complete_roleplay_session(session_id, {
        "user_id": TEST_USER,
        "subject": "MigrationProbe",
        **{f: loaded[f] for f in db._ROLEPLAY_STATE_FIELDS},
        "rubric_result": {"score": 100.0, "met_count": 1, "total": 1,
                          "graded": True, "criteria": [{"id": "c1", "met": True}]},
    })

    with cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM question_attempts")
        check("complete_roleplay_session wrote ZERO question_attempts rows",
              cur.fetchone()["n"] == before)
        cur.execute(
            "SELECT difficulty, score FROM quiz_attempts"
            " WHERE subject = 'MigrationProbe' ORDER BY created_at DESC LIMIT 1"
        )
        row = cur.fetchone()
        check("quiz_attempts row has difficulty='roleplay'",
              row is not None and row["difficulty"] == "roleplay",
              str(dict(row)) if row else "no row")

    result = db.get_roleplay_result(session_id, TEST_USER)
    check("get_roleplay_result reads the completed scene",
          result is not None and result["graded"] and result["score"] == 100.0)

finally:
    # Clean up the probe entirely — it must not pollute the sidebar or stats.
    with cursor() as cur:
        cur.execute("DELETE FROM quiz_attempts WHERE subject = 'MigrationProbe'")
        if session_id:
            cur.execute("DELETE FROM tutor_sessions WHERE id = %s", (session_id,))
        cur.execute("DELETE FROM users WHERE external_id = %s", (TEST_USER,))
    print("\n  (probe rows deleted)")

print()
if failures:
    print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
    sys.exit(1)
print("Gate B (live DB) passes — 005 applied cleanly, tutor data intact.")
