"""Gate C, offline: honest failure.

Grading must fail SILENT, never GENEROUS. A student told they demonstrated
things they never said is worse than a student told the grader broke.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.environ.setdefault('OPENROUTER_API_KEY', 'x')
os.environ.setdefault('SUPABASE_URL', 'http://x')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'x')

from app import roleplay_agent, db

db.complete_roleplay_session = lambda *a, **k: None

SCENARIO = {
    "character": {"name": "Dana", "role": "a nurse"},
    "rubric": [
        {"id": "c1", "name": "Names the mechanism", "evidence": "e1"},
        {"id": "c2", "name": "Explains the risk", "evidence": "e2"},
    ],
}


def make_session(transcript):
    return {
        "user_id": "ext-1",
        "subject": "Pharmacology",
        "text_content": "source",
        "sources": [],
        "persisted": {
            "scenario": SCENARIO, "transcript": transcript,
            "rubric_result": None, "concepts": {},
            "turns_taken": sum(1 for t in transcript if t["role"] == "student"),
            "checkpoint_shown": False,
        },
        "live": roleplay_agent._blank_live(),
        "updated_at": 0.0,
    }


class FakeAI:
    def __init__(self, result):
        self._result = result

    async def grade_roleplay(self, transcript, scenario):
        return self._result


async def main():
    # 1. One student turn -> ungraded, honest message, transcript intact.
    one_turn = [
        {"role": "character", "text": "Walk me through it?", "turn_id": 0},
        {"role": "student", "text": "Sure.", "turn_id": 1},
    ]
    session = make_session(one_turn)
    result = await roleplay_agent.grade_session("s1", session, FakeAI({"score": 100.0}))
    assert result["graded"] is False, result
    assert result["score"] is None, "an ungraded scene must not carry a score"
    assert result["criteria"] == []
    assert "too early" in result["message"].lower(), result["message"]
    assert result["transcript"] == one_turn, "the transcript must survive"
    print("PASS: 1 student turn -> ungraded, null score, transcript intact")

    # 2. Grader returns None -> empty criteria, null score, honest message,
    #    full transcript, and NOT all-criteria-met.
    four_turns = [
        {"role": "character", "text": "Walk me through it?", "turn_id": 0},
        {"role": "student", "text": "It inhibits VKOR.", "turn_id": 1},
        {"role": "character", "text": "And the risk?", "turn_id": 1},
        {"role": "student", "text": "Bleeding.", "turn_id": 2},
    ]
    session = make_session(four_turns)
    result = await roleplay_agent.grade_session("s2", session, FakeAI(None))
    assert result["graded"] is False
    assert result["score"] is None
    assert result["criteria"] == [], "must NOT fabricate met criteria"
    assert "couldn't grade" in result["message"].lower(), result["message"]
    assert result["transcript"] == four_turns
    # The decisive check: nothing anywhere claims a criterion was met.
    assert not any(c.get("met") for c in result["criteria"])
    print("PASS: grader None -> empty criteria, null score, full transcript")
    print("PASS: fail-silent, not fail-generous (nothing marked met)")

    # 3. A real grade passes through and lands in persisted state.
    graded = {
        "score": 50.0, "met_count": 1, "total": 2,
        "criteria": [
            {"id": "c1", "name": "Names the mechanism", "met": True,
             "evidence_quote": "It inhibits VKOR.", "feedback": None},
            {"id": "c2", "name": "Explains the risk", "met": False,
             "evidence_quote": None, "feedback": "not covered"},
        ],
        "summary": "Good start.",
    }
    session = make_session(four_turns)
    result = await roleplay_agent.grade_session("s3", session, FakeAI(graded))
    assert result["graded"] is True
    assert result["score"] == 50.0
    assert result["message"] is None
    assert session["persisted"]["rubric_result"]["score"] == 50.0
    print("PASS: a real grade passes through and persists")

    # 4. Turn caps.
    assert roleplay_agent.SOFT_NUDGE_TURNS == 12
    assert roleplay_agent.HARD_CAP_TURNS == 20
    assert roleplay_agent.MAX_SESSIONS == 200
    print("PASS: caps are 12 soft / 20 hard, MAX_SESSIONS=200")

    # 5. _prune_sessions must never evict a session holding a live socket.
    roleplay_agent._sessions.clear()
    live_session = make_session(four_turns)
    live_session["live"]["websocket"] = object()   # a live scene
    live_session["updated_at"] = 0.0               # ancient
    roleplay_agent._sessions["live-one"] = live_session

    dead = make_session(four_turns)
    dead["updated_at"] = 0.0
    roleplay_agent._sessions["dead-one"] = dead

    roleplay_agent._prune_sessions()
    assert "live-one" in roleplay_agent._sessions, "pruned a scene mid-conversation!"
    assert "dead-one" not in roleplay_agent._sessions
    print("PASS: _prune_sessions skips sessions holding a live socket")

    # 6. public_scenario never leaks evidence.
    pub = roleplay_agent.public_scenario(SCENARIO)
    assert "evidence" not in repr(pub), pub
    assert [c["name"] for c in pub["rubric"]] == [
        "Names the mechanism", "Explains the risk",
    ]
    print("PASS: public_scenario strips evidence, keeps names")

    print("\nGate C (offline portion) passes.")


asyncio.run(main())
