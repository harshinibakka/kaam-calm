
import os
from urllib.parse import quote

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
        f"?app_id={quote(APP_ID)}"
        f"&app_key={quote(APP_KEY)}"
        f"&results_per_page=20"
        f"&what={quote(role)}"
        f"&where={quote(location)}"
        f"&content-type=application/json"
    )

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(url)

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail="The job provider could not complete the search.",
            )

        data = response.json()
        jobs = []

        for item in data.get("results", []):
            jobs.append({
                "id": str(item.get("id", "")),
                "title": item.get("title", "Untitled job"),
                "company": item.get("company", {}).get("display_name", "Not specified"),
                "location": item.get("location", {}).get("display_name", "Not specified"),
                "description": item.get("description", ""),
                "url": item.get("redirect_url", ""),
                "source": "Adzuna",
                "created": item.get("created", ""),
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
