"""Gate D, offline: the websocket auth handshake and its close codes.

Runs against TestClient with auth and the DB stubbed, so it exercises the real
handler without needing Supabase or CockroachDB.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.environ.setdefault('OPENROUTER_API_KEY', 'x')
os.environ.setdefault('SUPABASE_URL', 'http://x')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'x')
os.environ.setdefault('DEEPGRAM_API_KEY', 'x')

import asyncio
import json as jsonlib

from app import main, auth, roleplay_agent


class WSDisconnect(Exception):
    def __init__(self, code):
        self.code = code


class WSHarness:
    """Drive the ASGI websocket app directly.

    Starlette 0.27's TestClient is incompatible with the installed httpx 0.28,
    so this speaks the ASGI websocket protocol itself — which also keeps the
    test honest about frame ordering.
    """

    def __init__(self, path):
        self.path = path
        self.to_app = asyncio.Queue()
        self.from_app = asyncio.Queue()
        self.task = None

    async def __aenter__(self):
        scope = {
            "type": "websocket", "path": self.path, "headers": [],
            "query_string": b"", "subprotocols": [], "client": ("test", 1),
            "server": ("test", 80), "scheme": "ws", "root_path": "",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
        }
        await self.to_app.put({"type": "websocket.connect"})
        self.task = asyncio.create_task(
            main.app(scope, self.to_app.get, self.from_app.put)
        )
        accepted = await self._next()
        assert accepted["type"] == "websocket.accept", accepted
        return self

    async def __aexit__(self, *exc):
        if self.task and not self.task.done():
            await self.to_app.put({"type": "websocket.disconnect", "code": 1000})
            try:
                await asyncio.wait_for(self.task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self.task.cancel()
        return False

    async def _next(self):
        return await asyncio.wait_for(self.from_app.get(), timeout=10)

    async def send_json(self, payload):
        await self.to_app.put(
            {"type": "websocket.receive", "text": jsonlib.dumps(payload)}
        )

    async def receive_json(self):
        msg = await self._next()
        if msg["type"] == "websocket.close":
            raise WSDisconnect(msg.get("code", 1000))
        return jsonlib.loads(msg["text"])

VALID = "valid-token"
OWNER = "user-owner"


async def fake_verify(token):
    return OWNER if token == VALID else None


auth.verify_bearer_token = fake_verify
main.auth.verify_bearer_token = fake_verify

SCENARIO = {
    "title": "The handover",
    "character": {"name": "Dana", "role": "a nurse"},
    "situation": "End of shift.",
    "student_role": "a pharmacist",
    "opening_line": "Can you walk me through this one?",
    "grounding_concepts": ["warfarin"],
    "rubric": [
        {"id": "c1", "name": "Names the mechanism", "evidence": "SECRET-EVIDENCE-1"},
        {"id": "c2", "name": "Explains the risk", "evidence": "SECRET-EVIDENCE-2"},
    ],
}


def make_session(user_id=OWNER):
    return {
        "user_id": user_id,
        "subject": "Pharmacology",
        "text_content": "warfarin inhibits vitamin K epoxide reductase",
        "sources": [],
        "persisted": {
            "scenario": SCENARIO,
            "transcript": [{"role": "character", "text": SCENARIO["opening_line"], "turn_id": 0}],
            "rubric_result": None,
            "concepts": {},
            "turns_taken": 0,
            "checkpoint_shown": False,
        },
        "live": roleplay_agent._blank_live(),
        "updated_at": 0.0,
    }


SESSIONS = {"sess-1": make_session()}


def fake_load(session_id, user_id):
    s = SESSIONS.get(session_id)
    if s is None or s["user_id"] != user_id:
        return None
    return s


roleplay_agent._load_session = fake_load
main.roleplay_agent._load_session = fake_load

async def expect_close(path, payloads, code, label):
    try:
        async with WSHarness(path) as ws:
            for p in payloads:
                await ws.send_json(p)
            await ws.receive_json()
        raise AssertionError(f"{label}: expected close {code}, got a message")
    except WSDisconnect as e:
        assert e.code == code, f"{label}: expected {code}, got {e.code}"
        print(f"PASS: {label} -> {code}")


async def fake_turn(session_id, session, text, ai):
    session["persisted"]["turns_taken"] += 1
    session["live"]["current_turn_id"] += 1
    tid = session["live"]["current_turn_id"]
    session["persisted"]["transcript"].append({"role": "student", "text": text, "turn_id": tid})
    session["persisted"]["transcript"].append({"role": "character", "text": "I see.", "turn_id": tid})
    return {"reply": "I see.", "turn_id": tid, "done": False, "nudge": False}


async def fake_grade(session_id, session, ai):
    return {"score": 50.0, "met_count": 1, "total": 2, "criteria": [],
            "summary": None, "message": None, "graded": True,
            "transcript": session["persisted"]["transcript"]}


main.roleplay_agent.handle_utterance = fake_turn
main.roleplay_agent.grade_session = fake_grade
# No TTS in this test: assert the text protocol in isolation.
main.tts_service.is_configured = lambda: False


async def main_test():
    # 1. Garbage token -> 4401
    await expect_close(
        "/roleplay/live/sess-1",
        [{"type": "auth", "token": "garbage"}], 4401, "garbage token",
    )

    # 2. A non-auth first frame -> 4401
    await expect_close(
        "/roleplay/live/sess-1",
        [{"type": "utterance", "text": "hi"}], 4401, "non-auth first frame",
    )

    # 3. Valid token, foreign session -> 4404 (not 403, not the data).
    SESSIONS["sess-other"] = make_session(user_id="somebody-else")
    await expect_close(
        "/roleplay/live/sess-other",
        [{"type": "auth", "token": VALID}], 4404, "foreign session",
    )

    # 4. Silence past the auth deadline -> 4401.
    original = main.WS_AUTH_TIMEOUT_SECONDS
    main.WS_AUTH_TIMEOUT_SECONDS = 0.2
    try:
        await expect_close("/roleplay/live/sess-1", [], 4401, "auth timeout")
    finally:
        main.WS_AUTH_TIMEOUT_SECONDS = original

    # 5. Happy path.
    async with WSHarness("/roleplay/live/sess-1") as ws:
        await ws.send_json({"type": "auth", "token": VALID})
        ready = await ws.receive_json()
        assert ready["type"] == "ready", ready
        assert "SECRET-EVIDENCE" not in repr(ready), "rubric evidence leaked!"
        names = [c["name"] for c in ready["scenario"]["rubric"]]
        assert names == ["Names the mechanism", "Explains the risk"], names
        assert all("evidence" not in c for c in ready["scenario"]["rubric"])
        print("PASS: ready frame carries criterion names, no evidence")

        await ws.send_json({"type": "utterance", "text": "It inhibits VKOR."})
        assert (await ws.receive_json())["type"] == "thinking"
        reply = await ws.receive_json()
        assert reply["type"] == "reply_text", reply
        notice = await ws.receive_json()
        assert notice["type"] == "notice" and notice["degraded"] is True, notice
        end = await ws.receive_json()
        assert end["type"] == "audio_end", end
        assert end["turn_id"] == reply["turn_id"]
        print("PASS: thinking -> reply_text -> degraded notice -> audio_end")

        # Empty utterance must not advance a turn.
        await ws.send_json({"type": "utterance", "text": "   "})
        await ws.send_json({"type": "end_session"})
        graded = await ws.receive_json()
        assert graded["type"] == "graded", graded
        assert SESSIONS["sess-1"]["persisted"]["turns_taken"] == 1, "empty utterance ran a turn"
        print("PASS: empty utterance ignored; end_session -> graded")

    print("\nGate D (offline portion) passes.")


asyncio.run(main_test())
