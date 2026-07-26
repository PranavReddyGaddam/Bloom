"""Ingest a URL (YouTube video, direct media, or article) into the same
plain-text-plus-filename shape that file uploads produce.

Everything downstream of extraction — chunking, embedding, overlap detection,
the documents library, tutor sources — consumes a text string and a display
name. So this module is purely additive: it produces those two things and
hands them to the existing pipeline. No study flow needs to know a document
came from a link rather than a file.

Structured like `extraction_agent`: async, takes an optional `progress`
callback, returns a budgeted string.
"""
import asyncio
import os
import re
import tempfile
from dataclasses import dataclass
from typing import List, Optional, Tuple
from urllib.parse import urlparse, parse_qs

import httpx

from .ai_service import BloomAI
from .extraction_agent import MAX_ASSEMBLED_CHARS

# Transcript fragments are merged up to roughly this size before being handed
# to the punctuation-restoration pass. Small enough that a failed chunk loses
# little, large enough that the model sees real context.
NORMALIZE_CHUNK_CHARS = 3000

# A caption track shorter than this almost certainly means the fetch
# "succeeded" but returned junk (a single "[Music]" cue, say). Treat it as a
# miss and fall through to the next tier rather than ingesting nothing.
MIN_USABLE_TRANSCRIPT_CHARS = 200

# Whisper is the slow tier; cap how much audio we're willing to sit through.
MAX_WHISPER_SECONDS = 90 * 60

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")

_YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "www.youtu.be", "music.youtube.com",
}

# Extensions that are unambiguously media, so we can skip the article path
# and go straight to yt-dlp + Whisper.
_MEDIA_EXTENSIONS = {
    ".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".opus",
    ".webm", ".mov", ".avi", ".mkv", ".flac", ".aac",
}


class IngestError(Exception):
    """Ingestion failed in a way the user can act on. The message is shown
    to them directly, so it must say what to try next — never a bare
    'failed'. A silent empty ingest is the one outcome we refuse."""


@dataclass
class IngestResult:
    """Text plus the display name it should be filed under."""
    filename: str
    text: str
    truncated: bool = False


def _youtube_video_id(url: str) -> Optional[str]:
    """Extract a video id from any of YouTube's URL shapes, or None."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host not in _YOUTUBE_HOSTS:
        return None

    if host in ("youtu.be", "www.youtu.be"):
        candidate = parsed.path.lstrip("/").split("/")[0]
        return candidate or None

    if parsed.path == "/watch":
        values = parse_qs(parsed.query).get("v")
        return values[0] if values else None

    # /shorts/ID, /embed/ID, /live/ID, /v/ID
    match = re.match(r"^/(?:shorts|embed|live|v)/([^/?#]+)", parsed.path)
    return match.group(1) if match else None


def _looks_like_media(url: str) -> bool:
    ext = os.path.splitext(urlparse(url).path)[1].lower()
    return ext in _MEDIA_EXTENSIONS


def _format_timestamp(seconds: float) -> str:
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


# ---------------------------------------------------------------------------
# Transcript normalization
# ---------------------------------------------------------------------------

_NORMALIZE_PROMPT = (
    "Restore punctuation, capitalization, and sentence boundaries in this "
    "auto-generated transcript.\n\n"
    "Rules:\n"
    "- Do NOT add, remove, summarize, or reword any content. Only fix "
    "punctuation, casing, and obvious transcription artifacts.\n"
    "- Keep every [t=SECONDS] marker exactly where it appears. They anchor "
    "text to moments in the video and must not be moved, merged, or dropped.\n"
    "- Break the text into paragraphs at natural topic shifts.\n"
    "- Return only the corrected transcript, with no preamble or commentary."
)


def _merge_fragments(snippets: List[dict]) -> List[Tuple[float, str]]:
    """Merge 2-5s caption fragments into paragraph-sized blocks, each tagged
    with the start time of its first fragment.

    Mirrors `memory_service._chunk_text`'s approach of accumulating to a
    character budget rather than splitting blindly, so a block boundary
    lands between fragments instead of mid-utterance.
    """
    blocks: List[Tuple[float, str]] = []
    current: List[str] = []
    current_start: Optional[float] = None
    current_len = 0

    for snippet in snippets:
        text = (snippet.get("text") or "").strip()
        # Auto-captions are littered with these and they carry no meaning.
        if not text or text in ("[Music]", "[Applause]", "[Laughter]"):
            continue
        text = text.replace("\n", " ")

        if current_start is None:
            current_start = float(snippet.get("start") or 0.0)

        current.append(text)
        current_len += len(text) + 1

        if current_len >= NORMALIZE_CHUNK_CHARS:
            blocks.append((current_start, " ".join(current)))
            current, current_start, current_len = [], None, 0

    if current and current_start is not None:
        blocks.append((current_start, " ".join(current)))

    return blocks


async def _normalize_transcript(
    snippets: List[dict],
    ai_service: BloomAI,
    report,
) -> str:
    """Turn raw caption fragments into punctuated, paragraphed prose with
    timestamps preserved.

    Raw auto-captions have no punctuation, no casing, and no sentence
    boundaries. Fed straight to the LLM they produce mush and visibly degrade
    every downstream artifact, so this pass is not cosmetic.

    Timestamps are carried through as `[t=SECONDS]` markers so a generated
    flashcard or quiz question can cite the exact moment in the video —
    the same citation philosophy as grounding verification.
    """
    blocks = _merge_fragments(snippets)
    if not blocks:
        return ""

    async def _normalize_block(start: float, raw: str) -> str:
        marker = f"[t={int(start)}]"
        try:
            cleaned = await ai_service._make_request([
                {"role": "system", "content": _NORMALIZE_PROMPT},
                {"role": "user", "content": f"{marker} {raw}"},
            ])
            cleaned = (cleaned or "").strip()
        except Exception:
            # Punctuation restoration is an improvement, not a requirement.
            # A failed block degrades to raw fragments rather than losing the
            # content — the same trade `_describe_page` makes for vision.
            cleaned = ""

        if not cleaned:
            return f"{marker} {raw}"
        # The model sometimes drops this block's marker, or moves it out of
        # leading position. Either way the block loses its anchor, so force a
        # correct one at the front. Markers the model kept further in are left
        # alone — they still point at real moments within the block.
        if not cleaned.startswith(marker):
            cleaned = re.sub(r"^\s*\[t=\d+\]\s*", "", cleaned)
            cleaned = f"{marker} {cleaned}"
        return cleaned

    report(f"Cleaning up transcript (0 of {len(blocks)} sections)")

    # Bounded concurrency: unbounded fan-out at a free-tier model is exactly
    # the mistake `extract_structured` made (roadmap "pre-existing issues" 3).
    semaphore = asyncio.Semaphore(4)
    completed = 0
    lock = asyncio.Lock()

    async def _guarded(start: float, raw: str) -> str:
        nonlocal completed
        async with semaphore:
            result = await _normalize_block(start, raw)
        async with lock:
            completed += 1
            report(f"Cleaning up transcript ({completed} of {len(blocks)} sections)")
        return result

    parts = await asyncio.gather(*[_guarded(start, raw) for start, raw in blocks])
    return "\n\n".join(p for p in parts if p.strip())


# ---------------------------------------------------------------------------
# YouTube — transcript with Whisper fallback
# ---------------------------------------------------------------------------
#
# YouTube transcript extraction is actively hostile as of 2026: PoToken bot
# detection, IP blocks on cloud hosts (roughly 100-200 req/hr/IP), and both
# major libraries break on a roughly quarterly cadence. Every tier here is
# assumed to fail; the cascade exists so that failure is survivable.


def _snippet_chars(snippets: List[dict]) -> int:
    return sum(len(s.get("text") or "") for s in snippets)


def _fetch_transcript_api(video_id: str) -> List[dict]:
    """Tier 1: youtube-transcript-api. Cheapest — no download at all."""
    from youtube_transcript_api import YouTubeTranscriptApi

    fetched = YouTubeTranscriptApi().fetch(video_id, languages=("en", "en-US", "en-GB"))
    return fetched.to_raw_data()


def _strip_overlap(previous: str, current: str) -> str:
    """Drop the leading words of `current` that merely repeat the trailing
    words of `previous`.

    Scrolling auto-captions overlap by a few words per cue. Comparison is
    case- and punctuation-insensitive because the two renderings of the same
    phrase often differ ("low" vs "low," / "28x28" vs "28x 28"). Longest
    overlap wins, so the maximal repeat is removed.
    """
    prev_words = previous.split()
    curr_words = current.split()
    if not prev_words or not curr_words:
        return current

    def _key(word: str) -> str:
        return re.sub(r"[^\w]", "", word).lower()

    prev_keys = [_key(w) for w in prev_words]
    curr_keys = [_key(w) for w in curr_words]

    # Exact suffix/prefix overlap — the common case.
    max_overlap = min(len(prev_keys), len(curr_keys))
    for size in range(max_overlap, 0, -1):
        if prev_keys[-size:] == curr_keys[:size]:
            return " ".join(curr_words[size:]).strip()

    # Shifted overlap: the new cue re-renders a phrase that ended the previous
    # one but prepends a word or two of its own ("...at an extremely low" then
    # "and rendered at an extremely low resolution..."). Find the longest
    # trailing run of `previous` that occurs early in `current` and cut
    # everything up to and including it.
    for size in range(max_overlap, 2, -1):
        tail = prev_keys[-size:]
        # Only look near the start; a genuine later repetition isn't scroll.
        for offset in range(1, min(4, len(curr_keys) - size + 1)):
            if curr_keys[offset:offset + size] == tail:
                return " ".join(curr_words[offset + size:]).strip()
    return current


def _parse_vtt(content: str) -> List[dict]:
    """Parse WebVTT cues into the same {text, start, duration} shape the
    transcript API returns, so both tiers feed one normalizer."""
    snippets: List[dict] = []
    timing = re.compile(
        r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*"
        r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})"
    )
    pending_start: Optional[float] = None
    pending_end: Optional[float] = None
    buffer: List[str] = []

    def _flush():
        if pending_start is None or not buffer:
            return
        text = " ".join(buffer).strip()
        if not text:
            return
        # Auto-caption VTT scrolls: consecutive cues overlap, repeating the
        # tail of the previous cue at the head of the next ("...extremely low"
        # then "and rendered at an extremely low resolution..."). Emitting
        # both duplicates whole phrases into the LLM's input, so trim the
        # repeated words off the front of the new cue.
        if snippets:
            previous = snippets[-1]["text"]
            if text == previous:
                return
            text = _strip_overlap(previous, text)
            if not text:
                return
        snippets.append({
            "text": text,
            "start": pending_start,
            "duration": max(0.0, (pending_end or pending_start) - pending_start),
        })

    for line in content.splitlines():
        stripped = line.strip()
        match = timing.search(stripped)
        if match:
            _flush()
            buffer = []
            h1, m1, s1, ms1, h2, m2, s2, ms2 = (int(g) for g in match.groups())
            pending_start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000
            pending_end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000
            continue
        if not stripped or stripped.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            continue
        if stripped.isdigit():
            continue
        # Strip inline karaoke timing tags that auto-captions embed.
        buffer.append(re.sub(r"<[^>]+>", "", stripped))

    _flush()
    return snippets


def _fetch_transcript_ytdlp(url: str) -> List[dict]:
    """Tier 2: yt-dlp subtitle download. Handles cases tier 1 chokes on."""
    import yt_dlp

    with tempfile.TemporaryDirectory() as tmpdir:
        options = {
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["en", "en-US", "en-GB", "en-orig"],
            "subtitlesformat": "vtt",
            "outtmpl": os.path.join(tmpdir, "sub"),
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
        }
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.download([url])

        for name in sorted(os.listdir(tmpdir)):
            if name.endswith(".vtt"):
                with open(os.path.join(tmpdir, name), "r", encoding="utf-8") as handle:
                    snippets = _parse_vtt(handle.read())
                if snippets:
                    return snippets
    return []


def _transcribe_with_whisper(url: str) -> List[dict]:
    """Tier 3: download audio and transcribe locally with faster-whisper.

    Slow — minutes for a long lecture — but it does not depend on captions
    existing or on YouTube cooperating with a caption fetch, which is the
    entire reason this tier was chosen over failing outright.
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise IngestError(
            "This video has no captions, and local transcription isn't "
            "installed on the server. Try a video with captions, or paste "
            "the text directly."
        )

    import yt_dlp

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, "audio.m4a")
        options = {
            "format": "bestaudio/best",
            "outtmpl": audio_path,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "m4a",
            }],
        }
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True)

        duration = (info or {}).get("duration") or 0
        if duration > MAX_WHISPER_SECONDS:
            raise IngestError(
                f"This video is {int(duration / 60)} minutes long and has no "
                "captions. Transcribing it locally would take too long — try "
                "a shorter video or one with captions."
            )

        # yt-dlp's postprocessor may have renamed the file.
        candidates = [
            os.path.join(tmpdir, n) for n in os.listdir(tmpdir)
            if not n.endswith(".part")
        ]
        if not candidates:
            raise IngestError("Could not download audio from that video.")
        source = max(candidates, key=os.path.getsize)

        model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        segments, _info = model.transcribe(source, vad_filter=True)
        return [
            {"text": segment.text.strip(), "start": segment.start,
             "duration": segment.end - segment.start}
            for segment in segments
            if segment.text.strip()
        ]


def _video_title(url: str) -> Optional[str]:
    """Best-effort title for the document display name."""
    try:
        import yt_dlp
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False)
        return (info or {}).get("title")
    except Exception:
        return None


async def _ingest_video(url: str, ai_service: BloomAI, report) -> IngestResult:
    """Run the caption cascade, then normalize whatever it produced."""
    video_id = _youtube_video_id(url)
    snippets: List[dict] = []

    if video_id:
        report("Fetching transcript")
        try:
            snippets = await asyncio.to_thread(_fetch_transcript_api, video_id)
        except Exception:
            snippets = []

        if _snippet_chars(snippets) < MIN_USABLE_TRANSCRIPT_CHARS:
            report("Fetching captions another way")
            try:
                snippets = await asyncio.to_thread(_fetch_transcript_ytdlp, url)
            except Exception:
                snippets = []

    if _snippet_chars(snippets) < MIN_USABLE_TRANSCRIPT_CHARS:
        report("No captions — transcribing audio, this may take a few minutes")
        snippets = await asyncio.to_thread(_transcribe_with_whisper, url)

    if _snippet_chars(snippets) < MIN_USABLE_TRANSCRIPT_CHARS:
        raise IngestError(
            "Couldn't get a usable transcript from that video. It may have no "
            "spoken content, or YouTube may be blocking transcript access. Try "
            "pasting the text directly."
        )

    title = await asyncio.to_thread(_video_title, url) or "Video"
    text = await _normalize_transcript(snippets, ai_service, report)
    if not text.strip():
        raise IngestError("That video's transcript came back empty.")
    return IngestResult(filename=title, text=text)


# ---------------------------------------------------------------------------
# Articles
# ---------------------------------------------------------------------------


async def _ingest_article(url: str, report) -> IngestResult:
    report("Fetching page")
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; BloomBot/1.0)"},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            html = response.text
    except httpx.HTTPStatusError as exc:
        raise IngestError(
            f"That page returned {exc.response.status_code}. Check the link is "
            "public and try again."
        )
    except Exception:
        raise IngestError("Couldn't reach that URL. Check the link and try again.")

    report("Extracting article text")

    def _extract() -> Tuple[Optional[str], Optional[str]]:
        import trafilatura
        from trafilatura.metadata import extract_metadata

        text = trafilatura.extract(
            html, include_comments=False, include_tables=True, favor_precision=True
        )
        title = None
        try:
            metadata = extract_metadata(html)
            title = metadata.title if metadata else None
        except Exception:
            pass
        return text, title

    text, title = await asyncio.to_thread(_extract)

    if not text or len(text.strip()) < 100:
        raise IngestError(
            "Couldn't find readable article text on that page. It may be "
            "mostly video or images, or behind a login."
        )

    if not title:
        title = urlparse(url).netloc or "Article"

    return IngestResult(filename=title.strip(), text=text.strip())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def ingest_url(url: str, ai_service: BloomAI = None, progress=None) -> IngestResult:
    """Fetch a URL and return study-ready text plus a display name.

    Dispatches on URL shape: YouTube and direct-media links go through the
    transcript cascade, everything else through readability extraction.
    """
    if ai_service is None:
        ai_service = BloomAI()

    def _report(stage: str):
        if progress:
            progress(stage)

    url = (url or "").strip()
    if not url:
        raise IngestError("No URL provided.")
    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = f"https://{url}"

    parsed = urlparse(url)
    if not parsed.netloc:
        raise IngestError("That doesn't look like a valid URL.")

    if _youtube_video_id(url) or _looks_like_media(url):
        result = await _ingest_video(url, ai_service, _report)
    else:
        result = await _ingest_article(url, _report)

    # Same budget as PDF extraction, for consistency across sources. A long
    # lecture transcript vastly exceeds it; the caller surfaces `truncated`
    # so the drop is visible rather than silent. Proper map-reduce over long
    # sources is ROADMAP_LEARNING item 3 stage 2, deliberately not solved here.
    if len(result.text) > MAX_ASSEMBLED_CHARS:
        result.text = ai_service._truncate(result.text, MAX_ASSEMBLED_CHARS)
        result.truncated = True

    return result
