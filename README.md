# kaam-calm
Kaam-Calm is a unified global job discovery platform that brings opportunities from multiple job portals into one place, with personalized search, resume management, and recruiter-focused features.

## Local setup

### Frontend

Requires Node.js and npm. From the repository root:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Set `VITE_API_BASE_URL` in `.env` to choose the backend URL. In development it defaults to `http://127.0.0.1:8001`. Production builds require an explicit public HTTPS API URL and refuse missing, malformed, or loopback URLs instead of falling back to a hard-coded service. Vite exposes `VITE_` variables to browser code, so do not put credentials or secrets in variables with that prefix.

To make a production build, run `npm run build`.

### Backend

Requires Python 3.10 or newer. From the repository root, create and activate a virtual environment, then install the backend requirements:

```powershell
py -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
```

Set at least one job provider in the backend process. TheirStack is optional, and its key stays on the backend. Gemini is required only for AI Career chat, resume analysis, and match explanations:

```powershell
$env:APP_ENV = "development"
$env:RATE_LIMIT_BACKEND = "memory"
$env:ADZUNA_APP_ID = "your-app-id"
$env:ADZUNA_APP_KEY = "your-app-key"
# Optional; one TheirStack result costs one API credit.
$env:THEIRSTACK_API_KEY = "your-theirstack-api-key"
$env:SUPABASE_PUBLISHABLE_KEY = "your-kaam-calm-test-publishable-key"
$env:GEMINI_API_KEY = "your-gemini-api-key"
# Optional; defaults to gemini-3.5-flash-lite.
$env:GEMINI_MODEL = "gemini-3.5-flash-lite"
python -m uvicorn backend.main:app --reload --no-proxy-headers --port 8001
```

FastAPI does not automatically load the repository-root `.env`. If you keep backend settings there, import them into the current PowerShell process before starting Uvicorn (the command prints no values):

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$' -and $Matches[1] -notmatch '^\s*#') {
    $envName = $Matches[1]
    $envValue = $Matches[2].Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($envName, $envValue, 'Process')
  }
}
$env:APP_ENV = "development"
$env:RATE_LIMIT_BACKEND = "memory"
python -m uvicorn backend.main:app --reload --no-proxy-headers --port 8001
```

Configure `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` together for Adzuna, or `THEIRSTACK_API_KEY` for TheirStack; at least one provider must be configured. The local environment currently reports Adzuna unset, which explains the previous provider-not-configured response. TheirStack uses `POST https://api.theirstack.com/v1/jobs/search` with Bearer auth, a 90-day posting filter to support the existing date filter, and five results per page by default (configurable from 1 to 10). Each returned job consumes one TheirStack API credit. Location text is resolved against TheirStack's location catalog and sent as a structured location ID filter; unresolved locations do not trigger an unfiltered search. Repeated identical provider-page searches use a bounded in-process cache for 120 seconds by default; set `JOB_SEARCH_CACHE_TTL_SECONDS` between 0 and 900 to adjust it (0 disables caching). The cache and in-flight request coalescing are per backend process. No total result count is requested from TheirStack.

For the Render web service, keep its Root Directory at the repository root (the default), use `pip install -r backend/requirements.txt` as the Build Command, and use `uvicorn backend.main:app --host 0.0.0.0 --port $PORT --no-proxy-headers` as the Start Command. The backend is a Python package and must be imported from the repository root; do not set the service Root Directory to `backend/` with this package-form command. Disabling Uvicorn proxy-header parsing prevents untrusted forwarded headers from changing the ASGI client address.

The backend listens at `http://127.0.0.1:8001`; the frontend `.env` should use `VITE_API_BASE_URL=http://127.0.0.1:8001`. Local development must explicitly use `APP_ENV=development` and `RATE_LIMIT_BACKEND=memory`; this limiter is bounded and process-local, and is not suitable for a public multi-instance deployment. Backend process variables include `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, optional `THEIRSTACK_API_KEY`, optional `THEIRSTACK_JOBS_PER_PAGE` (default 5, capped at 10), optional `JOB_SEARCH_CACHE_TTL_SECONDS` (default 120), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `GEMINI_API_KEY`, and optional `GEMINI_MODEL`. `SUPABASE_URL` selects the Auth issuer and JWKS used to verify signed-in users; it is required in production. Legacy HS256 sessions also require that project's publishable key. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. Keep credentials out of frontend variables and source control; never use a `VITE_` prefix for them.

The assistant limiter defaults to 30 requests per minute per client IP, 6 requests per minute and 50 per day per verified user, at most 2 concurrent requests per user, a 128 KiB request body, and a 55-second total assistant deadline. Override these with `RATE_LIMIT_IP_PER_MINUTE`, `RATE_LIMIT_USER_PER_MINUTE`, `RATE_LIMIT_USER_PER_DAY`, `RATE_LIMIT_USER_CONCURRENCY`, `ASSISTANT_MAX_BODY_BYTES`, and `ASSISTANT_TOTAL_TIMEOUT_SECONDS` as needed. Local requests use the direct socket peer; the development command disables forwarded-header parsing so arbitrary `X-Forwarded-For` headers are ignored.

The Home page shows Adzuna and TheirStack in one feed, deduplicates identical listings conservatively, labels each job's source, and preserves pagination and existing save/apply actions. A provider failure is shown as a status while results from a working provider remain available. The providers do not expose a reliable shared total, so the combined feed does not claim one. Provider fields that are absent remain blank; structured workplace and skills filters only match jobs with those fields. The cache is process-local, so separate backend instances have separate caches.

Smart Job Matching uses the existing authenticated, opt-in Gemini flow and can verify either provider's selected jobs. Signed-in users can explicitly choose **Explain matches** for up to five current results. Profile-based explanations send only skills, preferred roles and locations, experience role and duration, selected education qualifications, project names/descriptions/technologies, certifications, and work preferences after the user checks the consent box; names, contact details, salary, resume files, storage paths, and credential links are excluded. The explanation and score are not persisted. Gemini returns an evidence-grounded score and fit summary; recommendations are derived from the score, and scores without profile evidence are capped and labeled as search relevance rather than personalized fit. The backend rechecks selected provider IDs before asking Gemini. Users can browse and save jobs without signing in or enabling matching.

For production, set the frontend build variables `VITE_API_BASE_URL` (public HTTPS backend origin), `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`) in Vercel. On Render set `APP_ENV=production`, `SUPABASE_URL`, `GEMINI_API_KEY`, `RATE_LIMIT_BACKEND=redis`, and `REDIS_URL` to an approved private Redis-compatible service. Configure `CORS_ORIGINS` with the exact deployed frontend origin when needed. For live jobs configure either the Adzuna pair `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`, `THEIRSTACK_API_KEY`, or both. `THEIRSTACK_JOBS_PER_PAGE` and `JOB_SEARCH_CACHE_TTL_SECONDS` are optional backend tuning settings. Keep all provider and Gemini keys on Render only; never add them to Vercel `VITE_` variables. `SUPABASE_PUBLISHABLE_KEY` is needed only for legacy HS256 auth tokens. The assistant fails closed with HTTP 503 if its shared limiter, trusted client IP header, or Auth project configuration is missing/unavailable; it never falls back to memory or the development Auth project. In Render production, the limiter accepts exactly one syntactically valid `CF-Connecting-IP` header as the client IP. It ignores `X-Forwarded-For`; do not configure proxy CIDRs or Uvicorn `FORWARDED_ALLOW_IPS`. This assumes the Render service receives requests only through the confirmed Cloudflare ingress, which supplies the authoritative header. The Render start command disables Uvicorn proxy-header parsing, so forwarded headers cannot rewrite the ASGI socket peer. There is no Render service manifest or request-timeout setting in this repository, so confirm the Render request deadline and service start command in the Render dashboard before deploying; allow at least 65 seconds for frontend chat requests and ensure the host deadline exceeds the configured 55-second backend deadline. No database schema change is needed for this job feed update.

The backend allows the production frontend and the common local Vite origins by default. Set `CORS_ORIGINS` to a comma-separated list of additional frontend origins when needed; each origin must include its scheme and host.

To install the backend test dependencies and run the mocked API tests:

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
backend\.venv\Scripts\python.exe -m pytest -p no:cacheprovider backend\tests
```

## Supabase setup

Supabase authentication and saved-job persistence use only browser-safe project configuration. Copy the blank Supabase entries from `.env.example` into your local `.env` and set `VITE_SUPABASE_URL` and either `VITE_SUPABASE_PUBLISHABLE_KEY` or the legacy `VITE_SUPABASE_ANON_KEY`. Never put a secret or service-role key in a `VITE_` variable.

Before using the account and saved-job flows, apply [`supabase/migrations/202610250001_saved_jobs.sql`](supabase/migrations/202610250001_saved_jobs.sql) to your Supabase project yourself. You can paste it into the Supabase Dashboard SQL Editor and run it, or apply it through your own Supabase CLI workflow. This repository does not run the migration automatically. The SQL creates `public.saved_jobs`, enables RLS, and grants authenticated users select/insert/delete access constrained to `auth.uid() = user_id`.

In the Supabase Dashboard, enable Email under Authentication providers and set the allowed site/redirect URLs for your local frontend and deployed frontend. If email confirmation is enabled, new users must confirm their email before signing in. Authentication and persistence are not verified against a live project until you configure these values and apply the SQL.
