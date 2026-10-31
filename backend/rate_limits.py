"""Assistant-only request limiting with bounded local and shared backends."""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import logging
import math
import os
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from typing import Protocol, Sequence

from starlette.responses import JSONResponse


class RateLimitUnavailable(Exception):
    """The configured shared limiter is unavailable; callers must fail closed."""

    def __init__(self, reason: str = "rate_limiter_unavailable"):
        self.reason = reason
        super().__init__(reason)


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = max(1, int(retry_after))


@dataclass(frozen=True)
class RateRule:
    name: str
    limit: int
    window_seconds: int


@dataclass(frozen=True)
class RateLimitSettings:
    environment: str
    backend: str
    redis_url: str | None
    ip_per_minute: int
    user_per_minute: int
    user_per_day: int
    user_concurrency: int
    max_body_bytes: int
    total_timeout_seconds: float

    @classmethod
    def from_environment(cls) -> "RateLimitSettings":
        environment = os.getenv("APP_ENV", "").strip().lower()
        backend = os.getenv("RATE_LIMIT_BACKEND", "").strip().lower()
        redis_url = os.getenv("REDIS_URL")

        if environment == "development":
            if backend != "memory":
                raise RateLimitUnavailable("development_requires_memory_backend")
        elif environment == "production":
            if backend != "redis" or not redis_url:
                raise RateLimitUnavailable("production_requires_shared_redis_backend")
        else:
            # An unset or unknown deployment mode must never select memory storage.
            raise RateLimitUnavailable("unsupported_or_missing_environment")

        def positive_int(name: str, default: int) -> int:
            raw = os.getenv(name, str(default))
            try:
                value = int(raw)
            except (TypeError, ValueError) as error:
                raise RateLimitUnavailable("invalid_rate_limit_value") from error
            if value <= 0:
                raise RateLimitUnavailable("invalid_rate_limit_value")
            return value

        try:
            total_timeout = float(os.getenv("ASSISTANT_TOTAL_TIMEOUT_SECONDS", "55"))
        except ValueError as error:
            raise RateLimitUnavailable("invalid_total_timeout_value") from error
        if not math.isfinite(total_timeout) or total_timeout <= 0:
            raise RateLimitUnavailable("invalid_total_timeout_value")

        return cls(
            environment=environment,
            backend=backend,
            redis_url=redis_url,
            ip_per_minute=positive_int("RATE_LIMIT_IP_PER_MINUTE", 30),
            user_per_minute=positive_int("RATE_LIMIT_USER_PER_MINUTE", 6),
            user_per_day=positive_int("RATE_LIMIT_USER_PER_DAY", 50),
            user_concurrency=positive_int("RATE_LIMIT_USER_CONCURRENCY", 2),
            max_body_bytes=positive_int("ASSISTANT_MAX_BODY_BYTES", 131072),
            total_timeout_seconds=total_timeout,
        )


class ConcurrencyLease(Protocol):
    async def release(self) -> None: ...


class Limiter(Protocol):
    async def check_rate_limits(self, subject: str, rules: Sequence[RateRule]) -> None: ...
    async def acquire_concurrency(self, subject: str, limit: int, lease_seconds: int) -> ConcurrencyLease: ...
    async def close(self) -> None: ...


class _MemoryLease:
    def __init__(self, limiter: "InMemoryLimiter", subject: str, token: str):
        self._limiter = limiter
        self._subject = subject
        self._token = token
        self._released = False

    async def release(self) -> None:
        if not self._released:
            self._released = True
            await self._limiter._release_memory_lease(self._subject, self._token)


class InMemoryLimiter:
    """Bounded, expiring limiter intended only for local development."""

    def __init__(self, max_entries: int = 10_000, clock=time.monotonic):
        self._max_entries = max_entries
        self._clock = clock
        self._buckets: OrderedDict[tuple[str, str, int], tuple[int, float]] = OrderedDict()
        self._leases: OrderedDict[str, dict[str, float]] = OrderedDict()
        self._lock = asyncio.Lock()

    def _purge(self, now: float) -> None:
        for key, (_, expiry) in list(self._buckets.items()):
            if expiry <= now:
                self._buckets.pop(key, None)
        for subject, tokens in list(self._leases.items()):
            for token, expiry in list(tokens.items()):
                if expiry <= now:
                    tokens.pop(token, None)
            if not tokens:
                self._leases.pop(subject, None)

    async def check_rate_limits(self, subject: str, rules: Sequence[RateRule]) -> None:
        now = self._clock()
        async with self._lock:
            self._purge(now)
            buckets: list[tuple[tuple[str, str, int], float, RateRule]] = []
            exceeded: list[float] = []
            for rule in rules:
                window_index = math.floor(now / rule.window_seconds)
                key = (subject, rule.name, window_index)
                expiry = (window_index + 1) * rule.window_seconds
                buckets.append((key, expiry, rule))
                count = self._buckets.get(key, (0, expiry))[0]
                if count >= rule.limit:
                    exceeded.append(max(1.0, expiry - now))

            if exceeded:
                raise RateLimitExceeded(math.ceil(max(exceeded)))

            new_keys = sum(1 for key, _, _ in buckets if key not in self._buckets)
            if len(self._buckets) + new_keys > self._max_entries:
                raise RateLimitUnavailable()
            for key, expiry, _ in buckets:
                count = self._buckets.get(key, (0, expiry))[0]
                self._buckets[key] = (count + 1, expiry)
                self._buckets.move_to_end(key)

    async def acquire_concurrency(self, subject: str, limit: int, lease_seconds: int) -> _MemoryLease:
        now = self._clock()
        async with self._lock:
            self._purge(now)
            active = self._leases.get(subject, {})
            if len(active) >= limit:
                retry_after = max(1, math.ceil(min(active.values()) - now))
                raise RateLimitExceeded(retry_after)
            if subject not in self._leases and len(self._leases) >= self._max_entries:
                raise RateLimitUnavailable()
            token = uuid.uuid4().hex
            active[token] = now + lease_seconds
            self._leases[subject] = active
            self._leases.move_to_end(subject)
            return _MemoryLease(self, subject, token)

    async def _release_memory_lease(self, subject: str, token: str) -> None:
        async with self._lock:
            active = self._leases.get(subject)
            if active:
                active.pop(token, None)
                if not active:
                    self._leases.pop(subject, None)

    async def close(self) -> None:
        return None


class _RedisLease:
    def __init__(self, limiter: "RedisLimiter", key: str, token: str):
        self._limiter = limiter
        self._key = key
        self._token = token
        self._released = False

    async def release(self) -> None:
        if not self._released:
            self._released = True
            await self._limiter._release_redis_lease(self._key, self._token)


class RedisLimiter:
    """Redis-compatible shared limiter; connection is lazy and never provisioned here."""

    _RATE_SCRIPT = """
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local token = ARGV[1]
local count = tonumber(ARGV[2])
local retry = 0
for i = 1, count do
  local window = tonumber(ARGV[2 + (i - 1) * 2 + 1])
  local limit = tonumber(ARGV[2 + (i - 1) * 2 + 2])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window)
  local current = redis.call('ZCARD', KEYS[i])
  if current >= limit then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    if oldest[2] then
      local wait = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
      if wait > retry then retry = wait end
    end
  end
end
if retry > 0 then return retry end
for i = 1, count do
  local window = tonumber(ARGV[2 + (i - 1) * 2 + 1])
  redis.call('ZADD', KEYS[i], now, token .. ':' .. i)
  redis.call('PEXPIRE', KEYS[i], window + 1000)
end
return 0
"""
    _ACQUIRE_SCRIPT = """
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local lease_ms = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local current = redis.call('ZCARD', KEYS[1])
if current >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local wait = math.ceil((tonumber(oldest[2]) - now) / 1000)
  if wait < 1 then wait = 1 end
  return wait
end
redis.call('ZADD', KEYS[1], now + lease_ms, ARGV[3])
redis.call('PEXPIRE', KEYS[1], lease_ms + 1000)
return 0
"""
    _RELEASE_SCRIPT = "return redis.call('ZREM', KEYS[1], ARGV[1])"

    def __init__(self, url: str, operation_timeout: float = 1.5):
        self._url = url
        self._timeout = operation_timeout
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from redis.asyncio import Redis
                self._client = Redis.from_url(
                    self._url,
                    decode_responses=True,
                    socket_connect_timeout=self._timeout,
                    socket_timeout=self._timeout,
                    health_check_interval=30,
                )
            except Exception as error:
                raise RateLimitUnavailable("redis_client_initialization_failed") from error
        return self._client

    @staticmethod
    def _digest(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    async def check_rate_limits(self, subject: str, rules: Sequence[RateRule]) -> None:
        if not rules:
            return
        digest = self._digest(subject)
        keys = [f"kaam-calm:assistant:rate:{digest}:{rule.name}" for rule in rules]
        args: list[object] = [uuid.uuid4().hex, len(rules)]
        for rule in rules:
            args.extend((rule.window_seconds * 1000, rule.limit))
        try:
            async with asyncio.timeout(self._timeout + 0.25):
                retry_after = await self._get_client().eval(self._RATE_SCRIPT, len(keys), *keys, *args)
        except RateLimitUnavailable:
            raise
        except Exception as error:
            raise RateLimitUnavailable("shared_rate_limit_check_failed") from error
        if int(retry_after) > 0:
            raise RateLimitExceeded(int(retry_after))

    async def acquire_concurrency(self, subject: str, limit: int, lease_seconds: int) -> _RedisLease:
        key = f"kaam-calm:assistant:concurrency:{self._digest(subject)}"
        token = uuid.uuid4().hex
        try:
            async with asyncio.timeout(self._timeout + 0.25):
                retry_after = await self._get_client().eval(
                    self._ACQUIRE_SCRIPT, 1, key, lease_seconds * 1000, limit, token,
                )
        except Exception as error:
            raise RateLimitUnavailable("shared_concurrency_acquire_failed") from error
        if int(retry_after) > 0:
            raise RateLimitExceeded(int(retry_after))
        return _RedisLease(self, key, token)

    async def _release_redis_lease(self, key: str, token: str) -> None:
        try:
            async with asyncio.timeout(self._timeout + 0.25):
                await self._get_client().eval(self._RELEASE_SCRIPT, 1, key, token)
        except Exception:
            # The lease expires automatically, so a transient release failure is bounded.
            return

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:
                return


def create_limiter(settings: RateLimitSettings) -> Limiter:
    if settings.environment == "development" and settings.backend == "memory":
        return InMemoryLimiter()
    if settings.environment == "production" and settings.backend == "redis" and settings.redis_url:
        return RedisLimiter(settings.redis_url)
    raise RateLimitUnavailable("rate_limiter_backend_mismatch")


def client_ip_from_scope(scope: dict, settings: RateLimitSettings) -> str | None:
    if settings.environment == "production":
        # Render ingress is configured to accept traffic through Cloudflare. Use
        # Cloudflare's single client-IP header as the identity; never derive it
        # from X-Forwarded-For or the proxy socket address.
        values = [value for key, value in scope.get("headers", ()) if key.lower() == b"cf-connecting-ip"]
        if len(values) != 1:
            raise RateLimitUnavailable("trusted_client_ip_header_missing_or_duplicated")
        try:
            raw = values[0].decode("ascii", errors="strict")
            address = ipaddress.ip_address(raw)
        except (UnicodeDecodeError, ValueError) as error:
            raise RateLimitUnavailable("trusted_client_ip_header_invalid") from error
        if isinstance(address, ipaddress.IPv6Address) and address.scope_id is not None:
            raise RateLimitUnavailable("trusted_client_ip_header_invalid")
        return address.compressed

    client = scope.get("client")
    if not client or not client[0]:
        if settings.environment == "development":
            return None
        raise RateLimitUnavailable()
    try:
        address = ipaddress.ip_address(client[0])
    except ValueError:
        if settings.environment == "development":
            return None
        raise RateLimitUnavailable()
    return address.compressed


def safe_retry_after(value: int | float) -> str:
    return str(max(1, int(math.ceil(value))))


class AssistantProtectionMiddleware:
    """Enforces assistant IP limits and body/deadline bounds before FastAPI parsing."""

    def __init__(self, app, settings: RateLimitSettings | None, limiter: Limiter | None):
        self.app = app
        self.settings = settings
        self.limiter = limiter

    async def _respond(self, scope, receive, send, status: int, detail: str, headers: dict[str, str] | None = None):
        response = JSONResponse(status_code=status, content={"detail": detail}, headers=headers or {})
        await response(scope, receive, send)

    async def __call__(self, scope, receive, send):
        protected_paths = {"/api/assistant/chat", "/api/assistant/match-explanations"}
        if scope["type"] != "http" or scope.get("method") != "POST" or scope.get("path") not in protected_paths:
            await self.app(scope, receive, send)
            return

        application = scope.get("app")
        settings = getattr(getattr(application, "state", None), "rate_limit_settings", self.settings)
        limiter = getattr(getattr(application, "state", None), "assistant_limiter", self.limiter)
        if settings is None or limiter is None:
            logging.getLogger(__name__).error("Assistant limiter unavailable (reason=missing_runtime_limiter)")
            await self._respond(
                scope, receive, send, 503,
                "Assistant protection is temporarily unavailable. Please try again.",
                {"X-Assistant-Protection-Reason": "missing_runtime_limiter"},
            )
            return

        response_started = False

        async def tracked_send(message):
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        async def reject(status: int, detail: str, headers: dict[str, str] | None = None):
            if not response_started:
                await self._respond(scope, receive, tracked_send, status, detail, headers)

        try:
            async with asyncio.timeout(settings.total_timeout_seconds):
                client_ip = client_ip_from_scope(scope, settings)
                if client_ip is not None:
                    await limiter.check_rate_limits(
                        f"ip:{client_ip}",
                        (RateRule("ip-minute", settings.ip_per_minute, 60),),
                    )

                max_bytes = settings.max_body_bytes
                content_length = next(
                    (value.decode("latin-1") for key, value in scope.get("headers", []) if key.lower() == b"content-length"),
                    None,
                )
                if content_length is not None:
                    try:
                        if int(content_length) < 0:
                            raise ValueError
                    except ValueError:
                        await reject(400, "Invalid request body length.")
                        return
                    if int(content_length) > max_bytes:
                        await reject(413, "The assistant request is too large.")
                        return

                chunks: list[bytes] = []
                body_size = 0
                while True:
                    message = await receive()
                    if message.get("type") == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    body_size += len(chunk)
                    if body_size > max_bytes:
                        await reject(413, "The assistant request is too large.")
                        return
                    chunks.append(chunk)
                    if not message.get("more_body", False):
                        break
                body = b"".join(chunks)
                replayed = False

                async def replay_receive():
                    nonlocal replayed
                    if not replayed:
                        replayed = True
                        return {"type": "http.request", "body": body, "more_body": False}
                    return await receive()

                await self.app(scope, replay_receive, tracked_send)
        except RateLimitExceeded as error:
            await reject(429, "Too many assistant requests. Please try again later.", {"Retry-After": safe_retry_after(error.retry_after)})
        except RateLimitUnavailable as error:
            logging.getLogger(__name__).warning("Assistant request blocked by limiter (reason=%s)", error.reason)
            await reject(
                503,
                "Assistant protection is temporarily unavailable. Please try again.",
                {"X-Assistant-Protection-Reason": error.reason},
            )
        except TimeoutError:
            await reject(504, "The career assistant took too long to respond. Please try again.")
