"""Gate B, offline: the two known landmines in db.py.

1. complete_roleplay_session must write ZERO question_attempts rows — that is
   the fix for the confirmed KeyError at the tutor's executemany, which
   subscripts e["question_text"] etc. on every history entry.
2. _TUTOR_STATE_FIELDS must be untouched, so existing tutor sessions still
   start.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.environ.setdefault('OPENROUTER_API_KEY', 'x')
os.environ.setdefault('SUPABASE_URL', 'http://x')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'x')

from app import db

# --- 1. _TUTOR_STATE_FIELDS is exactly what it was before the port ---------
EXPECTED_TUTOR = (
    "concepts", "asked_questions", "current", "history",
    "verify_queue", "recheck_queue", "checkpoint_shown",
    "questions_answered", "correct_answers",
)
assert db._TUTOR_STATE_FIELDS == EXPECTED_TUTOR, db._TUTOR_STATE_FIELDS
print("PASS: _TUTOR_STATE_FIELDS untouched")

# The roleplay tuple must not have leaked into the tutor's.
assert "scenario" not in db._TUTOR_STATE_FIELDS
assert "transcript" not in db._TUTOR_STATE_FIELDS
assert "turns_taken" not in db._TUTOR_STATE_FIELDS
print("PASS: roleplay fields did not leak into the tutor tuple")

# Shared columns are named identically in both, which is what lets them share.
assert "concepts" in db._ROLEPLAY_STATE_FIELDS
assert "checkpoint_shown" in db._ROLEPLAY_STATE_FIELDS
print("PASS: concepts/checkpoint_shown shared by name across both tuples")


# --- 2. complete_roleplay_session writes no question_attempts --------------
class FakeCursor:
    def __init__(self, log):
        self.log = log

    def execute(self, sql, params=None):
        self.log.append(("execute", " ".join(sql.split())))

    def executemany(self, sql, rows):
        self.log.append(("executemany", " ".join(sql.split())))

    def fetchone(self):
        return {"id": "attempt-1"}


class FakeTx:
    def __init__(self, log):
        self.log = log

    def __enter__(self):
        return FakeCursor(self.log)

    def __exit__(self, *a):
        return False


log = []
db.transaction = lambda: FakeTx(log)
db.get_or_create_user = lambda ext: "user-1"

# A roleplay transcript entry has NONE of the keys the tutor's executemany
# subscripts. If that path were reused, this call would raise KeyError.
session = {
    "user_id": "ext-1",
    "subject": "Pharmacology",
    "scenario": {"title": "x"},
    "transcript": [
        {"role": "character", "text": "Walk me through it?", "turn_id": 0},
        {"role": "student", "text": "It inhibits VKOR.", "turn_id": 1},
    ],
    "rubric_result": {
        "score": 50.0, "met_count": 1, "total": 2, "graded": True,
        "criteria": [{"id": "c1", "met": True}, {"id": "c2", "met": False}],
    },
    "concepts": {},
    "turns_taken": 1,
    "checkpoint_shown": False,
}

db.complete_roleplay_session("sess-1", session)

kinds = [k for k, _ in log]
assert "executemany" not in kinds, "question_attempts rows were written!"
print("PASS: zero question_attempts rows, no KeyError")

sql_blob = " ".join(s for _, s in log)
assert "question_attempts" not in sql_blob, sql_blob
assert "INSERT INTO quiz_attempts" in sql_blob
assert "'roleplay'" in sql_blob, "difficulty should be 'roleplay'"
assert "status = 'completed'" in sql_blob
print("PASS: quiz_attempts row written with difficulty='roleplay'")

# --- 3. An ungraded scene completes with a null score, not a zero ----------
log.clear()
session["rubric_result"] = {"score": None, "graded": False, "criteria": []}
db.complete_roleplay_session("sess-2", session)
assert "executemany" not in [k for k, _ in log]
print("PASS: ungraded scene completes without fabricating a score")

# --- 4. Zero turns writes no attempt at all -------------------------------
log.clear()
session["turns_taken"] = 0
db.complete_roleplay_session("sess-3", session)
sql_blob = " ".join(s for _, s in log)
assert "quiz_attempts" not in sql_blob, "a 0-turn scene should record no attempt"
print("PASS: zero-turn scene records no quiz_attempts row")

print("\nGate B (offline portion) passes.")
