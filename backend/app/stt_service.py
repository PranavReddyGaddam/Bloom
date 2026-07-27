"""Speech-to-text via Deepgram Flux (ROADMAP_HONEN 4.6).

Flux does *model-integrated end-of-turn detection*: it emits turn boundaries
directly rather than leaving the caller to reconstruct them from a batch
transcriber. That deletes most of what a roleplay STT layer would otherwise
need — browser energy-VAD, sliding re-transcription, a partial-length floor, a
buffer cap, and per-session concurrency semaphores all existed to approximate
what this protocol states outright.

Verified against the Deepgram Flux docs on 2026-07-26:

  * `wss://api.deepgram.com/v2/listen` — note **v2**, not v1.
  * Auth header is `Authorization: Token <key>` (**Token**, not Bearer), the
    same spelling tts_service uses.
  * `encoding` and `sample_rate` are **required** for raw audio, as query
    params alongside `model`.
  * Audio is mono, in **80ms chunks** — Deepgram calls this "strongly
    recommended for optimal model performance and latency", and at 16kHz s16le
    that is exactly 2560 bytes.
  * Server events: `Connected`, `TurnInfo`, `ConfigureSuccess`/`Failure`, and
    `{"type":"Error","code","description"}`. `TurnInfo.event` is one of
    `StartOfTurn | EagerEndOfTurn | TurnResumed | Update | EndOfTurn`.

**Socket lifetime: one per session, lazily opened, idle-reaped.** This is the
opposite of the TTS decision — correctly so, because a Flux socket carries
conversational state and a TTS socket doesn't:

  * `turn_index` is per-connection and monotonic, which is exactly the turn id
    the wire protocol needs. Reconnecting per turn resets it to 0 and forces a
    server-side counter to reconcile against.
  * Flux's end-of-turn model is stateful across the audio stream — acoustic and
    semantic context carries over the boundary. Reconnecting per turn throws
    that away.
  * An STT handshake sits on the critical path of the student's own speech,
    where nothing can overlap it. A TTS handshake overlaps the LLM call.

Long silences are handled by idle reaping rather than per-turn churn, which
doubles as the cost control: Flux bills streamed audio, so a student staring at
the screen is still uploading. After STT_IDLE_CLOSE_SECONDS the socket closes
and the next send_audio() transparently reopens it.
"""
import asyncio
import json
import logging
import os
from typing import AsyncIterator, Dict, List, Optional
from urllib.parse import urlencode

logger = logging.getLogger(__name__)

LISTEN_URL = "wss://api.deepgram.com/v2/listen"

DEFAULT_MODEL = os.getenv("DEEPGRAM_STT_MODEL", "flux-general-en")
DEFAULT_LANGUAGE = os.getenv("DEEPGRAM_STT_LANGUAGE", "en")

# 16kHz mono s16le. Pinned to match the browser's capture AudioContext, which
# is also 16000 — one rate for both directions means no resampling anywhere in
# the pipeline and no chance of a rate mismatch playing audio at the wrong
# speed.
SAMPLE_RATE = 16000
ENCODING = "linear16"

# 80ms at 16kHz, 2 bytes per sample.
CHUNK_BYTES = int(SAMPLE_RATE * 0.08) * 2

# How confident Flux must be that a turn ended. Raise toward 0.8 if students
# report being cut off mid-thought; lower makes the character interrupt.
EOT_THRESHOLD = float(os.getenv("DEEPGRAM_EOT_THRESHOLD", "0.7"))
EOT_TIMEOUT_MS = int(os.getenv("DEEPGRAM_EOT_TIMEOUT_MS", "5000"))

# Close the upstream socket after this much silence. Both a cost control and a
# politeness measure toward Deepgram's connection limits.
STT_IDLE_CLOSE_SECONDS = int(os.getenv("DEEPGRAM_STT_IDLE_SECONDS", "180"))

# Keepalive. Without these an intermediary can silently drop an idle socket,
# which surfaces as audio vanishing rather than as an error.
PING_INTERVAL = 20
PING_TIMEOUT = 20

# Flux takes a bounded number of keyterms; more than this is diminishing
# returns and a longer URL.
MAX_KEYTERMS = 10


class STTError(Exception):
    """Transcription failed.

    Same shape as tts_service.TTSError on purpose: both map onto the wire
    protocol's `notice {code, message}` frame identically, so the socket
    handler needs one branch rather than two.
    """

    def __init__(self, code: str, user_message: str):
        super().__init__(user_message)
        self.code = code
        self.user_message = user_message


def is_configured() -> bool:
    """Whether live transcription can run. Same key as tts_service."""
    return bool(os.getenv("DEEPGRAM_API_KEY"))


def _error_for_close(code: Optional[int]) -> STTError:
    """Map a websocket close code to something a student can act on."""
    if code in (1008, 4001, 4003):
        return STTError(
            "stt_auth",
            "The speech service rejected our credentials. Check DEEPGRAM_API_KEY.",
        )
    if code == 4008:
        return STTError(
            "stt_rate_limited",
            "The speech service is rate-limiting us right now. Try again in a minute.",
        )
    return STTError(
        "stt_unavailable",
        "The speech service dropped out. You can keep going by typing instead.",
    )


class FluxSession:
    """One Deepgram Flux socket, bound to one roleplay session.

    Usage:

        flux = FluxSession(keyterms=scenario["grounding_concepts"])
        async for event in flux.events():
            ...                       # normalized TurnInfo dicts
        await flux.send_audio(pcm)    # connects on first call
        await flux.close()

    `events()` yields normalized dicts — `{"event", "transcript", "turn_index",
    "end_of_turn_confidence"}` — so the caller never parses Deepgram's wire
    format. A reconnect is invisible to the iterator.
    """

    def __init__(self, keyterms: Optional[List[str]] = None):
        self._keyterms = list(dict.fromkeys(keyterms or []))[:MAX_KEYTERMS]
        self._socket = None
        self._lock = asyncio.Lock()
        self._queue: asyncio.Queue = asyncio.Queue()
        self._reader: Optional[asyncio.Task] = None
        self._reaper: Optional[asyncio.Task] = None
        self._last_audio_at = 0.0
        self._closed = False
        # Flux resets turn_index to 0 on every connection, so a reconnect
        # mid-scene would replay ids the client has already seen. This offset
        # keeps the ids the caller sees monotonic across reconnects.
        self._turn_offset = 0
        self._max_turn_seen = -1

    def _url(self) -> str:
        params = [
            ("model", DEFAULT_MODEL),
            ("encoding", ENCODING),
            ("sample_rate", str(SAMPLE_RATE)),
            ("language_hint", DEFAULT_LANGUAGE),
            ("eot_threshold", str(EOT_THRESHOLD)),
            ("eot_timeout_ms", str(EOT_TIMEOUT_MS)),
        ]
        # One keyterm param per grounding concept. Domain vocabulary is
        # precisely what a general STT model mangles, and a mangled term is
        # what makes the rubric grader miss a criterion the student met.
        params.extend(("keyterm", term) for term in self._keyterms)
        return f"{LISTEN_URL}?{urlencode(params)}"

    async def _ensure_connected(self) -> None:
        """Open the socket if it isn't open. Safe to call on every chunk."""
        if self._socket is not None or self._closed:
            return

        async with self._lock:
            if self._socket is not None or self._closed:
                return

            api_key = os.getenv("DEEPGRAM_API_KEY")
            if not api_key:
                raise STTError(
                    "stt_unconfigured",
                    "Speech recognition isn't set up on this server "
                    "(DEEPGRAM_API_KEY is missing).",
                )

            # Imported here rather than at module scope so a deployment that
            # never runs roleplay doesn't need the dependency present.
            try:
                import websockets
            except ImportError as exc:  # pragma: no cover - deployment issue
                raise STTError(
                    "stt_unconfigured",
                    "Speech support isn't installed on this server (websockets missing).",
                ) from exc

            try:
                self._socket = await websockets.connect(
                    self._url(),
                    additional_headers={"Authorization": f"Token {api_key}"},
                    ping_interval=PING_INTERVAL,
                    ping_timeout=PING_TIMEOUT,
                )
            except Exception as exc:
                raise STTError(
                    "stt_unavailable",
                    "Couldn't reach the speech service. You can keep going by typing instead.",
                ) from exc

            self._turn_offset = self._max_turn_seen + 1
            self._reader = asyncio.create_task(self._read_loop())
            if self._reaper is None:
                self._reaper = asyncio.create_task(self._reap_loop())

    async def _read_loop(self) -> None:
        """Normalize server events onto the queue until the socket closes."""
        socket = self._socket
        try:
            async for raw in socket:
                if isinstance(raw, bytes):
                    continue
                try:
                    message = json.loads(raw)
                except (ValueError, TypeError):
                    continue

                kind = message.get("type")

                if kind == "Error":
                    await self._queue.put({
                        "event": "Error",
                        "code": message.get("code"),
                        "description": message.get("description"),
                    })
                    continue

                if kind != "TurnInfo":
                    # Connected / ConfigureSuccess / ConfigureFailure are
                    # lifecycle noise the caller has no decision to make about.
                    continue

                index = message.get("turn_index")
                index = (index or 0) + self._turn_offset
                self._max_turn_seen = max(self._max_turn_seen, index)

                await self._queue.put({
                    "event": message.get("event"),
                    "transcript": message.get("transcript") or "",
                    "turn_index": index,
                    "end_of_turn_confidence": message.get("end_of_turn_confidence"),
                })
        except Exception:
            # A dropped socket is expected on idle reaping and on network
            # blips; the next send_audio reconnects. Only surface it if the
            # session wasn't deliberately closed.
            if not self._closed:
                logger.debug("stt: read loop ended", exc_info=True)
        finally:
            if self._socket is socket:
                self._socket = None

    async def _reap_loop(self) -> None:
        """Close the socket after STT_IDLE_CLOSE_SECONDS without audio."""
        try:
            while not self._closed:
                await asyncio.sleep(5)
                if self._socket is None or not self._last_audio_at:
                    continue
                idle = asyncio.get_running_loop().time() - self._last_audio_at
                if idle >= STT_IDLE_CLOSE_SECONDS:
                    logger.debug("stt: reaping idle socket after %.0fs", idle)
                    await self._close_socket()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("stt: reaper stopped", exc_info=True)

    async def send_audio(self, pcm: bytes) -> None:
        """Stream one chunk of 16kHz mono s16le PCM.

        Reconnects transparently if the socket was idle-reaped, so the caller
        never has to know the connection has a lifetime.
        """
        if self._closed or not pcm:
            return

        await self._ensure_connected()
        self._last_audio_at = asyncio.get_running_loop().time()

        socket = self._socket
        if socket is None:
            return
        try:
            await socket.send(pcm)
        except Exception:
            # Drop the socket rather than raising: the next chunk reconnects,
            # and a mid-sentence blip shouldn't end the scene.
            await self._close_socket()

    async def events(self) -> AsyncIterator[Dict]:
        """Normalized turn events, in order, across reconnects."""
        while not self._closed:
            event = await self._queue.get()
            if event is None:
                break
            yield event

    async def _close_socket(self) -> None:
        socket = self._socket
        self._socket = None
        if socket is None:
            return
        try:
            await socket.close()
        except Exception:
            pass

    async def close(self) -> None:
        """Close for good. Sends CloseStream so Flux flushes its final turn."""
        if self._closed:
            return
        self._closed = True

        socket = self._socket
        if socket is not None:
            try:
                await socket.send(json.dumps({"type": "CloseStream"}))
            except Exception:
                pass
        await self._close_socket()

        for task in (self._reader, self._reaper):
            if task is not None:
                task.cancel()

        # Unblock any consumer parked on events().
        await self._queue.put(None)
