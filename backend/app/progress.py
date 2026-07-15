"""Stage-level progress for long operations (ROADMAP 2.2).

The long pipelines (upload-with-vision, summary critique/revise, quiz
grounding, tutor session start) run 30+ seconds. Instead of a frozen
spinner, the frontend generates a progress id, passes it with the request,
and polls GET /progress/{id} while the request is in flight; the pipeline
reports human-readable stage strings ("Describing page 4 of 12") here as it
goes.

Deliberately in-memory and best-effort: progress is cosmetic, shares the
request's process (single uvicorn worker), and losing it on restart is
fine — the polling frontend just shows its generic fallback text.
"""
import threading
import time
from typing import Dict, Optional

TTL_SECONDS = 15 * 60
MAX_ENTRIES = 1000

_entries: Dict[str, Dict] = {}
_lock = threading.Lock()


def _prune_locked() -> None:
    now = time.time()
    expired = [pid for pid, e in _entries.items() if now - e["updated_at"] > TTL_SECONDS]
    for pid in expired:
        del _entries[pid]
    if len(_entries) > MAX_ENTRIES:
        for pid in sorted(_entries, key=lambda p: _entries[p]["updated_at"])[: len(_entries) - MAX_ENTRIES]:
            del _entries[pid]


def report(progress_id: Optional[str], stage: str) -> None:
    """Record the current stage for a progress id. No-op without an id, so
    pipelines can call this unconditionally."""
    if not progress_id:
        return
    with _lock:
        _prune_locked()
        _entries[progress_id[:128]] = {"stage": stage, "updated_at": time.time()}


def get_stage(progress_id: str) -> Optional[str]:
    with _lock:
        entry = _entries.get(progress_id[:128])
        return entry["stage"] if entry else None


def clear(progress_id: Optional[str]) -> None:
    """Drop an operation's entry once it finishes, so a stale last stage
    isn't shown if the client reuses or re-polls the id."""
    if not progress_id:
        return
    with _lock:
        _entries.pop(progress_id[:128], None)


def reporter(progress_id: Optional[str]):
    """A `progress(stage)` callable bound to one id, for passing down into
    pipelines without threading the id itself everywhere."""
    def _report(stage: str) -> None:
        report(progress_id, stage)
    return _report
