import asyncio
import os
import time
import uuid
from typing import Any
from urllib.parse import urlsplit

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


_DEFAULT_DEVELOPMENT_SUPABASE_URL = "https://egkvdwjwjmkwwhiwwffr.supabase.co"


def _resolve_supabase_url(configured_url: str, app_environment: str) -> tuple[str, bool]:
    candidate = configured_url.strip()
    if not candidate and app_environment.strip().lower() != "production":
        candidate = _DEFAULT_DEVELOPMENT_SUPABASE_URL
    candidate = candidate.rstrip("/")
    try:
        parts = urlsplit(candidate)
        port = parts.port
        valid = (
            parts.scheme == "https"
            and bool(parts.hostname)
            and not parts.username
            and not parts.password
            and not parts.query
            and not parts.fragment
            and parts.path in ("", "/")
            and (port is None or 1 <= port <= 65535)
        )
    except ValueError:
        valid = False
    return candidate, valid


SUPABASE_URL, SUPABASE_CONFIGURATION_VALID = _resolve_supabase_url(
    os.getenv("SUPABASE_URL", ""),
    os.getenv("APP_ENV", ""),
)

# Keep URL construction valid if a production deployment forgot SUPABASE_URL;
# authentication is rejected below with a safe configuration error.
_auth_project_url = SUPABASE_URL if SUPABASE_CONFIGURATION_VALID else "https://invalid.supabase.invalid"
SUPABASE_ISSUER = f"{_auth_project_url}/auth/v1"
SUPABASE_JWKS_URL = f"{SUPABASE_ISSUER}/.well-known/jwks.json"
SUPABASE_USER_URL = f"{SUPABASE_ISSUER}/user"
SUPABASE_AUDIENCE = "authenticated"
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY")
AUTH_REQUEST_TIMEOUT = httpx.Timeout(5.0, connect=2.0)

bearer_scheme = HTTPBearer(auto_error=False)
jwks_client = jwt.PyJWKClient(
    SUPABASE_JWKS_URL,
    cache_jwk_set=True,
    lifespan=300,
    timeout=5,
)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="A valid signed-in account is required to use the career assistant.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _forbidden() -> HTTPException:
    return HTTPException(status_code=403, detail="A signed-in account is required to use the career assistant.")


def _verification_unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="Sign-in verification is temporarily unavailable. Please try again.")


def _validate_identity_claims(claims: dict[str, Any], verified_user_id: str | None = None) -> str:
    user_id = claims.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise _unauthorized()
    try:
        uuid.UUID(user_id)
    except (ValueError, AttributeError):
        raise _unauthorized()

    if claims.get("role") != SUPABASE_AUDIENCE or claims.get("is_anonymous") is True:
        raise _forbidden()

    if verified_user_id is not None and user_id != verified_user_id:
        raise _unauthorized()
    return user_id


async def _verify_es256(token: str) -> str:
    try:
        signing_key = await asyncio.to_thread(jwks_client.get_signing_key_from_jwt, token)
    except jwt.PyJWKClientConnectionError:
        raise _verification_unavailable()
    except jwt.PyJWKClientError:
        raise _unauthorized()
    except Exception:
        raise _verification_unavailable()

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience=SUPABASE_AUDIENCE,
            issuer=SUPABASE_ISSUER,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.InvalidTokenError:
        raise _unauthorized()
    except Exception:
        raise _verification_unavailable()
    return _validate_identity_claims(claims)


async def _verify_legacy_hs256(token: str) -> str:
    if not SUPABASE_PUBLISHABLE_KEY:
        raise _verification_unavailable()

    try:
        async with httpx.AsyncClient(timeout=AUTH_REQUEST_TIMEOUT) as client:
            response = await client.get(
                SUPABASE_USER_URL,
                headers={
                    "apikey": SUPABASE_PUBLISHABLE_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
    except (httpx.TimeoutException, httpx.RequestError):
        raise _verification_unavailable()
    except Exception:
        raise _verification_unavailable()

    if response.status_code in (401, 403):
        raise _unauthorized()
    if response.status_code != 200:
        raise _verification_unavailable()

    try:
        user = response.json()
        verified_user_id = user.get("id") if isinstance(user, dict) else None
        if not isinstance(verified_user_id, str):
            raise _verification_unavailable()
        if user.get("is_anonymous") is True:
            raise _forbidden()

        # Supabase Auth has verified this exact token. Read its claims only after
        # that server-side verification, then enforce this project's identity.
        claims = jwt.decode(
            token,
            options={
                "verify_signature": False,
                "verify_exp": False,
                "verify_aud": False,
                "verify_iss": False,
                "verify_iat": False,
                "verify_nbf": False,
            },
        )
        if claims.get("iss") != SUPABASE_ISSUER:
            raise _unauthorized()
        audience = claims.get("aud")
        if not (audience == SUPABASE_AUDIENCE or isinstance(audience, list) and SUPABASE_AUDIENCE in audience):
            raise _unauthorized()
        expiry = claims.get("exp")
        if isinstance(expiry, bool) or not isinstance(expiry, (int, float)) or expiry <= time.time():
            raise _unauthorized()
        if claims.get("nbf") is not None and claims["nbf"] > time.time():
            raise _unauthorized()
        return _validate_identity_claims(claims, verified_user_id=verified_user_id)
    except HTTPException:
        raise
    except (jwt.InvalidTokenError, TypeError, ValueError, AttributeError):
        raise _unauthorized()
    except Exception:
        raise _verification_unavailable()


async def require_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if not SUPABASE_CONFIGURATION_VALID:
        raise _verification_unavailable()
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized()

    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise _unauthorized()
    except Exception:
        raise _unauthorized()

    algorithm = header.get("alg")
    if algorithm == "ES256":
        return await _verify_es256(token)
    if algorithm == "HS256":
        return await _verify_legacy_hs256(token)
    raise _unauthorized()
