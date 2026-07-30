"""Text-to-speech via Deepgram Aura-2 (ROADMAP_HONEN 3.2).

Synthesizes a two-speaker podcast episode. Verified against the Deepgram TTS
docs on 2026-07-26:

  * `POST https://api.deepgram.com/v1/speak`, auth header is
    `Authorization: Token <key>` — note **Token**, not Bearer.
  * Model/encoding/sample-rate are **query parameters**; only `{"text": ...}`
    goes in the JSON body.
  * **2000 characters max per request.** Fine here — a script segment is 2-4
    sentences — but long segments are split rather than truncated, because
    silently dropping the back half of a sentence is worse than a seam.
  * One voice per request. There is no multi-speaker mode, so a two-speaker
    episode is synthesized per segment and joined here.

Because there is no dialogue mode, this module owns assembly:

  * Audio is requested as **linear16 PCM with no container** at 24 kHz, so
    segments concatenate as raw samples. Requesting MP3 per segment would mean
    decoding each one before joining, and MP3 frame boundaries don't align with
    segment boundaries — that is where audible seams come from. One encode at
    the end avoids the problem entirely.
  * Per-segment sample counts give **exact** playback offsets, which is
    strictly better than the word-count estimate the player would otherwise
    use for follow-along highlighting.

Segments are independent requests, so they synthesize concurrently, bounded by
a semaphore — an unbounded fan-out over a 30-segment episode is the same bug
the roadmap flags in extract_structured.
"""
import asyncio
import io
import os
import re
from typing import Dict, List, Optional, Tuple

import httpx

SPEAK_URL = "https://api.deepgram.com/v1/speak"

# Aura-2 voices, chosen for contrast first: the main failure mode of a
# two-voice episode is a listener losing track of who is speaking, which a
# same-gender pair invites no matter how good each voice is.
#   thalia  — "clear, confident, energetic", conversational: the host asking
#             the questions a student would ask.
#   orpheus — "professional, clear, confident, trustworthy", listed for
#             storytelling: the explainer, who carries the actual teaching.
DEFAULT_HOST_VOICE = os.getenv("DEEPGRAM_VOICE_HOST", "aura-2-thalia-en")
DEFAULT_EXPLAINER_VOICE = os.getenv("DEEPGRAM_VOICE_EXPLAINER", "aura-2-orpheus-en")

# The roleplay character's voice. One voice for every character, deliberately:
# `voice_style` shapes the LLM prompt instead, which is where perceived
# characterization actually lives. Per-character voice selection is a v2 —
# Aura-2's roster makes that attractive, but it is not what makes a scene work.
DEFAULT_ROLEPLAY_VOICE = os.getenv("DEEPGRAM_VOICE_CHARACTER", "aura-2-thalia-en")

# linear16 at 24 kHz. Deepgram's default sample rate, and high enough that the
# single MP3 encode at the end is the only lossy step in the pipeline.
SAMPLE_RATE = 24000

# Deepgram's documented per-request ceiling.
MAX_REQUEST_CHARS = 2000

# Bounded fan-out. Segments are independent, so they could all fire at once —
# but a 30-segment episode firing 30 simultaneous requests is how you get
# rate-limited (429) and turn a working episode into a partial one.
MAX_CONCURRENCY = int(os.getenv("DEEPGRAM_TTS_CONCURRENCY", "4"))

# Silence between turns. Long enough to read as a speaker change rather than
# one person pausing; short enough not to feel like dead air.
INTER_TURN_PAUSE_SECONDS = 0.35

# Per-request timeout. A segment is a few sentences, so this is generous;
# connect stays short because a hung connect is a different failure.
SYNTH_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


class TTSError(Exception):
    """Synthesis failed.

    `code` is a stable short string for the frontend to branch on and
    `user_message` is safe to show directly — a student whose episode failed
    needs to know whether to retry or whether something is misconfigured.
    """

    def __init__(self, code: str, user_message: str):
        super().__init__(user_message)
        self.code = code
        self.user_message = user_message


def is_configured() -> bool:
    """Whether TTS can run at all.

    Checked before the LLM writes a script so a missing key costs nothing
    rather than surfacing after a 30-second generation.
    """
    return bool(os.getenv("DEEPGRAM_API_KEY"))


def voice_for(speaker: str) -> str:
    """Map a script role to a voice. Unknown roles get the explainer voice —
    an unfamiliar voice is a smaller error than crashing an episode."""
    return DEFAULT_HOST_VOICE if speaker == "host" else DEFAULT_EXPLAINER_VOICE


def _split_for_limit(text: str, limit: int = MAX_REQUEST_CHARS) -> List[str]:
    """Split an over-long segment at sentence boundaries.

    Only reached if the script generator ignores its 2-4 sentence instruction.
    Splitting rather than truncating because losing the end of an explanation
    is a silent content bug, while a seam mid-segment is merely audible.
    """
    if len(text) <= limit:
        return [text]

    parts: List[str] = []
    current = ""
    # Keep the delimiter with the sentence it ends.
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if not current:
            current = sentence
        elif len(current) + 1 + len(sentence) <= limit:
            current = f"{current} {sentence}"
        else:
            parts.append(current)
            current = sentence

    if current:
        parts.append(current)

    # A single sentence longer than the limit still has to be cut somewhere;
    # a hard slice is the last resort.
    out: List[str] = []
    for part in parts:
        while len(part) > limit:
            out.append(part[:limit])
            part = part[limit:]
        if part:
            out.append(part)
    return out


def _error_for_status(status: int) -> TTSError:
    """Map a documented Deepgram failure to something actionable."""
    if status in (401, 403):
        return TTSError(
            "tts_auth",
            "The audio service rejected our credentials. Check DEEPGRAM_API_KEY.",
        )
    if status == 402:
        return TTSError(
            "tts_no_credit",
            "The audio service is out of credit, so this episode couldn't be "
            "recorded. The script below is still yours to read.",
        )
    if status == 413:
        return TTSError(
            "tts_too_long",
            "A line of this script was too long for the audio service. This is a "
            "bug on our side, not yours.",
        )
    if status == 422:
        return TTSError(
            "tts_rejected",
            "The audio service rejected this script. This is a bug on our side, "
            "not yours.",
        )
    if status == 429:
        return TTSError(
            "tts_rate_limited",
            "The audio service is rate-limiting us right now. Try again in a minute.",
        )
    return TTSError("tts_failed", f"Audio synthesis failed (HTTP {status}).")


async def _synthesize_one(
    text: str, voice: str, client: httpx.AsyncClient, semaphore: asyncio.Semaphore,
    encoding: str = "linear16", container: str = "none",
) -> bytes:
    """Audio bytes for one piece of text.

    Defaults to raw PCM (linear16, headerless) for the podcast path, which
    concatenates segments as samples. The roleplay path overrides to MP3 —
    generalizing here rather than copying this function means a Deepgram API
    change is fixed once, for both callers.
    """
    api_key = os.getenv("DEEPGRAM_API_KEY")
    params = {
        "model": voice,
        "encoding": encoding,
    }
    # sample_rate and container are both meaningful only for raw PCM. MP3
    # carries its own rate in the bitstream, and Deepgram rejects the request
    # outright with UNSUPPORTED_AUDIO_FORMAT if `container` is sent alongside
    # `encoding=mp3` — so for the roleplay path both are omitted rather than
    # defaulted.
    if encoding == "linear16":
        params["sample_rate"] = str(SAMPLE_RATE)
        # For the podcast path, no container: a WAV header per segment would
        # land in the middle of the joined stream and be decoded as noise.
        params["container"] = container
    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": "application/json",
    }

    async with semaphore:
        try:
            response = await client.post(
                SPEAK_URL, params=params, headers=headers,
                json={"text": text}, timeout=SYNTH_TIMEOUT,
            )
        except httpx.TimeoutException as exc:
            raise TTSError(
                "tts_timeout", "The audio service timed out while recording this episode."
            ) from exc
        except Exception as exc:
            raise TTSError("tts_failed", f"Audio synthesis failed: {exc}") from exc

    if response.status_code != 200:
        raise _error_for_status(response.status_code)
    return response.content


async def synthesize_dialogue(
    segments: List[Dict],
    client: Optional[httpx.AsyncClient] = None,
    progress=None,
) -> Tuple[bytes, List[float], int]:
    """Render a two-speaker script to one MP3.

    Returns `(mp3_bytes, segment_offsets, duration_seconds)`, where
    `segment_offsets[i]` is the playback start of `segments[i]` in seconds.
    Those offsets are exact — derived from sample counts, not estimated from
    word counts — so the player can highlight and seek accurately.

    Raises TTSError for every failure. Callers keep the script and degrade to
    a transcript-only episode rather than losing the whole generation, since
    the script is the expensive part.
    """
    if not is_configured():
        raise TTSError(
            "tts_unconfigured",
            "Audio generation isn't set up on this server (DEEPGRAM_API_KEY is missing).",
        )

    # numpy and soundfile are only needed when audio is actually produced, so
    # a deployment that never generates podcasts doesn't pay for the imports.
    try:
        import numpy as np
        import soundfile as sf
    except ImportError as exc:  # pragma: no cover - deployment issue
        raise TTSError(
            "tts_unconfigured",
            "Audio support isn't installed on this server (numpy/soundfile missing).",
        ) from exc

    # One synthesis unit per request, remembering which segment it belongs to
    # so an over-long segment's pieces rejoin as a single turn.
    units: List[Tuple[int, str, str]] = []
    for index, segment in enumerate(segments):
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        voice = voice_for(segment.get("speaker"))
        for piece in _split_for_limit(text):
            units.append((index, piece, voice))

    if not units:
        raise TTSError("tts_empty_script", "There was no dialogue to record.")

    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    owned = client is None
    http = client or httpx.AsyncClient(timeout=SYNTH_TIMEOUT)

    total = len(units)
    done = 0
    lock = asyncio.Lock()

    async def render(unit: Tuple[int, str, str]) -> bytes:
        nonlocal done
        index, text, voice = unit
        audio = await _synthesize_one(text, voice, http, semaphore)
        # Requests complete out of order, so report a count rather than
        # "segment 3 of 18" — the same reasoning as _ground_questions.
        async with lock:
            done += 1
            if progress:
                progress(f"Recording ({done} of {total})")
        return audio

    try:
        # Order is preserved by gather regardless of completion order, which
        # is what lets the pieces be concatenated directly below.
        rendered = await asyncio.gather(*(render(u) for u in units))
    finally:
        if owned:
            await http.aclose()

    pause = np.zeros(int(SAMPLE_RATE * INTER_TURN_PAUSE_SECONDS), dtype=np.int16)

    pieces: List["np.ndarray"] = []
    offsets: List[float] = []
    samples = 0
    current_segment: Optional[int] = None

    for (index, _, _), audio in zip(units, rendered):
        if index != current_segment:
            # New turn: insert the pause first (except before the first turn)
            # so the recorded offset points at speech, not at silence.
            if current_segment is not None:
                pieces.append(pause)
                samples += len(pause)
            offsets.append(samples / SAMPLE_RATE)
            current_segment = index

        pcm = np.frombuffer(audio, dtype=np.int16)
        pieces.append(pcm)
        samples += len(pcm)

    if not pieces:
        raise TTSError("tts_empty_audio", "The audio service returned an empty recording.")

    full = np.concatenate(pieces)

    buffer = io.BytesIO()
    try:
        sf.write(buffer, full, SAMPLE_RATE, format="MP3")
    except Exception as exc:
        raise TTSError("tts_encode_failed", f"Couldn't encode the episode: {exc}") from exc

    return buffer.getvalue(), offsets, round(len(full) / SAMPLE_RATE)


async def synthesize_turn(
    text: str, voice: Optional[str] = None, client: Optional[httpx.AsyncClient] = None,
) -> bytes:
    """MP3 bytes for one spoken line of roleplay dialogue.

    Raises TTSError with the same codes as the podcast path — callers degrade
    to showing the line as text rather than losing the turn.

    **Plain HTTP, not the streaming WebSocket, and that is a considered
    choice.** What streaming buys is time-to-first-audio, and its size is
    bounded by what is already serialized ahead of it: ai_service._make_request
    is non-streaming, so the entire reply text exists before the first byte of
    synthesis is requested. A 1-3 sentence reply is ~4-8s of speech and
    ~50-100KB of MP3 over an already-warm keep-alive pool — the realistic gap
    between "first chunk at ~250ms" and "whole clip at ~600ms" is ~300ms on a
    turn floor of 1-1.5s, invisible beside the LLM term.

    Against that, streaming would cost: a second concurrent Deepgram WS per
    session sharing one key's rate limit with Flux *and* any podcast job; the
    mandatory Speak->Flush->Close sequence whose omission is a **silent hang**,
    the worst failure signature this feature could have; flush-quota
    bookkeeping; a read task and cancellation path per turn; and errors
    arriving as close codes with none of _error_for_status's student-safe
    mapping, so the "402 -> speak as text" path would need reimplementing.

    HTTP reuses all of that for free.

    **Revisit the moment ai_service grows a streaming _stream_request** — at
    that point the reply text no longer exists up front, time-to-first-audio
    stops being bounded by the LLM, and streaming Aura-2 over WS (with its
    `Clear` message for barge-in) becomes the right call. This note exists so
    that decision isn't re-litigated from scratch before then.
    """
    if not is_configured():
        raise TTSError(
            "tts_unconfigured",
            "Audio generation isn't set up on this server (DEEPGRAM_API_KEY is missing).",
        )

    text = (text or "").strip()
    if not text:
        raise TTSError("tts_empty_script", "There was nothing to say.")

    owned = client is None
    http = client or httpx.AsyncClient(timeout=SYNTH_TIMEOUT)

    # The same module-level semaphore the podcast path uses, so a roleplay turn
    # and a concurrent podcast job can't jointly blow the shared rate limit —
    # one key serves both, plus Flux.
    semaphore = _turn_semaphore()

    try:
        # A reply is 1-3 sentences, so the split is a no-op in practice; it
        # only matters if the model ignores its instruction, and a seam beats
        # a 413.
        pieces = _split_for_limit(text)
        rendered = [
            await _synthesize_one(
                piece, voice or DEFAULT_ROLEPLAY_VOICE, http, semaphore,
                encoding="mp3", container="none",
            )
            for piece in pieces
        ]
    finally:
        if owned:
            await http.aclose()

    audio = b"".join(rendered)
    if not audio:
        raise TTSError("tts_empty_audio", "The audio service returned an empty recording.")
    return audio


_TURN_SEMAPHORE: Optional[asyncio.Semaphore] = None


def _turn_semaphore() -> asyncio.Semaphore:
    """The shared synthesis semaphore, created on the running loop.

    Lazily built rather than at import time: an asyncio.Semaphore binds to the
    loop that exists when it is constructed, and at import there may not be one
    — a module-level semaphore is a classic source of "attached to a different
    loop" errors under uvicorn's reload.
    """
    global _TURN_SEMAPHORE
    if _TURN_SEMAPHORE is None:
        _TURN_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENCY)
    return _TURN_SEMAPHORE
