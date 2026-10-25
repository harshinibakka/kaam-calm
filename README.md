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

Set `VITE_API_BASE_URL` in `.env` to choose the backend URL. If it is unset, the frontend uses the existing production API URL. Vite exposes `VITE_` variables to browser code, so do not put credentials or secrets in variables with that prefix.

To make a production build, run `npm run build`.

### Backend

Requires Python 3.10 or newer. From the repository root, create and activate a virtual environment, then install the backend requirements:

```powershell
py -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
```

Set the Adzuna credentials in the same PowerShell session, then start FastAPI:

```powershell
$env:ADZUNA_APP_ID = "your-app-id"
$env:ADZUNA_APP_KEY = "your-app-key"
python -m uvicorn main:app --reload --app-dir backend
```

The backend listens at `http://localhost:8000`. Configure the frontend `.env` with `VITE_API_BASE_URL=http://localhost:8000` to use it locally. The backend reads `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` directly from its process environment; keep these credentials out of frontend variables and source control.

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
