import asyncio
import logging
import os
import time
import uuid
from typing import Any
from urllib.parse import urlsplit

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)


def _log_auth_rejection(category: str, algorithm: str = "unknown") -> None:
    """Log only bounded auth diagnostics; never include tokens or claim values."""
    if algorithm not in {"unknown", "ES256", "HS256", "RS256", "PS256", "EdDSA"}:
        algorithm = "other"
    logger.warning(
        "assistant authentication rejected (category=%s algorithm=%s supabase_url_valid=%s jwks_configured=%s legacy_publishable_key_present=%s)",
        category,
        algorithm,
        SUPABASE_CONFIGURATION_VALID,
        bool(SUPABASE_JWKS_URL and SUPABASE_CONFIGURATION_VALID),
        bool(SUPABASE_PUBLISHABLE_KEY),
    )


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


def _validate_identity_claims(claims: dict[str, Any], verified_user_id: str | None = None, algorithm: str = "unknown") -> str:
    user_id = claims.get("sub")
    if not isinstance(user_id, str) or not user_id:
        _log_auth_rejection("subject_missing_or_invalid", algorithm)
        raise _unauthorized()
    try:
        uuid.UUID(user_id)
    except (ValueError, AttributeError):
        _log_auth_rejection("subject_not_uuid", algorithm)
        raise _unauthorized()

    if claims.get("role") != SUPABASE_AUDIENCE or claims.get("is_anonymous") is True:
        _log_auth_rejection("role_invalid_or_anonymous", algorithm)
        raise _forbidden()

    if verified_user_id is not None and user_id != verified_user_id:
        _log_auth_rejection("verified_user_mismatch", algorithm)
        raise _unauthorized()
    return user_id


async def _verify_es256(token: str) -> str:
    try:
        signing_key = await asyncio.to_thread(jwks_client.get_signing_key_from_jwt, token)
    except jwt.PyJWKClientConnectionError:
        _log_auth_rejection("jwks_unavailable", "ES256")
        raise _verification_unavailable()
    except jwt.PyJWKClientError:
        _log_auth_rejection("jwks_key_lookup_failed", "ES256")
        raise _unauthorized()
    except Exception:
        _log_auth_rejection("jwks_lookup_error", "ES256")
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
    except jwt.ExpiredSignatureError:
        _log_auth_rejection("token_expired", "ES256")
        raise _unauthorized()
    except jwt.InvalidIssuerError:
        _log_auth_rejection("issuer_mismatch", "ES256")
        raise _unauthorized()
    except jwt.InvalidAudienceError:
        _log_auth_rejection("audience_mismatch", "ES256")
        raise _unauthorized()
    except jwt.InvalidSignatureError:
        _log_auth_rejection("signature_invalid", "ES256")
        raise _unauthorized()
    except jwt.MissingRequiredClaimError:
        _log_auth_rejection("required_claim_missing", "ES256")
        raise _unauthorized()
    except jwt.InvalidTokenError:
        _log_auth_rejection("token_claims_invalid", "ES256")
        raise _unauthorized()
    except Exception:
        _log_auth_rejection("jwt_verification_error", "ES256")
        raise _verification_unavailable()
    user_id = _validate_identity_claims(claims, algorithm="ES256")
    logger.info("assistant authentication accepted (algorithm=ES256 identity_claims_valid=true)")
    return user_id


async def _verify_legacy_hs256(token: str) -> str:
    if not SUPABASE_PUBLISHABLE_KEY:
        _log_auth_rejection("legacy_publishable_key_missing", "HS256")
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
        _log_auth_rejection("legacy_supabase_user_unavailable", "HS256")
        raise _verification_unavailable()
    except Exception:
        _log_auth_rejection("legacy_supabase_user_error", "HS256")
        raise _verification_unavailable()

    if response.status_code in (401, 403):
        _log_auth_rejection("legacy_token_rejected_by_supabase", "HS256")
        raise _unauthorized()
    if response.status_code != 200:
        _log_auth_rejection("legacy_supabase_user_unexpected_status", "HS256")
        raise _verification_unavailable()

    try:
        user = response.json()
        verified_user_id = user.get("id") if isinstance(user, dict) else None
        if not isinstance(verified_user_id, str):
            _log_auth_rejection("legacy_verified_subject_missing", "HS256")
            raise _verification_unavailable()
        if user.get("is_anonymous") is True:
            _log_auth_rejection("legacy_user_anonymous", "HS256")
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
            _log_auth_rejection("issuer_mismatch", "HS256")
            raise _unauthorized()
        audience = claims.get("aud")
        if not (audience == SUPABASE_AUDIENCE or isinstance(audience, list) and SUPABASE_AUDIENCE in audience):
            _log_auth_rejection("audience_mismatch", "HS256")
            raise _unauthorized()
        expiry = claims.get("exp")
        if isinstance(expiry, bool) or not isinstance(expiry, (int, float)) or expiry <= time.time():
            _log_auth_rejection("token_expired_or_exp_missing", "HS256")
            raise _unauthorized()
        if claims.get("nbf") is not None and claims["nbf"] > time.time():
            _log_auth_rejection("token_not_yet_valid", "HS256")
            raise _unauthorized()
        user_id = _validate_identity_claims(claims, verified_user_id=verified_user_id, algorithm="HS256")
        logger.info("assistant authentication accepted (algorithm=HS256 identity_claims_valid=true)")
        return user_id
    except HTTPException:
        raise
    except (jwt.InvalidTokenError, TypeError, ValueError, AttributeError):
        _log_auth_rejection("legacy_token_claims_invalid", "HS256")
        raise _unauthorized()
    except Exception:
        _log_auth_rejection("legacy_claim_validation_error", "HS256")
        raise _verification_unavailable()


async def require_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if not SUPABASE_CONFIGURATION_VALID:
        _log_auth_rejection("supabase_url_invalid")
        raise _verification_unavailable()
    if credentials is None or credentials.scheme.lower() != "bearer":
        _log_auth_rejection("bearer_header_missing_or_invalid")
        raise _unauthorized()

    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        _log_auth_rejection("token_header_malformed")
        raise _unauthorized()
    except Exception:
        _log_auth_rejection("token_header_parse_error")
        raise _unauthorized()

    algorithm = header.get("alg")
    if algorithm == "ES256":
        return await _verify_es256(token)
    if algorithm == "HS256":
        return await _verify_legacy_hs256(token)
    _log_auth_rejection("signing_algorithm_unsupported", str(algorithm or "missing")[:16])
    raise _unauthorized()
