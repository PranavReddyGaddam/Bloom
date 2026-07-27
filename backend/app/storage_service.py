"""Object storage for binary media — generated audio and uploaded originals.

Two kinds of thing live here, both too big for a database row and too big to
hand back inline with the JSON that describes them: podcast audio Bloom
generates (ROADMAP_HONEN 3.3), and the original PDF/DOCX/PPTX a student
uploaded, kept so they can look at the real document rather than only its
extracted text.

This module is the whole storage boundary: everything else in the backend
deals in opaque string keys and never imports boto3.

Two deliberate choices:

  * **Keys, not URLs, are what gets persisted.** A presigned URL expires and a
    public URL would make the bucket readable by anyone who learns the naming
    scheme. Storing the key means the bucket stays private and every read goes
    through an ownership check in the API layer, which is the same rule the
    rest of the data layer follows (db.get_document_content and friends are
    all user-scoped).

  * **boto3 is synchronous**, so every call here is wrapped in
    asyncio.to_thread — following memory_service.remember_upload's precedent.
    A multi-megabyte upload on the event loop would stall every concurrent
    request, including the /progress polls that exist to keep the UI moving.

Configuration is env-driven and lazy: `AWS_S3_BUCKET` (required to use this
module at all) plus `AWS_REGION`. Credentials come from boto3's standard
chain — env vars, shared config, or an instance role — so nothing secret is
read or stored here.
"""
import asyncio
import os
import threading
from pathlib import Path
from typing import Optional

# Presigned playback URLs are short-lived. Long enough to start and finish an
# episode comfortably; short enough that a leaked URL is not a durable grant.
PRESIGN_TTL_SECONDS = 6 * 60 * 60

# Local fallback root, used when no bucket is configured. Keeping the same
# key layout as S3 means a local-dev episode and a deployed one are addressed
# identically — the key stored in the database is valid under either backend,
# so moving between them never invalidates existing rows.
LOCAL_ROOT = Path(os.getenv("MEDIA_ROOT", Path(__file__).resolve().parent.parent / "media"))

_client = None
_client_lock = threading.Lock()


class StorageError(Exception):
    """Object storage was unavailable or rejected the operation.

    Distinct from a generation failure so callers can tell "we made a podcast
    but couldn't store the audio" from "we couldn't make a podcast" — the
    former still leaves a usable transcript.
    """


def bucket_name() -> Optional[str]:
    """The configured S3 bucket, or None when there isn't one.

    None does not mean "no storage" — it selects the local-disk backend. Both
    put_bytes and get_bytes work either way, so callers never branch on this;
    it exists so presigned_url knows whether an S3 URL is even possible.
    """
    return os.getenv("AWS_S3_BUCKET") or None


def _get_client():
    """Process-wide boto3 S3 client, built on first use.

    Double-checked locking because uploads run in worker threads via
    to_thread: two concurrent first-uploads would otherwise both see None and
    build a client, and boto3 client construction is not free.
    """
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                try:
                    import boto3
                except ImportError as exc:  # pragma: no cover - deployment issue
                    raise StorageError(
                        "boto3 is not installed; object storage is unavailable"
                    ) from exc
                _client = boto3.client("s3", region_name=os.getenv("AWS_REGION"))
    return _client


def _local_path(key: str) -> Path:
    """Filesystem path for an object key, confined to LOCAL_ROOT.

    Keys are built server-side (podcast_key), but this resolves and re-checks
    containment anyway: a key is the one part of the path that comes from
    outside this function, and a traversal here would read or write arbitrary
    files.
    """
    path = (LOCAL_ROOT / key).resolve()
    root = LOCAL_ROOT.resolve()
    if not str(path).startswith(str(root) + os.sep):
        raise StorageError("Refusing to access a path outside the media root")
    return path


def _put_sync(key: str, data: bytes, content_type: str) -> None:
    bucket = bucket_name()
    if not bucket:
        # No bucket configured: keep the episode on local disk rather than
        # refusing to store it. Audio generation shouldn't depend on cloud
        # setup being finished — a laptop with a Deepgram key is enough.
        try:
            path = _local_path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to write local media: {exc}") from exc
    try:
        _get_client().put_object(
            Bucket=bucket, Key=key, Body=data, ContentType=content_type
        )
    except StorageError:
        raise
    except Exception as exc:
        raise StorageError(f"Failed to store object: {exc}") from exc


def _get_sync(key: str) -> bytes:
    bucket = bucket_name()
    if not bucket:
        path = _local_path(key)
        if not path.is_file():
            raise StorageError("That file is no longer on disk")
        try:
            return path.read_bytes()
        except Exception as exc:
            raise StorageError(f"Failed to read local media: {exc}") from exc
    try:
        response = _get_client().get_object(Bucket=bucket, Key=key)
        return response["Body"].read()
    except StorageError:
        raise
    except Exception as exc:
        raise StorageError(f"Failed to read object: {exc}") from exc


async def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Store bytes under `key` and return the key back, for chaining into a
    DB write."""
    await asyncio.to_thread(_put_sync, key, data, content_type)
    return key


async def get_bytes(key: str) -> bytes:
    """Fetch a stored object's bytes. Raises StorageError if it's missing or
    storage isn't configured."""
    return await asyncio.to_thread(_get_sync, key)


def presigned_url(key: str) -> Optional[str]:
    """A time-limited GET URL for `key`, or None if one can't be produced.

    Offered as an optimization, not the primary read path: when it works the
    browser streams audio straight from S3 (with range requests, so scrubbing
    a long episode is cheap) instead of proxying every byte through the API.
    Callers must have already checked ownership — this function does no
    authorization of its own, and the returned URL grants access to anyone
    holding it until it expires.

    Returns None rather than raising so the caller can fall back to streaming
    through the API route; a missing URL is a performance loss, not an error.
    """
    bucket = bucket_name()
    if not bucket:
        return None
    try:
        return _get_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=PRESIGN_TTL_SECONDS,
        )
    except Exception:
        return None


def podcast_key(user_id: str, podcast_id: str) -> str:
    """Object key for one episode's audio.

    User-scoped prefix so a bucket policy or lifecycle rule can target one
    user's media, and so an accidental listing is at least organized by owner.
    """
    return f"podcasts/{user_id}/{podcast_id}.mp3"


def document_key(user_id: str, document_id: str, ext: str) -> str:
    """Object key for one upload's original file.

    `ext` must be an already-validated, lowercased extension (main.py checks
    membership in SUPPORTED_EXTENSIONS before this is reached) — never a raw
    client-supplied filename.

    Deliberately a sibling of podcast_key rather than a generic
    `media_key(prefix, ...)`: a shared helper would take the prefix as a
    parameter, and that is precisely the string you least want callable from
    outside this module, since it is what _local_path's traversal check
    defends.

    Keying on document_id rather than filename makes re-uploads correct for
    free. memory_service._store_document reuses the existing row when
    (user_id, filename) matches, so document_id is stable across re-uploads
    and the new file overwrites the old object in place — no orphan, no
    cleanup path.

    NOTE: both key functions take the *external* (Supabase) user id, not
    users.id. Callers in main.py hold the external id; anything inside
    memory_service or db holds the internal one, and mixing them would
    silently produce two different prefix layouts.
    """
    return f"documents/{user_id}/{document_id}{ext}"
