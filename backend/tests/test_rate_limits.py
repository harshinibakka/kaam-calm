import asyncio
import ipaddress
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import main
from backend.rate_limits import (
    AssistantProtectionMiddleware,
    InMemoryLimiter,
    RateLimitExceeded,
    RateLimitSettings,
    RateLimitUnavailable,
    RateRule,
    RedisLimiter,
    client_ip_from_scope,
    create_limiter,
)


@pytest.fixture
def authenticated_assistant():
    dependency = main.require_authenticated_user
    previous = main.app.dependency_overrides.get(dependency)
    main.app.dependency_overrides[dependency] = lambda: "f2a73b38-256a-4a3a-90a4-393859c0a6ab"
    yield
    if previous is None:
        main.app.dependency_overrides.pop(dependency, None)
    else:
        main.app.dependency_overrides[dependency] = previous


class Clock:
    def __init__(self, value=5.0):
        self.value = value

    def __call__(self):
        return self.value


def development_settings(**changes):
    settings = RateLimitSettings.from_environment()
    return replace(settings, **changes)


def test_local_limiter_enforces_boundary_and_numeric_retry_after():
    clock = Clock(5)
    limiter = InMemoryLimiter(clock=clock)
    rule = (RateRule("ip-minute", 2, 60),)

    asyncio.run(limiter.check_rate_limits("ip:198.51.100.1", rule))
    asyncio.run(limiter.check_rate_limits("ip:198.51.100.1", rule))
    with pytest.raises(RateLimitExceeded) as error:
        asyncio.run(limiter.check_rate_limits("ip:198.51.100.1", rule))
    assert error.value.retry_after == 55

    clock.value = 60
    asyncio.run(limiter.check_rate_limits("ip:198.51.100.1", rule))


def test_local_limiter_does_not_evict_live_entries_to_make_room():
    clock = Clock(5)
    limiter = InMemoryLimiter(max_entries=1, clock=clock)
    rule = (RateRule("user-minute", 10, 60),)

    asyncio.run(limiter.check_rate_limits("user:one", rule))
    with pytest.raises(RateLimitUnavailable):
        asyncio.run(limiter.check_rate_limits("user:two", rule))
    clock.value = 60
    asyncio.run(limiter.check_rate_limits("user:two", rule))


def test_local_concurrency_leases_reject_and_release_at_boundary():
    async def exercise():
        limiter = InMemoryLimiter()
        lease = await limiter.acquire_concurrency("user:one", limit=1, lease_seconds=20)
        with pytest.raises(RateLimitExceeded) as error:
            await limiter.acquire_concurrency("user:one", limit=1, lease_seconds=20)
        assert error.value.retry_after == 20
        await lease.release()
        return await limiter.acquire_concurrency("user:one", limit=1, lease_seconds=20)

    lease = asyncio.run(exercise())
    asyncio.run(lease.release())


def test_production_requires_shared_redis_and_explicit_matching_proxy_configuration(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("RATE_LIMIT_BACKEND", "memory")
    with pytest.raises(RateLimitUnavailable):
        RateLimitSettings.from_environment()

    monkeypatch.setenv("RATE_LIMIT_BACKEND", "redis")
    monkeypatch.setenv("REDIS_URL", "redis://uncontacted.invalid/0")
    monkeypatch.setenv("RATE_LIMIT_TRUSTED_PROXY_CIDRS", "192.0.2.0/24")
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "192.0.2.0/24")
    settings = RateLimitSettings.from_environment()
    limiter = create_limiter(settings)
    assert isinstance(limiter, RedisLimiter)
    assert limiter._client is None

    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "*")
    with pytest.raises(RateLimitUnavailable):
        RateLimitSettings.from_environment()


def test_missing_local_limiter_settings_fail_closed_with_safe_reason(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("RATE_LIMIT_BACKEND", raising=False)
    with pytest.raises(RateLimitUnavailable) as error:
        RateLimitSettings.from_environment()
    assert error.value.reason == "unsupported_or_missing_environment"


def test_explicit_local_development_settings_use_only_bounded_memory_limiter(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("RATE_LIMIT_BACKEND", "memory")
    settings = RateLimitSettings.from_environment()
    limiter = create_limiter(settings)
    assert settings.environment == "development"
    assert settings.backend == "memory"
    assert isinstance(limiter, InMemoryLimiter)


def test_proxy_client_ip_ignores_forwarded_header_and_rejects_unresolved_proxy():
    development = development_settings()
    scope = {
        "client": ("198.51.100.12", 4567),
        "headers": [(b"x-forwarded-for", b"203.0.113.90")],
    }
    assert client_ip_from_scope(scope, development) == "198.51.100.12"

    production = replace(
        development,
        environment="production",
        backend="redis",
        redis_url="redis://uncontacted.invalid/0",
        trusted_proxy_networks=(ipaddress.ip_network("192.0.2.0/24"),),
    )
    assert client_ip_from_scope(scope, production) == "198.51.100.12"
    with pytest.raises(RateLimitUnavailable):
        client_ip_from_scope({"client": ("192.0.2.8", 80)}, production)


def test_assistant_ip_limit_runs_before_auth_and_ignores_spoofed_xff(monkeypatch):
    settings = development_settings(ip_per_minute=1)
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = InMemoryLimiter()
    search = AsyncMock()
    generate = AsyncMock()
    monkeypatch.setattr(main, "search_jobs", search)
    monkeypatch.setattr(main, "_generate_assistant_reply", generate)
    payload = {
        "messages": [{"role": "user", "content": "Find jobs"}],
        "job_search": {"role": "Engineer", "location": "Pune"},
    }

    with TestClient(main.app, client=("198.51.100.12", 4567)) as client:
        first = client.post("/api/assistant/chat", json=payload)
        second = client.post(
            "/api/assistant/chat",
            json=payload,
            headers={"X-Forwarded-For": "203.0.113.90"},
        )

    assert first.status_code == 401
    assert second.status_code == 429
    assert int(second.headers["retry-after"]) >= 1
    search.assert_not_awaited()
    generate.assert_not_awaited()


def test_assistant_body_size_exact_boundary_and_oversize_before_json_parse(monkeypatch):
    settings = development_settings()
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = InMemoryLimiter()
    dependency = main.require_authenticated_user
    previous = main.app.dependency_overrides.get(dependency)
    main.app.dependency_overrides[dependency] = lambda: "f2a73b38-256a-4a3a-90a4-393859c0a6ab"
    helper = AsyncMock(return_value={"reply": "ok", "jobs": []})
    monkeypatch.setattr(main, "_assistant_chat_with_permit", helper)
    body = b'{"messages":[{"role":"user","content":"boundary"}]}'
    main.app.state.rate_limit_settings = replace(settings, max_body_bytes=len(body))
    try:
        with TestClient(main.app, client=("198.51.100.13", 4567)) as client:
            exact = client.post("/api/assistant/chat", content=body, headers={"Content-Type": "application/json"})
            oversized = client.post("/api/assistant/chat", content=body + b"x", headers={"Content-Type": "application/json"})
        assert exact.status_code == 200
        assert oversized.status_code == 413
        assert helper.await_count == 1
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(dependency, None)
        else:
            main.app.dependency_overrides[dependency] = previous


def test_match_explanation_endpoint_uses_assistant_body_limit_before_json_parse(monkeypatch, authenticated_assistant):
    settings = development_settings()
    main.app.state.rate_limit_settings = replace(settings, max_body_bytes=12)
    main.app.state.assistant_limiter = InMemoryLimiter()
    provider = AsyncMock(return_value={"matches": []})
    monkeypatch.setattr(main, "_match_explanations_with_permit", provider)
    with TestClient(main.app, client=("198.51.100.17", 4567)) as client:
        response = client.post("/api/assistant/match-explanations", content=b"{" + b" " * 12, headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    provider.assert_not_awaited()


def test_match_explanation_endpoint_applies_ip_limit_before_auth_and_ignores_spoofed_forwarded_ip():
    settings = development_settings(ip_per_minute=1)
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = InMemoryLimiter()
    payload = {"role": "Engineer", "location": "Pune", "jobs": [{"id": "job-1", "page": 1}], "profile_consent": False}
    with TestClient(main.app, client=("198.51.100.20", 4567)) as client:
        first = client.post("/api/assistant/match-explanations", json=payload, headers={"X-Forwarded-For": "203.0.113.1"})
        second = client.post("/api/assistant/match-explanations", json=payload, headers={"X-Forwarded-For": "203.0.113.2"})
    assert first.status_code == 401
    assert second.status_code == 429
    assert int(second.headers["retry-after"]) >= 1


def test_match_explanation_endpoint_uses_shared_per_user_limit_and_retry_after(monkeypatch, authenticated_assistant):
    settings = development_settings(user_per_minute=1)
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = InMemoryLimiter()
    provider = AsyncMock(return_value={"matches": []})
    monkeypatch.setattr(main, "_match_explanations_with_permit", provider)
    payload = {"role": "Engineer", "location": "Pune", "jobs": [{"id": "job-1", "page": 1}], "profile_consent": False}
    with TestClient(main.app, client=("198.51.100.18", 4567)) as client:
        first = client.post("/api/assistant/match-explanations", json=payload)
        second = client.post("/api/assistant/match-explanations", json=payload)
    assert first.status_code == 200
    assert second.status_code == 429
    assert int(second.headers["retry-after"]) >= 1
    provider.assert_awaited_once()


def test_match_explanation_endpoint_releases_concurrency_lease_after_provider_error(monkeypatch, authenticated_assistant):
    settings = development_settings(user_concurrency=1)
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = InMemoryLimiter()
    provider = AsyncMock(side_effect=[HTTPException(status_code=502), {"matches": []}])
    monkeypatch.setattr(main, "_match_explanations_with_permit", provider)
    payload = {"role": "Engineer", "location": "Pune", "jobs": [{"id": "job-1", "page": 1}], "profile_consent": False}
    with TestClient(main.app, client=("198.51.100.19", 4567)) as client:
        failed = client.post("/api/assistant/match-explanations", json=payload)
        recovered = client.post("/api/assistant/match-explanations", json=payload)
    assert failed.status_code == 502
    assert recovered.status_code == 200
    assert provider.await_count == 2


def test_assistant_verified_user_limit_returns_retry_after_before_providers(monkeypatch):
    settings = development_settings(user_per_minute=1)
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = InMemoryLimiter()
    dependency = main.require_authenticated_user
    previous = main.app.dependency_overrides.get(dependency)
    main.app.dependency_overrides[dependency] = lambda: "f2a73b38-256a-4a3a-90a4-393859c0a6ab"
    helper = AsyncMock(return_value={"reply": "ok", "jobs": []})
    monkeypatch.setattr(main, "_assistant_chat_with_permit", helper)
    try:
        with TestClient(main.app, client=("198.51.100.14", 4567)) as client:
            first = client.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": "Hello"}]})
            second = client.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": "Hello again"}]})
        assert first.status_code == 200
        assert second.status_code == 429
        assert int(second.headers["retry-after"]) >= 1
        helper.assert_awaited_once()
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(dependency, None)
        else:
            main.app.dependency_overrides[dependency] = previous


def test_assistant_verified_user_daily_limit_is_configurable(monkeypatch):
    settings = development_settings(user_per_minute=10, user_per_day=1)
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = InMemoryLimiter()
    dependency = main.require_authenticated_user
    previous = main.app.dependency_overrides.get(dependency)
    main.app.dependency_overrides[dependency] = lambda: "f2a73b38-256a-4a3a-90a4-393859c0a6ab"
    helper = AsyncMock(return_value={"reply": "ok", "jobs": []})
    monkeypatch.setattr(main, "_assistant_chat_with_permit", helper)
    try:
        with TestClient(main.app, client=("198.51.100.16", 4567)) as client:
            first = client.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": "Hello"}]})
            second = client.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": "Again"}]})
        assert first.status_code == 200
        assert second.status_code == 429
        assert int(second.headers["retry-after"]) > 60
        helper.assert_awaited_once()
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(dependency, None)
        else:
            main.app.dependency_overrides[dependency] = previous


def test_provider_failure_releases_user_concurrency_permit(monkeypatch):
    settings = development_settings(user_concurrency=1)
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = InMemoryLimiter()
    dependency = main.require_authenticated_user
    previous = main.app.dependency_overrides.get(dependency)
    main.app.dependency_overrides[dependency] = lambda: "f2a73b38-256a-4a3a-90a4-393859c0a6ab"
    monkeypatch.setattr(main, "GEMINI_API_KEY", "mock-key")
    provider = AsyncMock(side_effect=[HTTPException(status_code=502), "recovered"])
    monkeypatch.setattr(main, "_generate_assistant_reply", provider)
    try:
        with TestClient(main.app, client=("198.51.100.15", 4567)) as client:
            failed = client.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": "Hello"}]})
            recovered = client.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": "Hello again"}]})
        assert failed.status_code == 502
        assert recovered.status_code == 200
        assert provider.await_count == 2
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(dependency, None)
        else:
            main.app.dependency_overrides[dependency] = previous


def test_cancelled_assistant_operation_releases_user_concurrency_permit(monkeypatch):
    settings = development_settings(user_concurrency=2)
    limiter = InMemoryLimiter()
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = limiter
    entered = asyncio.Event()

    async def wait_until_cancelled(*_args):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(main, "GEMINI_API_KEY", "mock-key")
    monkeypatch.setattr(main, "_generate_assistant_reply", wait_until_cancelled)
    request = main.AssistantChatRequest(messages=[{"role": "user", "content": "Hello"}])
    http_request = SimpleNamespace(app=main.app)
    subject = "user:f2a73b38-256a-4a3a-90a4-393859c0a6ab"

    async def exercise():
        task = asyncio.create_task(main.assistant_chat(request, http_request, subject.removeprefix("user:")))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        # Both slots must be available after cancellation cleanup.
        first = await limiter.acquire_concurrency(subject, limit=2, lease_seconds=10)
        second = await limiter.acquire_concurrency(subject, limit=2, lease_seconds=10)
        await first.release()
        await second.release()

    asyncio.run(exercise())


def test_total_assistant_timeout_cancels_downstream_and_returns_504():
    settings = development_settings(total_timeout_seconds=0.02)
    limiter = InMemoryLimiter()
    cleaned_up = asyncio.Event()
    responses = []

    async def blocked_app(_scope, _receive, _send):
        try:
            await asyncio.Event().wait()
        finally:
            cleaned_up.set()

    fake_application = SimpleNamespace(state=SimpleNamespace(
        rate_limit_settings=settings,
        assistant_limiter=limiter,
    ))
    middleware = AssistantProtectionMiddleware(blocked_app, settings, limiter)
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/assistant/chat",
        "app": fake_application,
        "client": ("198.51.100.17", 4567),
        "headers": [(b"content-length", b"2")],
    }

    async def receive():
        return {"type": "http.request", "body": b"{}", "more_body": False}

    async def send(message):
        responses.append(message)

    async def exercise():
        await middleware(scope, receive, send)

    asyncio.run(exercise())
    response_start = next(message for message in responses if message["type"] == "http.response.start")
    assert response_start["status"] == 504
    assert cleaned_up.is_set()


def test_redis_limiter_fails_closed_when_shared_store_errors():
    class FailedRedis:
        async def eval(self, *_args):
            raise OSError("unavailable")

    limiter = RedisLimiter("redis://uncontacted.invalid/0")
    limiter._client = FailedRedis()
    with pytest.raises(RateLimitUnavailable):
        asyncio.run(limiter.check_rate_limits("user:one", (RateRule("minute", 1, 60),)))


def test_assistant_fails_closed_when_shared_limiter_is_unavailable(monkeypatch):
    class FailedLimiter(InMemoryLimiter):
        async def check_rate_limits(self, _subject, _rules):
            raise RateLimitUnavailable()

    settings = development_settings()
    main.app.state.rate_limit_settings = settings
    main.app.state.assistant_limiter = FailedLimiter()
    search = AsyncMock()
    generate = AsyncMock()
    monkeypatch.setattr(main, "search_jobs", search)
    monkeypatch.setattr(main, "_generate_assistant_reply", generate)
    payload = {"messages": [{"role": "user", "content": "Help me"}]}

    with TestClient(main.app, client=("198.51.100.18", 4567)) as client:
        response = client.post("/api/assistant/chat", json=payload)

    assert response.status_code == 503
    search.assert_not_awaited()
    generate.assert_not_awaited()
