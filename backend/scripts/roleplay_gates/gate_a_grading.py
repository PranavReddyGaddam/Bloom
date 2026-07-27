"""Exercise the grading invariants without touching the network."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.environ.setdefault('OPENROUTER_API_KEY', 'x')
os.environ.setdefault('SUPABASE_URL', 'http://x')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'x')

import websockets
print("websockets", websockets.__version__)
assert int(websockets.__version__.split(".")[0]) >= 12

from app.ai_service import BloomAI

ai = BloomAI()

SCENARIO = {
    "character": {"name": "Dana", "role": "a nurse"},
    "student_role": "a pharmacist",
    "rubric": [
        {"id": "c1", "name": "Names the mechanism", "evidence": "X binds Y"},
        {"id": "c2", "name": "Explains the risk", "evidence": "Y causes Z"},
        {"id": "c3", "name": "Gives the dose", "evidence": "10mg daily"},
    ],
}

TRANSCRIPT = [
    {"role": "character", "text": "So how does this actually work?"},
    {"role": "student", "text": "X binds to Y, which is the whole mechanism."},
]


def fake_response(payload):
    async def _make_request(messages):
        return payload
    return _make_request


async def main():
    # 1. A met=True with no evidence_quote must be downgraded to met=False.
    ai._make_request = fake_response(
        '{"criteria":['
        '{"id":"c1","met":true,"evidence_quote":"X binds to Y","feedback":"good"},'
        '{"id":"c2","met":true,"evidence_quote":null,"feedback":"covered it"},'
        '{"id":"c3","met":false,"evidence_quote":null,"feedback":"missing"}'
        '],"summary":"nice work"}'
    )
    result = await ai.grade_roleplay(TRANSCRIPT, SCENARIO)
    by_id = {c["id"]: c for c in result["criteria"]}

    assert by_id["c1"]["met"] is True, by_id["c1"]
    assert by_id["c2"]["met"] is False, "quoteless met must be downgraded"
    assert by_id["c2"]["evidence_quote"] is None
    assert by_id["c3"]["met"] is False
    assert result["met_count"] == 1
    # Score computed in Python: 1 of 3.
    assert result["score"] == round(1 / 3 * 100, 1), result["score"]
    print("PASS: quoteless-met downgrade + python-computed score", result["score"])

    # 2. A model that invents a criterion or drops one cannot change the rubric.
    ai._make_request = fake_response(
        '{"criteria":[{"id":"c99","met":true,"evidence_quote":"whatever"}],"summary":"x"}'
    )
    result = await ai.grade_roleplay(TRANSCRIPT, SCENARIO)
    assert [c["id"] for c in result["criteria"]] == ["c1", "c2", "c3"]
    assert result["met_count"] == 0
    assert result["score"] == 0.0
    print("PASS: rubric is server-owned; invented ids ignored")

    # 3. Unparseable output fails silent (None), never fail-generous.
    ai._make_request = fake_response("the model rambled without JSON")
    assert await ai.grade_roleplay(TRANSCRIPT, SCENARIO) is None
    print("PASS: unparseable -> None (fail-silent, not fail-generous)")

    # 4. A raised exception also returns None rather than propagating.
    async def boom(messages):
        raise RuntimeError("api down")
    ai._make_request = boom
    assert await ai.grade_roleplay(TRANSCRIPT, SCENARIO) is None
    print("PASS: API failure -> None")

    # 5. Transcript budgeting keeps head + tail with an explicit elision mark.
    long_transcript = [
        {"role": "student", "text": f"turn number {i} " + "x" * 200}
        for i in range(80)
    ]
    rendered = ai._budget_transcript(long_transcript, "Dana")
    assert "[…]" in rendered, "elision must be marked"
    assert len(rendered) <= ai.ROLEPLAY_TRANSCRIPT_BUDGET + 200
    assert "turn number 0" in rendered, "opening must survive"
    assert "turn number 79" in rendered, "tail must survive"
    print("PASS: transcript budgeting keeps head+tail, marks elision")


asyncio.run(main())
print("\nAll grading invariants hold.")
