import os

import pytest


# Backend tests deliberately use the local limiter and never require Redis.
os.environ["APP_ENV"] = "development"
os.environ["RATE_LIMIT_BACKEND"] = "memory"


@pytest.fixture(autouse=True)
def isolate_assistant_rate_limits():
    from backend import main
    from backend.rate_limits import InMemoryLimiter

    main.app.state.rate_limit_settings = main.RateLimitSettings.from_environment()
    main.app.state.assistant_limiter = InMemoryLimiter()
    yield
