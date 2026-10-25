import os

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Kaam-Calm Job Search API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://kaam-calm.vercel.app",
        "http://localhost:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

APP_ID = os.getenv("ADZUNA_APP_ID")
APP_KEY = os.getenv("ADZUNA_APP_KEY")


@app.get("/")
def home():
    return {"message": "Kaam-Calm API is running"}


@app.get("/api/jobs")
async def search_jobs(
    role: str = Query(default="software developer", min_length=1),
    location: str = Query(default="India", min_length=1),
    page: int = Query(default=1, ge=1, le=10),
):
    if not APP_ID or not APP_KEY:
        raise HTTPException(
            status_code=503,
            detail="Job search API credentials are not configured.",
        )

    url = (
        f"https://api.adzuna.com/v1/api/jobs/in/search/{page}"
    )

    params = {
        "app_id": APP_ID,
        "app_key": APP_KEY,
        "results_per_page": 20,
        "what": role,
        "where": location,
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(url, params=params)

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail="The job provider could not complete the search.",
            )

        data = response.json()
        jobs = []

        for item in data.get("results", []):
            salary_min = item.get("salary_min")
            salary_max = item.get("salary_max")

            salary = ""
            if salary_min is not None and salary_max is not None:
                salary = f"{salary_min:,.0f} - {salary_max:,.0f} per year"
            elif salary_min is not None:
                salary = f"From {salary_min:,.0f} per year"
            elif salary_max is not None:
                salary = f"Up to {salary_max:,.0f} per year"

            contract_time = item.get("contract_time") or ""
            contract_type = item.get("contract_type") or ""

            job_type = contract_time or contract_type
            job_type = job_type.replace("_", " ").strip().title()

            jobs.append({
                "id": str(item.get("id", "")),
                "title": item.get("title", "Untitled job"),
                "company": item.get("company", {}).get(
                    "display_name", "Not specified"
                ),
                "location": item.get("location", {}).get(
                    "display_name", "Not specified"
                ),
                "description": item.get("description", ""),
                "url": item.get("redirect_url", ""),
                "source": "Adzuna",
                "created": item.get("created", ""),
                "type": job_type,
                "experience": "",
                "salary": salary,
                "category": item.get("category", {}).get("label", ""),
            })

        return {
            "count": len(jobs),
            "jobs": jobs,
            "source": "Adzuna",
        }

    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to the job provider.",
        )
