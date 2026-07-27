import asyncio
import base64
import hashlib
import hmac
import os
import time
from typing import Optional
from fastapi import Header, HTTPException
from supabase import create_client, Client

_auth_client: Client = None

# Media tokens: the local-disk equivalent of an S3 presigned URL.
#
# A browser <audio src> can't send an Authorization header, so an audio URL has
# to carry its own proof of access. This signs {podcast_id, user_id, expiry}
# with the service-role key — the same secret that already backs auth — so a
# token is unforgeable, scoped to one episode and one user, and short-lived.
MEDIA_TOKEN_TTL_SECONDS = 6 * 60 * 60


def _get_auth_client() -> Client:
    global _auth_client
    if _auth_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required")
        _auth_client = create_client(url, key)
    return _auth_client


async def verify_bearer_token(token: str) -> Optional[str]:
    """Resolve a Supabase access token to its user's external_id, or None.

    Returns rather than raises because the websocket path can't use
    HTTPException: a failed WS auth has to close the socket with a status code,
    not unwind through FastAPI's HTTP error handling. get_current_user_id below
    is the HTTP-shaped wrapper.

    The Supabase client is synchronous, so the call goes through a thread. It
    runs on every authenticated request, and blocking the event loop there is
    survivable for REST but not for a real-time feature sharing the same loop.
    """
    if not token:
        return None

    try:
        result = await asyncio.to_thread(_get_auth_client().auth.get_user, token)
    except Exception:
        return None

    if not result or not result.user:
        return None

    return result.user.id


async def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    """FastAPI dependency: verifies the bearer token against Supabase Auth
    and returns the authenticated user's Supabase Auth UUID (external_id).
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    user_id = await verify_bearer_token(authorization.removeprefix("Bearer ").strip())
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return user_id


def _media_secret() -> bytes:
    secret = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not secret:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required to sign media tokens")
    return secret.encode()


def make_media_token(resource_id: str, user_id: str) -> str:
    """A signed, expiring grant to read one resource as one user."""
    expiry = int(time.time()) + MEDIA_TOKEN_TTL_SECONDS
    payload = f"{resource_id}:{user_id}:{expiry}"
    signature = hmac.new(_media_secret(), payload.encode(), hashlib.sha256).digest()
    return f"{expiry}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def verify_media_token(token: str, resource_id: str, user_id: str) -> bool:
    """Whether `token` is a live, untampered grant for this resource and user.

    Compared with compare_digest so a wrong signature can't be recovered by
    timing the failure.
    """
    try:
        expiry_str, signature = token.split(".", 1)
        expiry = int(expiry_str)
    except (ValueError, AttributeError):
        return False

    if expiry < time.time():
        return False

    payload = f"{resource_id}:{user_id}:{expiry}"
    expected = hmac.new(_media_secret(), payload.encode(), hashlib.sha256).digest()
    expected_b64 = base64.urlsafe_b64encode(expected).decode().rstrip("=")
    return hmac.compare_digest(signature, expected_b64)
