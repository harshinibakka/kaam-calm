import asyncio
from functools import wraps

import httpx
import pytest

from backend import job_search
from backend import main
from fastapi.testclient import TestClient


def async_test(function):
    @wraps(function)
    def run(*args, **kwargs):
        return asyncio.run(function(*args, **kwargs))
    return run


class FakeResponse:
    def __init__(self, status_code=200, payload=None, json_error=None):
        self.status_code = status_code
        self.payload = payload
        self.json_error = json_error

    def json(self):
        if self.json_error:
            raise self.json_error
        return self.payload


def theirstack_job(**overrides):
    return {
        "id": 712,
        "job_title": "Senior Data Engineer",
        "company": "Example Co",
        "company_object": {"logo": "https://images.example/logo.png"},
        "location": "Bengaluru, India",
        "description": "Build data pipelines with Python and SQL.",
        "date_posted": "2026-10-29",
        "final_url": "https://jobs.example/engineer",
        "employment_statuses": ["full_time"],
        "seniority": "senior",
        "remote": True,
        "min_annual_salary": 1200000,
        "max_annual_salary": 1800000,
        "salary_currency": "INR",
        "technology_slugs": ["python", "postgresql"],
        **overrides,
    }


def install_client(monkeypatch, response=None, error=None, *, gate=None):
    calls = []

    class FakeAsyncClient:
        def __init__(self, timeout):
            assert isinstance(timeout, httpx.Timeout)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, url, json, headers):
            calls.append((url, json, headers))
            if gate:
                await gate.wait()
            if error:
                raise error
            return response

        async def get(self, url, params, headers=None):
            calls.append((url, params, headers))
            name = params["name"]
            return FakeResponse(payload=[{"id": 123, "name": name, "display_name": name}])

    monkeypatch.setattr(job_search.httpx, "AsyncClient", FakeAsyncClient)
    return calls


@async_test
async def test_theirstack_uses_bearer_auth_required_filter_and_normalizes_fields(monkeypatch):
    job_search.clear_search_cache()
    monkeypatch.setenv("THEIRSTACK_JOBS_PER_PAGE", "5")
    calls = install_client(monkeypatch, FakeResponse(payload={"data": [theirstack_job()], "metadata": {"total_results": None}}))
    result = await job_search.search_theirstack("Data Engineer", "Bengaluru", 1, "test-stack-key")

    assert result.status == "available" and result.has_more is False
    post_call = next(call for call in calls if call[0] == "https://api.theirstack.com/v1/jobs/search")
    assert post_call[2] == {"Authorization": "Bearer test-stack-key"}
    assert post_call[1] == {
        "job_title_or": ["Data Engineer"],
        "job_location_or": [{"id": 123}],
        "posted_at_max_age_days": 90,
        "include_total_results": False,
        "limit": 5,
        "page": 0,
    }
    job = result.jobs[0]
    assert job["id"] == "theirstack:712"
    assert job["provider_job_id"] == "712"
    assert job["source"] == job["original_provider"] == "TheirStack"
    assert job["url"] == "https://jobs.example/engineer"
    assert job["workplace_type"] == "Remote"
    assert job["salary_min"] == 1200000 and job["salary_currency"] == "INR"
    assert job["skills"] == ["python", "postgresql"]
    assert job["company_logo"] == "https://images.example/logo.png"


@async_test
async def test_theirstack_missing_key_skips_provider_call(monkeypatch):
    calls = install_client(monkeypatch)
    result = await job_search.search_theirstack("Engineer", "India", 1, "")
    assert result.status == "not_configured"
    assert calls == []


@async_test
async def test_theirstack_does_not_search_when_location_catalog_shape_is_invalid(monkeypatch):
    job_search.clear_search_cache()

    class InvalidCatalogClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url, params, headers):
            return FakeResponse(payload={"items": [{"id": 123, "name": params["name"]}]})

        async def post(self, *_args, **_kwargs):
            raise AssertionError("A job search must not run without a validated location ID")

    monkeypatch.setattr(job_search.httpx, "AsyncClient", InvalidCatalogClient)
    result = await job_search.search_theirstack("Engineer", "India", 1, "test-stack-key")
    assert result.status == "location_unavailable"
    assert result.jobs == []


@pytest.mark.parametrize("response,status", [
    (FakeResponse(status_code=401, payload={}), "unauthorized"),
    (FakeResponse(status_code=402, payload={}), "credits_exhausted"),
    (FakeResponse(status_code=429, payload={}), "rate_limited"),
    (FakeResponse(payload={"unexpected": []}), "invalid_response"),
    (FakeResponse(payload={"data": [], "metadata": []}), "invalid_response"),
])
@async_test
async def test_theirstack_errors_are_categorized_without_provider_bodies(monkeypatch, response, status):
    job_search.clear_search_cache()
    install_client(monkeypatch, response)
    result = await job_search.search_theirstack("Engineer", "India", 1, "test-stack-key")
    assert result.status == status
    assert result.jobs == []


@async_test
async def test_theirstack_timeout_is_reported_as_timeout(monkeypatch):
    job_search.clear_search_cache()
    install_client(monkeypatch, error=httpx.ReadTimeout("provider response body must not escape"))
    result = await job_search.search_theirstack("Engineer", "India", 1, "test-stack-key")
    assert result.status == "timeout"


@async_test
async def test_theirstack_pagination_uses_small_page_and_caps_additional_pages(monkeypatch):
    job_search.clear_search_cache()
    monkeypatch.setenv("THEIRSTACK_JOBS_PER_PAGE", "2")
    install_client(monkeypatch, FakeResponse(payload={"data": [theirstack_job(id=1), theirstack_job(id=2)], "metadata": {}}))
    first = await job_search.search_theirstack("Engineer", "India", 1, "test-stack-key")
    assert first.has_more is True
    assert first.total_count is None

    job_search.clear_search_cache()
    install_client(monkeypatch, FakeResponse(payload={"data": [theirstack_job(id=1), theirstack_job(id=2)], "metadata": {}}))
    last = await job_search.search_theirstack("Engineer", "India", 10, "test-stack-key")
    assert last.has_more is False


@async_test
async def test_identical_theirstack_searches_use_bounded_cache(monkeypatch):
    job_search.clear_search_cache()
    monkeypatch.setenv("JOB_SEARCH_CACHE_TTL_SECONDS", "120")
    calls = install_client(monkeypatch, FakeResponse(payload={"data": [theirstack_job()], "metadata": {}}))
    first = await job_search.search_theirstack("Engineer", "India", 1, "test-stack-key")
    second = await job_search.search_theirstack("Engineer", "India", 1, "test-stack-key")
    assert len([call for call in calls if call[0] == job_search.THEIRSTACK_URL]) == 1
    assert first is second


@async_test
async def test_identical_concurrent_searches_share_one_provider_request(monkeypatch):
    job_search.clear_search_cache()
    entered = asyncio.Event()
    release = asyncio.Event()
    calls = install_client(monkeypatch, FakeResponse(payload={"data": [theirstack_job()], "metadata": {}}), gate=release)
    first = asyncio.create_task(job_search.search_theirstack("Engineer", "India", 1, "test-stack-key"))
    while not any(call[0] == job_search.THEIRSTACK_URL for call in calls):
        await asyncio.sleep(0)
    second = asyncio.create_task(job_search.search_theirstack("Engineer", "India", 1, "test-stack-key"))
    await asyncio.sleep(0)
    entered.set()
    release.set()
    first_result, second_result = await asyncio.gather(first, second)
    assert entered.is_set()
    assert len([call for call in calls if call[0] == job_search.THEIRSTACK_URL]) == 1
    assert first_result.jobs == second_result.jobs


def test_job_deduplication_uses_canonical_url_or_complete_identity():
    one = {"id": "a", "title": "Data Engineer", "company": "Example Co", "location": "Bengaluru", "url": "https://www.jobs.example/role/?utm_source=ads"}
    same_url = {**one, "id": "b", "source": "TheirStack", "url": "https://jobs.example/role#apply"}
    different_url = {**one, "id": "c", "url": "https://jobs.example/another-role"}
    no_url = {**one, "id": "d", "url": ""}
    result = job_search.merge_provider_pages(
        job_search.ProviderPage([one, different_url], False, "available"),
        job_search.ProviderPage([same_url, no_url], False, "available"),
    )
    assert [item["id"] for item in result] == ["a", "c"]


def test_job_deduplication_does_not_treat_missing_identity_fields_as_evidence():
    one = {"id": "a", "title": "Analyst", "company": "Not specified", "location": "Not specified", "url": ""}
    two = {**one, "id": "b", "source": "TheirStack"}
    result = job_search.merge_provider_pages(
        job_search.ProviderPage([one], False, "available"),
        job_search.ProviderPage([two], False, "available"),
    )
    assert [item["id"] for item in result] == ["a", "b"]


def test_theirstack_normalizer_does_not_fabricate_missing_fields():
    job = job_search._normalize_theirstack_job({"id": 88, "job_title": "Analyst"}, 0)
    assert job["id"] == "theirstack:88"
    assert job["company"] == "Not specified"
    assert job["location"] == "Not specified"
    assert job["url"] == job["created"] == job["salary"] == job["workplace_type"] == ""
    assert job["salary_min"] is job["salary_max"] is None
    assert job["skills"] == []


def install_dual_provider_clients(monkeypatch, *, adzuna_response=None, theirstack_response=None, adzuna_error=None, theirstack_error=None):
    calls = {"adzuna": [], "theirstack": []}

    class FakeAsyncClient:
        def __init__(self, timeout):
            assert isinstance(timeout, httpx.Timeout)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url, params, headers=None):
            if url == job_search.THEIRSTACK_LOCATIONS_URL:
                name = params["name"]
                return FakeResponse(payload=[{"id": 123, "name": name, "display_name": name}])
            calls["adzuna"].append((url, params))
            if adzuna_error:
                raise adzuna_error
            return adzuna_response

        async def post(self, url, json, headers):
            calls["theirstack"].append((url, json, headers))
            if theirstack_error:
                raise theirstack_error
            return theirstack_response

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(main, "APP_ID", "test-app-id")
    monkeypatch.setattr(main, "APP_KEY", "test-app-key")
    monkeypatch.setattr(main, "THEIRSTACK_API_KEY", "test-stack-key")
    job_search.clear_search_cache()
    return calls


def adzuna_payload(job_id="a-1", url="https://jobs.example/role?utm_source=adzuna"):
    return {"count": 1, "results": [{
        "id": job_id,
        "title": "Platform Engineer",
        "company": {"display_name": "Example Co"},
        "location": {"display_name": "Bengaluru"},
        "description": "Build reliable systems using Python.",
        "redirect_url": url,
        "created": "2026-10-29T00:00:00Z",
        "contract_time": "full_time",
        "salary_min": 1200000,
    }]}


def theirstack_payload(job_id=1, url="https://www.jobs.example/role#apply"):
    item = theirstack_job(id=job_id, job_title="Platform Engineer", company="Example Co", location="Bengaluru", final_url=url, description="Build reliable systems using Python.")
    return {"data": [item], "metadata": {}}


def test_search_combines_and_deduplicates_providers_without_claiming_total(monkeypatch):
    calls = install_dual_provider_clients(
        monkeypatch,
        adzuna_response=FakeResponse(payload=adzuna_payload()),
        theirstack_response=FakeResponse(payload=theirstack_payload()),
    )
    response = TestClient(main.app).get("/api/jobs", params={"role": "Platform Engineer", "location": "Bengaluru"})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["source"] == "Adzuna + TheirStack"
    assert "total_count" not in body
    assert body["providers"] == {"Adzuna": {"status": "available"}, "TheirStack": {"status": "available"}}
    assert body["jobs"][0]["source"] == "Adzuna"
    assert len(calls["adzuna"]) == len(calls["theirstack"]) == 1
    assert "test-stack-key" not in response.text
    assert calls["theirstack"][0][2] == {"Authorization": "Bearer test-stack-key"}


def test_only_theirstack_configured_returns_theirstack_results(monkeypatch):
    calls = install_dual_provider_clients(
        monkeypatch,
        theirstack_response=FakeResponse(payload=theirstack_payload(job_id=88, url="https://jobs.example/ts")),
    )
    monkeypatch.setattr(main, "APP_ID", None)
    monkeypatch.setattr(main, "APP_KEY", None)
    response = TestClient(main.app).get("/api/jobs")
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "TheirStack"
    assert body["jobs"][0]["id"] == "theirstack:88"
    assert body["providers"]["Adzuna"]["status"] == "not_configured"
    assert "Adzuna is not configured" in body["providers"]["Adzuna"]["message"]
    assert calls["adzuna"] == []
    assert len(calls["theirstack"]) == 1


def test_adzuna_failure_does_not_discard_theirstack_results(monkeypatch):
    calls = install_dual_provider_clients(
        monkeypatch,
        adzuna_error=httpx.ConnectError("secret provider detail"),
        theirstack_response=FakeResponse(payload=theirstack_payload(job_id=89, url="https://jobs.example/ts-89")),
    )
    response = TestClient(main.app).get("/api/jobs")
    assert response.status_code == 200
    assert [job["id"] for job in response.json()["jobs"]] == ["theirstack:89"]
    assert response.json()["providers"]["Adzuna"]["status"] == "unavailable"
    assert "secret provider detail" not in response.text
    assert calls["adzuna"] and calls["theirstack"]


def test_theirstack_failure_does_not_discard_adzuna_results(monkeypatch):
    calls = install_dual_provider_clients(
        monkeypatch,
        adzuna_response=FakeResponse(payload=adzuna_payload()),
        theirstack_response=FakeResponse(status_code=429, payload={"detail": "sensitive quota body"}),
    )
    response = TestClient(main.app).get("/api/jobs")
    assert response.status_code == 200
    body = response.json()
    assert [job["id"] for job in body["jobs"]] == ["a-1"]
    assert body["providers"]["TheirStack"]["status"] == "rate_limited"
    assert "sensitive quota body" not in response.text
    assert calls["adzuna"] and calls["theirstack"]


def test_both_provider_failures_return_useful_sanitized_error(monkeypatch):
    install_dual_provider_clients(
        monkeypatch,
        adzuna_error=httpx.ConnectError("do not expose this"),
        theirstack_response=FakeResponse(status_code=500, payload={"detail": "private provider response"}),
    )
    response = TestClient(main.app).get("/api/jobs")
    assert response.status_code == 502
    assert "All configured job search providers" in response.json()["detail"]
    assert "do not expose this" not in response.text
    assert "private provider response" not in response.text


def test_both_missing_provider_keys_return_actionable_error_without_provider_calls(monkeypatch):
    calls = install_dual_provider_clients(monkeypatch)
    monkeypatch.setattr(main, "APP_ID", None)
    monkeypatch.setattr(main, "APP_KEY", None)
    monkeypatch.setattr(main, "THEIRSTACK_API_KEY", "")
    response = TestClient(main.app).get("/api/jobs")
    assert response.status_code == 503
    assert "ADZUNA_APP_ID" in response.json()["detail"]
    assert "ADZUNA_APP_KEY" in response.json()["detail"]
    assert "THEIRSTACK_API_KEY" in response.json()["detail"]
    assert calls["adzuna"] == calls["theirstack"] == []


@pytest.mark.parametrize("payload", [{"data": []}, {"data": ["bad-job"], "metadata": {}}])
def test_invalid_theirstack_response_keeps_adzuna_results(monkeypatch, payload):
    install_dual_provider_clients(
        monkeypatch,
        adzuna_response=FakeResponse(payload=adzuna_payload()),
        theirstack_response=FakeResponse(payload=payload),
    )
    response = TestClient(main.app).get("/api/jobs")
    assert response.status_code == 200
    assert response.json()["providers"]["TheirStack"]["status"] == "invalid_response"
    assert response.json()["jobs"][0]["source"] == "Adzuna"
