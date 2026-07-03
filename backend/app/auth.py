import os
from typing import Optional
from fastapi import Header, HTTPException
from supabase import create_client, Client

_auth_client: Client = None


def _get_auth_client() -> Client:
    global _auth_client
    if _auth_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required")
        _auth_client = create_client(url, key)
    return _auth_client


async def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    """FastAPI dependency: verifies the bearer token against Supabase Auth
    and returns the authenticated user's Supabase Auth UUID (external_id).
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    token = authorization.removeprefix("Bearer ").strip()

    try:
        result = _get_auth_client().auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if not result or not result.user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return result.user.id
