"""Voice roleplay sessions (ROADMAP_HONEN 4).

The student practices explaining their material out loud to a character who has
a reason to ask about it, and a grounded rubric grades the transcript at the
end. The scene is the delivery mechanism; the rubric is the feature.

Parallel to tutor_agent, and deliberately not part of it. The two share
patterns — the hot-cache-over-DB session store, the ownership rule, the
best-effort persistence — but not the state machine: a tutor session is a
question/answer loop with per-concept mastery gates, while a roleplay session
is a conversation with one terminal grading pass. Roleplay therefore stays out
of tutor_agent.MODES and off tutor_agent._sessions.

The one structural difference from tutor_agent is the **persisted/live split**.
A tutor session dict is entirely DB-shaped, so it can be handed to
db.save_tutor_session as-is. A roleplay session also holds a websocket, an
upstream STT socket, and an in-flight TTS task — none of which can be
serialized, and all of which are meaningless after a disconnect. Keeping those
under session["live"] means the persistence layer never has to know they exist,
and a reconnect rebuilds them without touching session["persisted"].
"""
import asyncio
import logging
import time
import uuid
from typing import Dict, List, Optional

from . import db
from . import memory_service
from . import tutor_agent
from .ai_service import BloomAI

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 2 * 60 * 60

# Lower than the tutor's 500: each of these may hold a live websocket and an
# upstream Deepgram socket, so an idle roleplay session is materially more
# expensive to keep around than an idle tutor session.
MAX_SESSIONS = 200

# Turn caps (ROADMAP_HONEN 4.8). Deliberately lower than the tutor's 20/35: a
# spoken turn costs an LLM call, a TTS call, and far more of the student's
# attention than a typed answer.
SOFT_NUDGE_TURNS = 12
HARD_CAP_TURNS = 20

# Below this, there is nothing to grade. Two student turns is the floor at
# which a rubric judgment means anything at all; grading one turn produces a
# confident-looking result built on almost no evidence.
MIN_TURNS_TO_GRADE = 2

_sessions: Dict[str, Dict] = {}


def _prune_sessions() -> None:
    """Evict expired and surplus sessions from the hot cache.

    Sessions with a live socket are skipped unconditionally. Pruning a session
    mid-scene would drop the transport out from under an active conversation
    and strand the student in a scene that no longer exists server-side — a
    rare bug, and a nasty one to diagnose from a support report.
    """
    now = time.time()

    def _live(session: Dict) -> bool:
        return bool((session.get("live") or {}).get("websocket"))

    expired = [
        sid for sid, s in _sessions.items()
        if now - s["updated_at"] > SESSION_TTL_SECONDS and not _live(s)
    ]
    for sid in expired:
        del _sessions[sid]

    if len(_sessions) > MAX_SESSIONS:
        idle = sorted(
            (sid for sid, s in _sessions.items() if not _live(s)),
            key=lambda sid: _sessions[sid]["updated_at"],
        )
        for sid in idle[: len(_sessions) - MAX_SESSIONS]:
            del _sessions[sid]


def _blank_persisted() -> Dict:
    """The DB-shaped half of a session, matching db._ROLEPLAY_STATE_FIELDS."""
    return {
        "scenario": None,
        "transcript": [],
        "rubric_result": None,
        "concepts": {},
        "turns_taken": 0,
        "checkpoint_shown": False,
    }


def _blank_live() -> Dict:
    """The half that is dropped on disconnect and rebuilt on reconnect."""
    return {
        "websocket": None,
        "flux": None,
        "tts_task": None,
        "current_turn_id": 0,
        "tts_degraded": False,
        "stt_degraded": False,
        # The mute button and push-to-talk gate. Open by default so a
        # text-mode client, which never sends mic_open, isn't gated on a
        # frame it has no reason to send.
        "mic_open": True,
    }


def _load_session(session_id: str, user_id: str) -> Optional[Dict]:
    """Fetch a session from the hot cache, falling back to the DB on a miss.

    Ownership is checked twice, on purpose. The DB query scopes by user in SQL,
    which covers the cold path; the explicit comparison covers the cache hit,
    where no query ran at all. Dropping either one makes a cached session
    readable by any authenticated user who guesses its id.
    """
    session = _sessions.get(session_id)
    if session is None:
        try:
            row = db.get_roleplay_session(session_id, user_id)
        except Exception:
            row = None
        if row is not None:
            session = {
                "user_id": row["user_id"],
                "subject": row["subject"],
                "text_content": row["text_content"],
                "sources": row["sources"],
                "persisted": {
                    field: row[field] for field in db._ROLEPLAY_STATE_FIELDS
                },
                "live": _blank_live(),
                "updated_at": time.time(),
            }
            _sessions[session_id] = session

    if session is None or session["user_id"] != user_id:
        return None
    return session


def _save(session_id: str, session: Dict) -> None:
    """Persist the mutable half. Best-effort, like every write in tutor_agent:
    a DB blip must not end a scene the student is in the middle of."""
    session["updated_at"] = time.time()
    try:
        db.save_roleplay_session(session_id, session["persisted"])
    except Exception:
        logger.warning("roleplay: failed to persist session %s", session_id, exc_info=True)


def public_scenario(scenario: Optional[Dict]) -> Dict:
    """The scenario as the client may see it.

    Strips `evidence` from every rubric row. The criterion *names* are shown to
    the student up front on purpose — knowing what a good explanation covers is
    the pedagogy, not a leak — but `evidence` names the specific source fact
    that makes each one checkable, which is the answer key.
    """
    if not scenario:
        return {}
    return {
        "title": scenario.get("title"),
        "character": scenario.get("character"),
        "situation": scenario.get("situation"),
        "student_role": scenario.get("student_role"),
        "opening_line": scenario.get("opening_line"),
        "rubric": [
            {"id": row.get("id"), "name": row.get("name")}
            for row in (scenario.get("rubric") or [])
        ],
    }


async def start_session(
    user_id: str, sources: List[Dict], subject: str, ai_service: BloomAI,
    concept: Optional[str] = None,
    progress=None,
) -> Dict:
    """Generate a grounded scenario and open a roleplay session.

    Raises on scenario failure rather than falling back to a canned scene: an
    ungrounded scenario defeats the entire premise of the feature, and a
    student would have no way to tell the difference until the rubric graded
    them against nothing.
    """
    _prune_sessions()

    def _report(stage: str):
        if progress:
            progress(stage)

    text_content = "\n\n".join(
        source["text_content"] for source in sources if source.get("text_content")
    )

    # Bias the scene toward something the student is already known to be weak
    # on, when the memory layer has an opinion. Best-effort: a scene about a
    # merely-arbitrary concept is still a good scene.
    if not concept:
        _report("Checking what you're shaky on")
        try:
            weak = await memory_service.weak_concepts_for_text(user_id, text_content)
        except Exception:
            weak = []
        concept = weak[0] if weak else subject

    _report("Writing the scene")
    scenario = await ai_service.generate_roleplay_scenario(text_content, concept, subject)

    _report("Checking it against your material")
    try:
        concepts = await asyncio.to_thread(
            tutor_agent._seed_concepts_sync,
            user_id,
            [{"topic": concept, "source": sources[0], "also_in": []}],
            subject,
        )
    except Exception:
        concepts = {}

    persisted = _blank_persisted()
    persisted["scenario"] = scenario
    persisted["concepts"] = concepts
    # The character speaks first, so the opening line is already a turn — it is
    # in the transcript from the start rather than being replayed on connect.
    if scenario.get("opening_line"):
        persisted["transcript"] = [{
            "role": "character",
            "text": scenario["opening_line"],
            "turn_id": 0,
        }]

    session = {
        "user_id": user_id,
        "subject": subject,
        "sources": sources,
        "text_content": text_content,
        "persisted": persisted,
        "live": _blank_live(),
        "updated_at": time.time(),
    }

    try:
        session_id = db.create_roleplay_session(user_id, {
            "subject": subject,
            "text_content": text_content,
            "sources": sources,
            **persisted,
        })
    except Exception:
        # Memory-only fallback, matching tutor_agent. Logged loudly because the
        # consequence is specific and invisible otherwise: this session can
        # never be recovered by GET /roleplay/{id}/result, and vanishes on the
        # next backend restart.
        session_id = str(uuid.uuid4())
        logger.error(
            "roleplay: DB insert failed, session %s is memory-only and "
            "cannot be recovered after a restart", session_id, exc_info=True,
        )

    _sessions[session_id] = session

    return {
        "session_id": session_id,
        "scenario": public_scenario(scenario),
        "opening_line": scenario.get("opening_line"),
        "grounding_concepts": scenario.get("grounding_concepts") or [],
    }


async def handle_utterance(
    session_id: str, session: Dict, text: str, ai_service: BloomAI,
) -> Dict:
    """Advance the scene by one student turn.

    Returns {"reply", "turn_id", "done", "nudge"}. Persists once, after the
    turn completes — never per audio chunk, since the transcript only changes
    at a turn boundary.
    """
    persisted = session["persisted"]
    scenario = persisted["scenario"] or {}
    live = session["live"]

    live["current_turn_id"] += 1
    turn_id = live["current_turn_id"]

    persisted["transcript"].append({
        "role": "student", "text": text, "turn_id": turn_id,
    })
    persisted["turns_taken"] += 1

    reply = await ai_service.roleplay_reply(
        scenario,
        persisted["transcript"],
        text,
        source_excerpt=session.get("text_content") or "",
    )

    if reply is None:
        # The character stalls in character rather than going silent. A silent
        # character is indistinguishable from a broken app, and this failure is
        # transient — the next turn usually works.
        reply_text = "Sorry — say that again? I lost the thread for a second."
    else:
        reply_text = reply["text"]

    persisted["transcript"].append({
        "role": "character", "text": reply_text, "turn_id": turn_id,
    })

    turns = persisted["turns_taken"]
    done = turns >= HARD_CAP_TURNS

    nudge = False
    if not done and turns >= SOFT_NUDGE_TURNS and not persisted["checkpoint_shown"]:
        persisted["checkpoint_shown"] = True
        nudge = True

    await asyncio.to_thread(_save, session_id, session)

    return {"reply": reply_text, "turn_id": turn_id, "done": done, "nudge": nudge}


async def grade_session(
    session_id: str, session: Dict, ai_service: BloomAI,
) -> Dict:
    """Grade the scene, record the attempt, and complete the session.

    Grading failure is **fail-silent, not fail-generous**: an ungradeable scene
    returns empty criteria and a null score with an honest message. Marking
    every criterion met would tell a student they demonstrated things they
    never said, which is worse than telling them the grader broke.
    """
    persisted = session["persisted"]
    scenario = persisted["scenario"] or {}
    transcript = persisted["transcript"]

    student_turns = sum(1 for turn in transcript if turn.get("role") == "student")

    if student_turns < MIN_TURNS_TO_GRADE:
        result = {
            "score": None,
            "criteria": [],
            "summary": None,
            "message": (
                "This scene ended too early to grade — there wasn't enough "
                "conversation to judge. Your transcript is below."
            ),
            "graded": False,
        }
    else:
        graded = await ai_service.grade_roleplay(transcript, scenario)
        if graded is None:
            result = {
                "score": None,
                "criteria": [],
                "summary": None,
                "message": (
                    "We couldn't grade this scene automatically. Here's your "
                    "full transcript."
                ),
                "graded": False,
            }
        else:
            result = {**graded, "message": None, "graded": True}

    persisted["rubric_result"] = result

    if result["graded"]:
        await asyncio.to_thread(_apply_mastery, session, result)

    try:
        await asyncio.to_thread(
            db.complete_roleplay_session, session_id,
            {"user_id": session["user_id"], "subject": session["subject"], **persisted},
        )
    except Exception:
        logger.warning("roleplay: failed to complete session %s", session_id, exc_info=True)

    _sessions.pop(session_id, None)

    return {**result, "transcript": transcript}


def _apply_mastery(session: Dict, result: Dict) -> None:
    """Nudge concept mastery from the rubric outcome.

    Weak on purpose. A roleplay criterion is graded by a model reading a
    conversation, which is softer evidence than an answer key, so this moves
    mastery by a fraction of what a graded question does. Deliberately does NOT
    call db.schedule_concept_review — a scene is not a spaced-repetition event,
    and treating it as one would reshuffle the student's review queue on the
    strength of a conversational judgment.
    """
    concepts = session["persisted"].get("concepts") or {}
    if not concepts:
        return

    criteria = result.get("criteria") or []
    if not criteria:
        return

    met = sum(1 for row in criteria if row.get("met"))
    ratio = met / len(criteria)

    # One signal for the scene as a whole, not one per criterion: the criteria
    # all probe the same concept from different angles, so counting each as an
    # independent observation would overstate the evidence several-fold.
    correct = ratio >= 0.5
    base = (
        tutor_agent.CORRECT_DELTA["medium"] if correct
        else tutor_agent.WRONG_DELTA["medium"]
    )
    weight = tutor_agent.EVIDENCE_WEIGHT[
        "roleplay_correct" if correct else "roleplay_wrong"
    ]
    delta = base * weight

    for name, state in concepts.items():
        if not isinstance(state, dict) or "mastery" not in state:
            continue
        state["mastery"] = min(1.0, max(0.05, state["mastery"] + delta))
        row_id = state.get("mastery_row_id")
        if not row_id:
            continue
        try:
            db.update_concept_mastery(
                row_id,
                state["mastery"],
                state.get("prior_questions_asked", 0) + 1,
                state.get("prior_questions_correct", 0) + (1 if correct else 0),
            )
        except Exception:
            logger.debug("roleplay: mastery write failed for %s", name, exc_info=True)
