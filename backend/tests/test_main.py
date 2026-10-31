import asyncio
import io
import importlib
import httpx
import os
import pytest
import subprocess
import sys
import time
import uuid
import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from types import SimpleNamespace
from pathlib import Path

from backend import main
from backend import security


def test_render_uvicorn_import_target_from_repository_root():
    repository_root = Path(__file__).resolve().parents[2]
    import_check = (
        "from uvicorn.importer import import_from_string; "
        "app = import_from_string('backend.main:app'); "
        "assert app.title == 'Kaam-Calm Job Search API'"
    )
    result = subprocess.run(
        [sys.executable, "-c", import_check],
        cwd=repository_root,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr


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


def install_fake_gemini(monkeypatch, text="Career advice", error=None):
    calls = []

    class FakeModels:
        async def generate_content(self, **kwargs):
            calls.append(kwargs)
            if error:
                raise error
            return SimpleNamespace(text=text)

    class FakeAsyncClient:
        def __init__(self, api_key):
            assert api_key == "test-gemini-key"
            self.models = FakeModels()

        @property
        def aio(self):
            return self

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

    monkeypatch.setattr(main.genai, "Client", FakeAsyncClient)
    monkeypatch.setattr(main, "GEMINI_API_KEY", "test-gemini-key")
    return calls


def test_resume_analyzer_extracts_txt_and_compares_job_description(monkeypatch, authenticated_assistant):
    calls = install_fake_gemini(monkeypatch, text="Resume review based on extracted facts.")
    resume = b"Experience: Data analyst. Skills: SQL and Excel. Project: Built a reporting dashboard."
    response = TestClient(main.app).post(
        "/api/assistant/resume-analysis",
        files={"file": ("resume.txt", resume, "text/plain")},
        data={"job_description": "Job description: SQL analyst with dashboard experience"},
    )
    assert response.status_code == 200
    assert response.json()["reply"] == "Resume review based on extracted facts."
    prompt = calls[0]["contents"][0].parts[0].text
    assert "Data analyst" in prompt and "SQL analyst with dashboard experience" in prompt


def test_resume_analyzer_handles_empty_and_unreadable_text_without_calling_provider(monkeypatch, authenticated_assistant):
    calls = install_fake_gemini(monkeypatch)
    client = TestClient(main.app)
    empty = client.post("/api/assistant/resume-analysis", files={"file": ("empty.txt", b"", "text/plain")})
    unreadable = client.post("/api/assistant/resume-analysis", files={"file": ("resume.txt", b"\xff\xfe", "text/plain")})
    assert empty.status_code == 413
    assert unreadable.status_code == 422
    assert "UTF-8" in unreadable.json()["detail"]
    assert calls == []


def test_resume_analyzer_extracts_pdf_and_docx_content(monkeypatch, authenticated_assistant):
    import sys
    from types import ModuleType

    class FakePage:
        def extract_text(self): return "Experience: analyst. Skills: SQL. Project: dashboard."
    pdf_reader = ModuleType("pypdf")
    pdf_reader.PdfReader = lambda _stream: SimpleNamespace(pages=[FakePage()])
    document_module = ModuleType("docx")
    document_module.Document = lambda _stream: SimpleNamespace(paragraphs=[SimpleNamespace(text="Experience: analyst. Skills: SQL. Project: dashboard.")])
    monkeypatch.setitem(sys.modules, "pypdf", pdf_reader)
    monkeypatch.setitem(sys.modules, "docx", document_module)
    calls = install_fake_gemini(monkeypatch, text="Review completed.")
    client = TestClient(main.app)
    for filename, data in (("resume.pdf", b"%PDF-1.4 fake"), ("resume.docx", b"PK fake")):
        response = client.post("/api/assistant/resume-analysis", files={"file": (filename, data, "application/octet-stream")})
        assert response.status_code == 200
    assert len(calls) == 2
    assert all("Experience: analyst" in call["contents"][0].parts[0].text for call in calls)


def _text_pdf_bytes(text):
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, body in enumerate(objects, 1):
        offsets.append(len(pdf)); pdf.extend(f"{number} 0 obj\n".encode()); pdf.extend(body); pdf.extend(b"\nendobj\n")
    xref = len(pdf); pdf.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]: pdf.extend(f"{offset:010d} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(pdf)


def test_resume_analyzer_extracts_real_pdf_and_docx_files(monkeypatch, authenticated_assistant):
    from docx import Document
    from pypdf import PdfWriter

    document = Document(); document.add_paragraph("Experience: analyst. Skills: SQL. Project: built a reporting dashboard.")
    docx_stream = io.BytesIO(); document.save(docx_stream)
    scanned = PdfWriter(); scanned.add_blank_page(width=612, height=792); scanned_stream = io.BytesIO(); scanned.write(scanned_stream)
    calls = install_fake_gemini(monkeypatch, text="Grounded resume review.")
    client = TestClient(main.app)
    pdf = client.post("/api/assistant/resume-analysis", files={"file": ("resume.pdf", _text_pdf_bytes("Experience: analyst. Skills: SQL. Project: built a reporting dashboard."), "application/pdf")})
    docx = client.post("/api/assistant/resume-analysis", files={"file": ("resume.docx", docx_stream.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    unreadable = client.post("/api/assistant/resume-analysis", files={"file": ("scan.pdf", scanned_stream.getvalue(), "application/pdf")})
    assert pdf.status_code == docx.status_code == 200
    assert "analyst" in calls[0]["contents"][0].parts[0].text
    assert "reporting dashboard" in calls[1]["contents"][0].parts[0].text
    assert unreadable.status_code == 422 and "Scanned PDFs need OCR" in unreadable.json()["detail"]


def test_resume_analyzer_rejects_legacy_doc_and_missing_extractor_actionably(monkeypatch, authenticated_assistant):
    import builtins
    client = TestClient(main.app)
    legacy = client.post("/api/assistant/resume-analysis", files={"file": ("resume.doc", b"legacy", "application/msword")})
    assert legacy.status_code == 415 and "Legacy DOC files are unsupported" in legacy.json()["detail"]
    original_import = builtins.__import__
    def no_pypdf(name, *args, **kwargs):
        if name == "pypdf": raise ModuleNotFoundError("pypdf", name="pypdf")
        return original_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", no_pypdf)
    missing = client.post("/api/assistant/resume-analysis", files={"file": ("resume.pdf", b"%PDF-1.4", "application/pdf")})
    assert missing.status_code == 503 and "Add the backend requirements with pypdf" in missing.json()["detail"]


def test_resume_analyzer_sends_verified_image_bytes_for_analysis(monkeypatch, authenticated_assistant):
    calls = install_fake_gemini(monkeypatch, text="The image contains a resume header.")
    png = b"\x89PNG\r\n\x1a\n" + b"safe-test-image"
    response = TestClient(main.app).post("/api/assistant/resume-analysis", files={"file": ("resume.png", png, "image/png")})
    assert response.status_code == 200
    assert response.json()["reply"] == "The image contains a resume header."
    parts = calls[0]["contents"][0].parts
    assert "attached image" in parts[0].text.lower()
    assert parts[1].inline_data.mime_type == "image/png"
    assert parts[1].inline_data.data == png


@pytest.fixture
def authenticated_assistant():
    dependency = main.require_authenticated_user
    previous_override = main.app.dependency_overrides.get(dependency)
    main.app.dependency_overrides[dependency] = lambda: "f2a73b38-256a-4a3a-90a4-393859c0a6ab"
    yield
    if previous_override is None:
        main.app.dependency_overrides.pop(dependency, None)
    else:
        main.app.dependency_overrides[dependency] = previous_override


def make_test_signing_key():
    return ec.generate_private_key(ec.SECP256R1())


def make_assistant_token(private_key, **claim_overrides):
    now = int(time.time())
    claims = {
        "iss": security.SUPABASE_ISSUER,
        "aud": security.SUPABASE_AUDIENCE,
        "exp": now + 300,
        "iat": now,
        "sub": "f2a73b38-256a-4a3a-90a4-393859c0a6ab",
        "role": "authenticated",
        "is_anonymous": False,
    }
    claims.update(claim_overrides)
    return jwt.encode(claims, private_key, algorithm="ES256", headers={"kid": "test-es256-key"})


def install_fake_jwks(monkeypatch, public_key):
    class FakeJwksClient:
        def get_signing_key_from_jwt(self, token):
            return SimpleNamespace(key=public_key)

    monkeypatch.setattr(security, "jwks_client", FakeJwksClient())


def install_auth_request_mock(monkeypatch, *, status_code=200, payload=None, error=None):
    calls = []

    class FakeAsyncClient:
        def __init__(self, timeout):
            assert timeout == security.AUTH_REQUEST_TIMEOUT

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def get(self, url, headers):
            calls.append((url, headers))
            if error:
                raise error
            return FakeResponse(status_code=status_code, payload=payload)

    monkeypatch.setattr(security.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(security, "SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")
    return calls


def test_root_health_endpoint():
    response = TestClient(main.app).get("/")

    assert response.status_code == 200
    assert response.headers["x-api-processing-ms"].isdigit()
    assert response.json() == {"message": "Kaam-Calm API is running"}


def test_supabase_auth_url_defaults_only_for_development_and_rejects_bad_urls():
    development_url, development_valid = security._resolve_supabase_url("", "development")
    production_url, production_valid = security._resolve_supabase_url("", "production")
    invalid_url, invalid_valid = security._resolve_supabase_url("http://localhost:54321", "production")

    assert development_url.startswith("https://") and development_valid
    assert production_url == "" and not production_valid
    assert invalid_url == "http://localhost:54321" and not invalid_valid


def test_chat_validation_error_does_not_echo_submitted_content(authenticated_assistant):
    secret_text = "Bearer do-not-echo-this-test-token"
    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "invalid-role", "content": secret_text}]},
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "The request did not match the expected format."}
    assert secret_text not in response.text


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
    for origin in ("http://localhost:5173", "http://localhost:5174", "https://kaam-calm.vercel.app"):
        response = client.options(
            "/api/jobs",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers["access-control-allow-origin"] == origin
        assert "GET" in response.headers["access-control-allow-methods"]

    assistant_preflight = client.options(
        "/api/assistant/chat",
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )
    assert assistant_preflight.headers["access-control-allow-origin"] == "http://localhost:5174"
    assert "POST" in assistant_preflight.headers["access-control-allow-methods"]
    assert "authorization" in assistant_preflight.headers["access-control-allow-headers"].lower()


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


def test_assistant_rejects_missing_and_malformed_bearer_tokens_without_provider_calls(monkeypatch):
    signing_key = make_test_signing_key()
    install_fake_jwks(monkeypatch, signing_key.public_key())
    gemini_calls = install_fake_gemini(monkeypatch)
    adzuna_calls = install_fake_adzuna(
        monkeypatch,
        FakeResponse(payload={"count": 0, "results": []}),
    )
    payload = {
        "messages": [{"role": "user", "content": "Find an engineer job in Pune"}],
        "job_search": {"role": "Engineer", "location": "Pune"},
    }
    client = TestClient(main.app)

    missing = client.post("/api/assistant/chat", json=payload)
    malformed = client.post(
        "/api/assistant/chat",
        json=payload,
        headers={"Authorization": "Bearer not-a-jwt"},
    )

    assert missing.status_code == 401
    assert malformed.status_code == 401
    assert "www-authenticate" in missing.headers
    assert gemini_calls == []
    assert adzuna_calls == []


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": int(time.time()) - 10},
        {"iss": "https://wrong-project.supabase.co/auth/v1"},
        {"aud": "anon"},
    ],
    ids=["expired", "wrong-issuer", "wrong-audience"],
)
def test_assistant_rejects_expired_or_wrong_project_es256_tokens(monkeypatch, claims):
    signing_key = make_test_signing_key()
    install_fake_jwks(monkeypatch, signing_key.public_key())
    gemini_calls = install_fake_gemini(monkeypatch)
    adzuna_calls = install_fake_adzuna(monkeypatch, FakeResponse(payload={"results": []}))
    token = make_assistant_token(signing_key, **claims)

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "Find an engineer job in Pune"}],
            "job_search": {"role": "Engineer", "location": "Pune"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert gemini_calls == []
    assert adzuna_calls == []


def test_expired_es256_auth_logs_only_safe_failure_category(monkeypatch, caplog):
    import logging

    caplog.set_level(logging.WARNING, logger="backend.security")
    signing_key = make_test_signing_key()
    install_fake_jwks(monkeypatch, signing_key.public_key())
    token = make_assistant_token(signing_key, exp=int(time.time()) - 10)

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Give me interview advice"}]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert "category=token_expired algorithm=ES256" in caplog.text
    assert token not in caplog.text
    assert "f2a73b38-256a-4a3a-90a4-393859c0a6ab" not in caplog.text


def test_assistant_rejects_invalid_es256_signature_without_provider_calls(monkeypatch):
    trusted_key = make_test_signing_key()
    untrusted_key = make_test_signing_key()
    install_fake_jwks(monkeypatch, trusted_key.public_key())
    gemini_calls = install_fake_gemini(monkeypatch)
    adzuna_calls = install_fake_adzuna(monkeypatch, FakeResponse(payload={"results": []}))
    token = make_assistant_token(untrusted_key)

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "Find an engineer job in Pune"}],
            "job_search": {"role": "Engineer", "location": "Pune"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert gemini_calls == []
    assert adzuna_calls == []


def test_assistant_accepts_valid_es256_token(monkeypatch):
    signing_key = make_test_signing_key()
    install_fake_jwks(monkeypatch, signing_key.public_key())
    gemini_calls = install_fake_gemini(monkeypatch, "Verified account response")
    token = make_assistant_token(signing_key)

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Give me interview tips"}]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["reply"] == "Verified account response"
    assert len(gemini_calls) == 1


def test_assistant_rejects_anonymous_es256_user(monkeypatch):
    signing_key = make_test_signing_key()
    install_fake_jwks(monkeypatch, signing_key.public_key())
    gemini_calls = install_fake_gemini(monkeypatch)
    token = make_assistant_token(signing_key, is_anonymous=True)

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Give me interview tips"}]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert gemini_calls == []


def make_legacy_test_token(**claim_overrides):
    now = int(time.time())
    claims = {
        "iss": security.SUPABASE_ISSUER,
        "aud": security.SUPABASE_AUDIENCE,
        "exp": now + 300,
        "iat": now,
        "sub": "f2a73b38-256a-4a3a-90a4-393859c0a6ab",
        "role": "authenticated",
        "is_anonymous": False,
    }
    claims.update(claim_overrides)
    return jwt.encode(claims, "test-only-legacy-signing-material", algorithm="HS256")


def test_assistant_accepts_valid_legacy_hs256_token_via_auth_user_endpoint(monkeypatch):
    token = make_legacy_test_token()
    auth_calls = install_auth_request_mock(
        monkeypatch,
        payload={"id": "f2a73b38-256a-4a3a-90a4-393859c0a6ab", "is_anonymous": False},
    )
    gemini_calls = install_fake_gemini(monkeypatch, "Legacy session verified")

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Give me interview tips"}]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["reply"] == "Legacy session verified"
    assert len(auth_calls) == 1
    assert auth_calls[0][0] == security.SUPABASE_USER_URL
    assert auth_calls[0][1]["apikey"] == "test-publishable-key"
    assert auth_calls[0][1]["Authorization"] == f"Bearer {token}"
    assert len(gemini_calls) == 1


def test_assistant_rejects_invalid_legacy_hs256_token(monkeypatch):
    auth_calls = install_auth_request_mock(monkeypatch, status_code=401, payload={"message": "invalid"})
    gemini_calls = install_fake_gemini(monkeypatch)

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Give me interview tips"}]},
        headers={"Authorization": f"Bearer {make_legacy_test_token()}"},
    )

    assert response.status_code == 401
    assert len(auth_calls) == 1
    assert gemini_calls == []


def test_assistant_fails_closed_when_legacy_auth_verification_is_unavailable(monkeypatch):
    auth_calls = install_auth_request_mock(
        monkeypatch,
        error=httpx.TimeoutException("mock timeout"),
    )
    gemini_calls = install_fake_gemini(monkeypatch)

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Give me interview tips"}]},
        headers={"Authorization": f"Bearer {make_legacy_test_token()}"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Sign-in verification is temporarily unavailable. Please try again."
    assert len(auth_calls) == 1
    assert gemini_calls == []


def test_assistant_fails_closed_when_project_jwks_cannot_be_reached(monkeypatch):
    class UnavailableJwksClient:
        def get_signing_key_from_jwt(self, token):
            raise jwt.PyJWKClientConnectionError("mock JWKS failure")

    monkeypatch.setattr(security, "jwks_client", UnavailableJwksClient())
    gemini_calls = install_fake_gemini(monkeypatch)
    signing_key = make_test_signing_key()
    token = make_assistant_token(signing_key)

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Give me interview tips"}]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 503
    assert gemini_calls == []


def test_assistant_rejects_missing_configuration_and_unknown_profile_fields(monkeypatch, authenticated_assistant):
    monkeypatch.setattr(main, "GEMINI_API_KEY", None)
    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Help me prepare for an interview"}]},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "The career assistant is not configured."

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Hello"}], "profile": {"email": "private@example.com"}},
    )
    assert response.status_code == 422


def test_assistant_validates_bounded_history_and_latest_user_message(authenticated_assistant):
    client = TestClient(main.app)
    too_many_messages = [{"role": "user", "content": "Hello"}] * 13
    response = client.post("/api/assistant/chat", json={"messages": too_many_messages})
    assert response.status_code == 422

    response = client.post("/api/assistant/chat", json={"messages": [{"role": "assistant", "content": "Hi"}]})
    assert response.status_code == 422


def test_assistant_uses_gemini_with_bounded_output_and_redacted_text(monkeypatch, authenticated_assistant):
    calls = install_fake_gemini(monkeypatch, "Practice structuring examples with STAR.")
    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Email me at person@example.com, call +1 (415) 555-0199. My file is C:\\Users\\me\\resume.pdf. Help with interviews."}]},
    )

    assert response.status_code == 200
    assert response.json() == {"reply": "Practice structuring examples with STAR.", "jobs": []}
    assert len(calls) == 1
    call = calls[0]
    assert call["model"] == "gemini-3.5-flash-lite"
    assert call["config"].max_output_tokens == main.ASSISTANT_MAX_OUTPUT_TOKENS
    sent_text = " ".join(part.text for turn in call["contents"] for part in turn.parts)
    assert "person@example.com" not in sent_text
    assert "415" not in sent_text
    assert "resume.pdf" not in sent_text
    assert "interviews" in sent_text
    assert "uploaded files" in call["config"].system_instruction


def test_assistant_uses_gemini_model_environment_override(monkeypatch, authenticated_assistant):
    previous_model = os.environ.get("GEMINI_MODEL")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-test-override")
    importlib.reload(main)
    main.app.dependency_overrides[main.require_authenticated_user] = lambda: "f2a73b38-256a-4a3a-90a4-393859c0a6ab"
    try:
        calls = install_fake_gemini(monkeypatch)
        response = TestClient(main.app).post(
            "/api/assistant/chat",
            json={"messages": [{"role": "user", "content": "Give me interview tips"}]},
        )
        assert response.status_code == 200
        assert calls[0]["model"] == "gemini-test-override"
    finally:
        main.app.dependency_overrides.pop(main.require_authenticated_user, None)
        if previous_model is None:
            monkeypatch.delenv("GEMINI_MODEL", raising=False)
        else:
            monkeypatch.setenv("GEMINI_MODEL", previous_model)
        importlib.reload(main)


def test_assistant_job_search_returns_only_real_adzuna_results(monkeypatch, authenticated_assistant):
    adzuna_calls = install_fake_adzuna(
        monkeypatch,
        FakeResponse(payload={"count": 1, "results": [{
            "id": "real-123", "title": "Data Analyst", "company": {"display_name": "Example Co"},
            "location": {"display_name": "Pune"}, "redirect_url": "https://jobs.example/real-123",
            "salary_min": 800000, "description": "Not sent to Gemini", "created": "today",
        }]}),
    )
    gemini_calls = install_fake_gemini(monkeypatch, "Here is one matching live listing.")

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "Find a data analyst job in Pune"}],
            "job_search": {"role": "Data Analyst", "location": "Pune"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["jobs"] == [{
        "id": "real-123", "title": "Data Analyst", "company": "Example Co", "location": "Pune",
        "url": "https://jobs.example/real-123", "source": "Adzuna", "salary": "From 800,000 per year",
    }]
    assert adzuna_calls[0][1]["what"] == "Data Analyst"
    assert adzuna_calls[0][1]["where"] == "Pune"
    sent_text = " ".join(part.text for turn in gemini_calls[0]["contents"] for part in turn.parts)
    assert "real-123" in sent_text
    assert "Not sent to Gemini" not in sent_text


def smart_match_payload(**overrides):
    payload = {
        "role": "Frontend Developer",
        "location": "Bengaluru",
        "jobs": [{"id": "adzuna-1", "page": 1}],
        "profile_consent": False,
    }
    payload.update(overrides)
    return payload


def matching_adzuna_response():
    return FakeResponse(payload={"count": 1, "results": [{
        "id": "adzuna-1", "title": "Frontend Developer", "company": {"display_name": "Example Co"},
        "location": {"display_name": "Bengaluru"}, "redirect_url": "https://jobs.example/adzuna-1",
        "description": "Build React interfaces and work with TypeScript.", "contract_type": "permanent",
        "category": {"label": "IT Jobs"},
    }]})


def test_match_explanations_require_authentication_before_adzuna_or_gemini(monkeypatch):
    adzuna_calls = install_fake_adzuna(monkeypatch, matching_adzuna_response())
    gemini_calls = install_fake_gemini(monkeypatch)
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=smart_match_payload())
    assert response.status_code == 401
    assert adzuna_calls == []
    assert gemini_calls == []


def test_match_explanations_reject_malformed_credentials_without_provider_calls(monkeypatch):
    adzuna_calls = install_fake_adzuna(monkeypatch, matching_adzuna_response())
    gemini_calls = install_fake_gemini(monkeypatch)
    response = TestClient(main.app).post(
        "/api/assistant/match-explanations", json=smart_match_payload(),
        headers={"Authorization": "Bearer not-a-valid-token"},
    )
    assert response.status_code == 401
    assert adzuna_calls == []
    assert gemini_calls == []


def test_match_explanations_without_consent_never_send_profile_data(monkeypatch, authenticated_assistant):
    install_fake_adzuna(monkeypatch, matching_adzuna_response())
    gemini_calls = install_fake_gemini(monkeypatch, '{"matches":[{"job_id":"adzuna-1","fit_summary":"React experience aligns with the listing.","matching_skills":["React"],"skill_gaps":["TypeScript"]}]}')
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=smart_match_payload())

    assert response.status_code == 200
    assert len(gemini_calls) == 1
    sent_text = " ".join(part.text for turn in gemini_calls[0]["contents"] for part in turn.parts)
    assert "consented_career_profile" not in sent_text
    assert '"profile_consent"' not in sent_text


def test_match_explanations_reject_profile_data_when_consent_is_absent(monkeypatch, authenticated_assistant):
    adzuna_calls = install_fake_adzuna(monkeypatch, matching_adzuna_response())
    gemini_calls = install_fake_gemini(monkeypatch)
    payload = smart_match_payload(career_profile={"skills": ["React"]})
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=payload)
    assert response.status_code == 422
    assert adzuna_calls == []
    assert gemini_calls == []


def test_match_explanations_send_only_allowlisted_profile_after_explicit_consent(monkeypatch, authenticated_assistant):
    install_fake_adzuna(monkeypatch, matching_adzuna_response())
    response_json = '{"matches":[{"job_id":"adzuna-1","fit_summary":"Your React background fits the role.","matching_skills":["React"],"skill_gaps":["TypeScript"]}]}'
    gemini_calls = install_fake_gemini(monkeypatch, response_json)
    payload = smart_match_payload(profile_consent=True, career_profile={
        "skills": ["React"], "preferred_roles": ["Frontend Developer"], "preferred_locations": ["Bengaluru"],
        "experience": [{"role": "UI Engineer", "duration": "3 years"}], "work_preferences": ["Remote", "Full-time"],
    })
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=payload)

    assert response.status_code == 200
    assert len(gemini_calls) == 1
    call = gemini_calls[0]
    assert call["config"].response_mime_type == "application/json"
    sent_text = " ".join(part.text for turn in call["contents"] for part in turn.parts)
    for allowed in ("React", "Frontend Developer", "Bengaluru", "UI Engineer", "3 years", "Remote"):
        assert allowed in sent_text
    assert "consented_career_profile" in sent_text
    assert "https://jobs.example/adzuna-1" not in sent_text
    assert response.json()["matches"][0]["job_id"] == "adzuna-1"


@pytest.mark.parametrize("private_field", ["full_name", "email", "phone", "address", "salary_history", "resume_path", "resume_file_name"])
def test_match_explanations_reject_profile_fields_outside_allowlist(monkeypatch, authenticated_assistant, private_field):
    adzuna_calls = install_fake_adzuna(monkeypatch, matching_adzuna_response())
    gemini_calls = install_fake_gemini(monkeypatch)
    profile = {"skills": ["React"], private_field: "private-value"}
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=smart_match_payload(profile_consent=True, career_profile=profile))
    assert response.status_code == 422
    assert adzuna_calls == []
    assert gemini_calls == []


def test_match_explanations_ignore_forged_job_ids_and_skip_gemini_when_none_verify(monkeypatch, authenticated_assistant):
    adzuna_calls = install_fake_adzuna(monkeypatch, matching_adzuna_response())
    gemini_calls = install_fake_gemini(monkeypatch)
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=smart_match_payload(jobs=[{"id": "invented-99", "page": 1}]))
    assert response.status_code == 200
    assert response.json()["matches"] == []
    assert response.json()["message"]
    assert len(adzuna_calls) == 1
    assert gemini_calls == []


def test_match_explanations_skip_gemini_for_empty_adzuna_results(monkeypatch, authenticated_assistant):
    install_fake_adzuna(monkeypatch, FakeResponse(payload={"count": 0, "results": []}))
    gemini_calls = install_fake_gemini(monkeypatch)
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=smart_match_payload())
    assert response.status_code == 200
    assert response.json()["matches"] == []
    assert gemini_calls == []


@pytest.mark.parametrize("output", [
    "",
    "not json",
    '{"matches":[{"job_id":"not-verified","fit_summary":"Invented","matching_skills":[],"skill_gaps":[]}]}',
    '{"matches":[{"job_id":"adzuna-1","fit_summary":"Apply at https://fake.example/job","matching_skills":[],"skill_gaps":[]}]}',
])
def test_match_explanations_safely_reject_malformed_or_ungrounded_gemini_output(monkeypatch, authenticated_assistant, output):
    install_fake_adzuna(monkeypatch, matching_adzuna_response())
    gemini_calls = install_fake_gemini(monkeypatch, output)
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=smart_match_payload())
    assert response.status_code == 502
    assert "Invented" not in response.text
    assert len(gemini_calls) == 1


def test_match_explanations_sanitize_provider_failures(monkeypatch, authenticated_assistant):
    install_fake_adzuna(monkeypatch, matching_adzuna_response())
    install_fake_gemini(monkeypatch, error=RuntimeError("private provider detail"))
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=smart_match_payload())
    assert response.status_code == 502
    assert "private provider detail" not in response.text


def test_match_explanations_return_safe_error_when_adzuna_fails(monkeypatch, authenticated_assistant):
    install_fake_adzuna(monkeypatch, error=httpx.ConnectError("private Adzuna detail"))
    gemini_calls = install_fake_gemini(monkeypatch)
    response = TestClient(main.app).post("/api/assistant/match-explanations", json=smart_match_payload())
    assert response.status_code == 502
    assert "private Adzuna detail" not in response.text
    assert gemini_calls == []


def test_regular_job_search_endpoint_remains_unauthenticated_and_unchanged(monkeypatch):
    install_fake_adzuna(monkeypatch, matching_adzuna_response())
    response = TestClient(main.app).get("/api/jobs", params={"role": "Frontend Developer", "location": "Bengaluru"})
    assert response.status_code == 200
    assert response.json()["source"] == "Adzuna"
    assert response.json()["jobs"][0]["id"] == "adzuna-1"


def test_assistant_timeout_and_provider_errors_are_sanitized(monkeypatch, authenticated_assistant):
    install_fake_gemini(monkeypatch, error=RuntimeError("private provider response"))
    client = TestClient(main.app)
    payload = {"messages": [{"role": "user", "content": "Help with an interview"}]}
    response = client.post("/api/assistant/chat", json=payload)
    assert response.status_code == 502
    assert "private provider response" not in response.text

    class SlowModels:
        async def generate_content(self, **kwargs):
            import asyncio
            await asyncio.sleep(0.05)
            return SimpleNamespace(text="Too late")

    class SlowClient:
        def __init__(self, api_key):
            self.models = SlowModels()
            self.cleanup_started = False
            self.cleanup_cancelled = False

        @property
        def aio(self):
            return self

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            self.cleanup_started = True
            try:
                await asyncio.sleep(1)
            except asyncio.CancelledError:
                self.cleanup_cancelled = True
                raise
            return False

    slow_clients = []
    original_slow_client = SlowClient

    def make_slow_client(api_key):
        client_instance = original_slow_client(api_key)
        slow_clients.append(client_instance)
        return client_instance

    monkeypatch.setattr(main.genai, "Client", make_slow_client)
    monkeypatch.setattr(main, "ASSISTANT_TIMEOUT_SECONDS", 0.005)
    monkeypatch.setattr(main, "ASSISTANT_CLEANUP_TIMEOUT_SECONDS", 0.005)
    response = client.post("/api/assistant/chat", json=payload)
    assert response.status_code == 504
    assert response.json()["detail"] == "The career assistant took too long to respond. Please try again."
    assert slow_clients[0].cleanup_started is True
    assert slow_clients[0].cleanup_cancelled is True


@pytest.mark.parametrize(
    ("error_type", "code", "provider_status", "http_status", "category"),
    [
        ("ClientError", 401, "UNAUTHENTICATED", 503, "authentication"),
        ("ClientError", 403, "PERMISSION_DENIED", 503, "access_permission"),
        ("ClientError", 404, "NOT_FOUND", 503, "model_access"),
        ("ClientError", 429, "RESOURCE_EXHAUSTED", 429, "quota_or_rate_limit"),
        ("ServerError", 503, "UNAVAILABLE", 502, "provider_server_error"),
    ],
)
def test_assistant_classifies_gemini_api_errors_without_logging_sensitive_details(
    monkeypatch, caplog, authenticated_assistant, error_type, code, provider_status, http_status, category
):
    response_message = "private provider response"
    error_class = getattr(main.genai_errors, error_type)
    error = error_class(code, {"error": {"status": provider_status, "message": response_message}})
    install_fake_gemini(monkeypatch, error=error)

    response = TestClient(main.app).post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "Give me interview tips"}]},
    )

    assert response.status_code == http_status
    assert response_message not in response.text
    assert "test-gemini-key" not in response.text
    assert f"exception_type={error_type}" in caplog.text
    assert f"provider_http_status={code}" in caplog.text
    assert f"provider_status={provider_status}" in caplog.text
    assert f"category={category}" in caplog.text
    assert response_message not in caplog.text
    assert "test-gemini-key" not in caplog.text
