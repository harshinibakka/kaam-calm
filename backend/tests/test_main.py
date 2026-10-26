import httpx
from fastapi.testclient import TestClient

from backend import main


class FakeResponse:
    def __init__(self, status_code=200, payload=None, json_error=None):
        self.status_code = status_code
        self.payload = payload
        self.json_error = json_error

    def json(self):
        if self.json_error:
            raise self.json_error
        return self.payload


def install_fake_adzuna(monkeypatch, response=None, error=None):
    calls = []

    class FakeAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def get(self, url, params):
            calls.append((url, params))
            if error:
                raise error
            return response

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(main, "APP_ID", "test-app-id")
    monkeypatch.setattr(main, "APP_KEY", "test-app-key")
    return calls


def test_root_health_endpoint():
    response = TestClient(main.app).get("/")

    assert response.status_code == 200
    assert response.headers["x-api-processing-ms"].isdigit()
    assert response.json() == {"message": "Kaam-Calm API is running"}


def test_job_search_maps_provider_response_and_query(monkeypatch):
    calls = install_fake_adzuna(
        monkeypatch,
        FakeResponse(
            payload={
                "count": 41,
                "results": [
                    {
                        "id": "123",
                        "title": "Frontend Engineer",
                        "company": {"display_name": "Example Co"},
                        "location": {"display_name": "Bengaluru"},
                        "description": "Build frontend applications",
                        "redirect_url": "https://jobs.example/123",
                        "created": "2026-10-25T00:00:00Z",
                        "contract_time": "full_time",
                        "salary_min": 100000,
                        "salary_max": 140000,
                        "category": {"label": "IT Jobs"},
                    }
                ],
            }
        ),
    )

    response = TestClient(main.app).get(
        "/api/jobs", params={"role": "frontend engineer", "location": "Bengaluru", "page": 2}
    )

    assert response.status_code == 200
    assert response.headers["x-provider-latency-ms"].isdigit()
    assert response.headers["x-api-processing-ms"].isdigit()
    body = response.json()
    assert body["count"] == 1
    assert body["total_count"] == 41
    assert body["has_more"] is True
    assert body["source"] == "Adzuna"
    assert body["jobs"] == [
        {
            "id": "123",
            "title": "Frontend Engineer",
            "company": "Example Co",
            "location": "Bengaluru",
            "description": "Build frontend applications",
            "url": "https://jobs.example/123",
            "source": "Adzuna",
            "created": "2026-10-25T00:00:00Z",
            "type": "Full Time",
            "experience": "",
            "salary": "100,000 - 140,000 per year",
            "category": "IT Jobs",
        }
    ]
    assert calls == [
        (
            "https://api.adzuna.com/v1/api/jobs/in/search/2",
            {
                "app_id": "test-app-id",
                "app_key": "test-app-key",
                "results_per_page": 20,
                "what": "frontend engineer",
                "where": "Bengaluru",
                "content-type": "application/json",
            },
        )
    ]


def test_missing_credentials_returns_service_unavailable_without_provider_call(monkeypatch):
    monkeypatch.setattr(main, "APP_ID", None)
    monkeypatch.setattr(main, "APP_KEY", None)

    response = TestClient(main.app).get("/api/jobs")

    assert response.status_code == 503
    assert response.json()["detail"] == "Job search API credentials are not configured."


def test_provider_http_error_is_sanitized(monkeypatch):
    install_fake_adzuna(monkeypatch, FakeResponse(status_code=429))

    response = TestClient(main.app).get("/api/jobs")

    assert response.status_code == 502
    assert response.json()["detail"] == "The job provider could not complete the search."
    assert "test-app-key" not in response.text


def test_provider_network_error_is_sanitized(monkeypatch):
    install_fake_adzuna(monkeypatch, error=httpx.RequestError("mock connection failure"))

    response = TestClient(main.app).get("/api/jobs")

    assert response.status_code == 502
    assert response.json()["detail"] == "Could not connect to the job provider."
    assert "test-app-key" not in response.text


def test_malformed_provider_json_is_a_gateway_error(monkeypatch):
    install_fake_adzuna(monkeypatch, FakeResponse(json_error=ValueError("invalid json")))

    response = TestClient(main.app).get("/api/jobs")

    assert response.status_code == 502
    assert response.json()["detail"] == "The job provider returned an invalid response."


def test_malformed_provider_payload_and_job_records_are_gateway_errors(monkeypatch):
    install_fake_adzuna(monkeypatch, FakeResponse(payload={"results": None}))
    response = TestClient(main.app).get("/api/jobs")
    assert response.status_code == 502

    install_fake_adzuna(monkeypatch, FakeResponse(payload={"results": ["not-a-job"]}))
    response = TestClient(main.app).get("/api/jobs")
    assert response.status_code == 502
    assert response.json()["detail"] == "The job provider returned an invalid response."


def test_unexpected_job_fields_use_safe_defaults(monkeypatch):
    install_fake_adzuna(
        monkeypatch,
        FakeResponse(
            payload={
                "results": [
                    {
                        "title": 42,
                        "company": "unexpected scalar",
                        "location": [],
                        "category": None,
                        "description": ["unexpected list"],
                        "contract_time": 99,
                        "salary_min": "unknown",
                    }
                ]
            }
        ),
    )

    response = TestClient(main.app).get("/api/jobs")

    assert response.status_code == 200
    job = response.json()["jobs"][0]
    assert job["title"] == "Untitled job"
    assert job["company"] == "Not specified"
    assert job["location"] == "Not specified"
    assert job["description"] == ""
    assert job["type"] == ""
    assert job["salary"] == ""
    assert job["experience"] == ""


def test_cors_allows_local_and_production_frontend_origins():
    client = TestClient(main.app)
    for origin in ("http://localhost:5173", "https://kaam-calm.vercel.app"):
        response = client.options(
            "/api/jobs",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers["access-control-allow-origin"] == origin
        assert "GET" in response.headers["access-control-allow-methods"]


def test_cors_rejects_unknown_origin():
    response = TestClient(main.app).options(
        "/api/jobs",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
