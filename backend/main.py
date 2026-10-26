import math
import os
import time

import httpx
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Kaam-Calm Job Search API")

DEFAULT_CORS_ORIGINS = [
    "https://kaam-calm.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
ADDITIONAL_CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(DEFAULT_CORS_ORIGINS + ADDITIONAL_CORS_ORIGINS)),
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
    expose_headers=["X-Provider-Latency-Ms", "X-API-Processing-Ms"],
)


@app.middleware("http")
async def add_processing_time_header(request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-API-Processing-Ms"] = str(round((time.perf_counter() - started) * 1000))
    return response

APP_ID = os.getenv("ADZUNA_APP_ID")
APP_KEY = os.getenv("ADZUNA_APP_KEY")


def _safe_text(value, fallback=""):
    return value if isinstance(value, str) else fallback


def _format_salary_value(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        if not math.isfinite(value):
            return None
    except OverflowError:
        return None
    return f"{value:,.0f}"


@app.get("/")
def home():
    return {"message": "Kaam-Calm API is running"}


@app.get("/api/jobs")
async def search_jobs(
    api_response: Response,
    role: str = Query(default="software developer", min_length=1),
    location: str = Query(default="India", min_length=1),
    page: int = Query(default=1, ge=1, le=10),
):
    if not APP_ID or not APP_KEY:
        raise HTTPException(
            status_code=503,
            detail="Job search API credentials are not configured.",
        )

    url = f"https://api.adzuna.com/v1/api/jobs/in/search/{page}"
    params = {
        "app_id": APP_ID,
        "app_key": APP_KEY,
        "results_per_page": 20,
        "what": role,
        "where": location,
        "content-type": "application/json",
    }

    try:
        provider_started = time.perf_counter()
        timeout = httpx.Timeout(18.0, connect=4.0, read=15.0, write=5.0, pool=2.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            provider_response = await client.get(url, params=params)
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to the job provider.",
        )

    api_response.headers["X-Provider-Latency-Ms"] = str(round((time.perf_counter() - provider_started) * 1000))
    if provider_response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="The job provider could not complete the search.",
        )

    try:
        data = provider_response.json()
    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="The job provider returned an invalid response.",
        )

    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        raise HTTPException(
            status_code=502,
            detail="The job provider returned an invalid response.",
        )

    results = data["results"]
    has_total_count = "count" in data
    total_count = data.get("count", len(results))
    if (
        isinstance(total_count, bool)
        or not isinstance(total_count, int)
        or total_count < 0
    ):
        raise HTTPException(
            status_code=502,
            detail="The job provider returned an invalid response.",
        )

    jobs = []
    for index, item in enumerate(results):
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=502,
                detail="The job provider returned an invalid response.",
            )

        company = item.get("company")
        location_data = item.get("location")
        category = item.get("category")
        company = company if isinstance(company, dict) else {}
        location_data = location_data if isinstance(location_data, dict) else {}
        category = category if isinstance(category, dict) else {}

        salary_min = _format_salary_value(item.get("salary_min"))
        salary_max = _format_salary_value(item.get("salary_max"))
        if salary_min and salary_max:
            salary = f"{salary_min} - {salary_max} per year"
        elif salary_min:
            salary = f"From {salary_min} per year"
        elif salary_max:
            salary = f"Up to {salary_max} per year"
        else:
            salary = ""

        contract_time = _safe_text(item.get("contract_time"))
        contract_type = _safe_text(item.get("contract_type"))
        job_type = (contract_time or contract_type).replace("_", " ").strip().title()
        title = _safe_text(item.get("title"), "Untitled job")
        job_url = _safe_text(item.get("redirect_url"))
        job_id = item.get("id")
        if job_id is None or str(job_id).strip() == "":
            job_id = job_url or f"{title}-{page}-{index}"

        jobs.append({
            "id": str(job_id),
            "title": title,
            "company": _safe_text(company.get("display_name"), "Not specified"),
            "location": _safe_text(location_data.get("display_name"), "Not specified"),
            "description": _safe_text(item.get("description")),
            "url": job_url,
            "source": "Adzuna",
            "created": _safe_text(item.get("created")),
            "type": job_type,
            "experience": "",
            "salary": salary,
            "category": _safe_text(category.get("label")),
        })

    return {
        "count": len(jobs),
        "total_count": total_count,
        "has_more": page < 10 and (
            page * 20 < total_count if has_total_count else len(results) >= 20
        ),
        "jobs": jobs,
        "source": "Adzuna",
    }
