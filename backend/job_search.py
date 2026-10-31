"""Provider adapters and a small bounded cache for the public job search feed."""

import asyncio
import hashlib
import math
import os
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

THEIRSTACK_URL = "https://api.theirstack.com/v1/jobs/search"
THEIRSTACK_LOCATIONS_URL = "https://api.theirstack.com/v0/catalog/locations"
DEFAULT_THEIRSTACK_PAGE_SIZE = 5
MAX_THEIRSTACK_PAGE_SIZE = 10
DEFAULT_CACHE_TTL_SECONDS = 120
MAX_CACHE_TTL_SECONDS = 900
MAX_CACHE_ENTRIES = 256
THEIRSTACK_MAX_POST_AGE_DAYS = 90
PROVIDER_TIMEOUT_SECONDS = 12


@dataclass
class ProviderPage:
    jobs: list[dict]
    has_more: bool
    status: str
    total_count: int | None = None
    latency_ms: int | None = None


_page_cache: dict[tuple, tuple[float, ProviderPage]] = {}
_in_flight: dict[tuple, asyncio.Task] = {}
_location_cache: dict[tuple, tuple[float, int]] = {}
_location_in_flight: dict[tuple, asyncio.Task] = {}


def clear_search_cache() -> None:
    """Clear the process cache (used by tests and credential rotation)."""
    _page_cache.clear()
    _in_flight.clear()
    _location_cache.clear()
    _location_in_flight.clear()


def _bounded_store(cache: dict, key: tuple, value) -> None:
    cache.pop(key, None)
    while len(cache) >= MAX_CACHE_ENTRIES:
        cache.pop(next(iter(cache)))
    cache[key] = value


def _fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def _cache_ttl() -> int:
    try:
        value = int(os.getenv("JOB_SEARCH_CACHE_TTL_SECONDS", str(DEFAULT_CACHE_TTL_SECONDS)))
    except (TypeError, ValueError):
        value = DEFAULT_CACHE_TTL_SECONDS
    return max(0, min(value, MAX_CACHE_TTL_SECONDS))


async def _theirstack_location_id(location: str, api_key: str) -> int | None:
    """Resolve a user-entered location to a catalog ID without guessing."""
    ttl = _cache_ttl()
    key = (_fingerprint(api_key), re.sub(r"\s+", " ", location.casefold()).strip())
    cached = _location_cache.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    if cached:
        _location_cache.pop(key, None)

    task = _location_in_flight.get(key)
    if task is None:
        async def load():
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(PROVIDER_TIMEOUT_SECONDS, connect=4.0)) as client:
                    response = await client.get(
                        THEIRSTACK_LOCATIONS_URL,
                        params={"name": location, "limit": 5},
                        headers={"Authorization": f"Bearer {api_key}"},
                    )
                if response.status_code != 200:
                    return None
                data = response.json()
            except (httpx.RequestError, ValueError, TypeError):
                return None
            items = data if isinstance(data, list) else None
            if items is None:
                return None
            query = re.sub(r"\s+", " ", location.casefold()).strip()
            for item in items:
                if not isinstance(item, dict):
                    continue
                name = re.sub(r"\s+", " ", str(item.get("name", "")).casefold()).strip()
                display_name = re.sub(r"\s+", " ", str(item.get("display_name", "")).casefold()).strip()
                location_id = item.get("id")
                if query in {name, display_name} and isinstance(location_id, int) and not isinstance(location_id, bool):
                    return location_id
            return None

        task = asyncio.create_task(load())
        _location_in_flight[key] = task
    try:
        location_id = await asyncio.shield(task)
        if location_id is not None and ttl > 0:
            _bounded_store(_location_cache, key, (time.monotonic() + ttl, location_id))
        return location_id
    finally:
        if _location_in_flight.get(key) is task and task.done():
            _location_in_flight.pop(key, None)


def theirstack_page_size() -> int:
    try:
        value = int(os.getenv("THEIRSTACK_JOBS_PER_PAGE", str(DEFAULT_THEIRSTACK_PAGE_SIZE)))
    except (TypeError, ValueError):
        value = DEFAULT_THEIRSTACK_PAGE_SIZE
    return max(1, min(value, MAX_THEIRSTACK_PAGE_SIZE))


async def _cached_page(key: tuple, loader) -> ProviderPage:
    ttl = _cache_ttl()
    now = time.monotonic()
    cached = _page_cache.get(key)
    if cached and cached[0] > now:
        return cached[1]
    if cached:
        _page_cache.pop(key, None)

    task = _in_flight.get(key)
    if task is None:
        task = asyncio.create_task(loader())
        _in_flight[key] = task
    try:
        result = await asyncio.shield(task)
        if result.status == "available" and ttl > 0:
            _bounded_store(_page_cache, key, (time.monotonic() + ttl, result))
        return result
    finally:
        if _in_flight.get(key) is task and task.done():
            _in_flight.pop(key, None)


def _safe_text(value, fallback="") -> str:
    return value.strip() if isinstance(value, str) else fallback


def _safe_external_url(value, *, require_https: bool = False) -> str:
    text = _safe_text(value)
    try:
        parsed = urlsplit(text)
        allowed = {"https"} if require_https else {"http", "https"}
        if parsed.scheme.lower() not in allowed or not parsed.hostname or parsed.username or parsed.password:
            return ""
        return text
    except ValueError:
        return ""


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return value if math.isfinite(value) else None
    except OverflowError:
        return None


def _format_number(value):
    number = _number(value)
    return f"{number:,.0f}" if number is not None else ""


def _stable_id(provider: str, source_id, url: str, title: str, company: str, location: str, created: str, index: int) -> str:
    if source_id is not None and str(source_id).strip():
        raw_id = str(source_id).strip()
    elif url:
        raw_id = url
    else:
        raw_id = "|".join((title.casefold(), company.casefold(), location.casefold(), created, str(index)))
    return f"{provider.lower()}:{raw_id}" if provider == "TheirStack" else raw_id


def _normalize_adzuna_job(item: dict, page: int, index: int) -> dict:
    company_data = item.get("company") if isinstance(item.get("company"), dict) else {}
    location_data = item.get("location") if isinstance(item.get("location"), dict) else {}
    category_data = item.get("category") if isinstance(item.get("category"), dict) else {}
    title = _safe_text(item.get("title"), "Untitled job")
    url = _safe_external_url(item.get("redirect_url"))
    company = _safe_text(company_data.get("display_name"))
    location = _safe_text(location_data.get("display_name"))
    created = _safe_text(item.get("created"))
    provider_id = item.get("id")
    salary_min = _number(item.get("salary_min"))
    salary_max = _number(item.get("salary_max"))
    if salary_min is not None and salary_max is not None:
        salary = f"{_format_number(salary_min)} - {_format_number(salary_max)} per year"
    elif salary_min is not None:
        salary = f"From {_format_number(salary_min)} per year"
    elif salary_max is not None:
        salary = f"Up to {_format_number(salary_max)} per year"
    else:
        salary = ""
    contract_time = _safe_text(item.get("contract_time"))
    contract_type = _safe_text(item.get("contract_type"))
    job_type = (contract_time or contract_type).replace("_", " ").strip().title()
    return {
        "id": _stable_id("Adzuna", provider_id, url, title, company, location, created, index),
        "title": title,
        "company": company or "Not specified",
        "location": location or "Not specified",
        "description": _safe_text(item.get("description")),
        "url": url,
        "source": "Adzuna",
        "original_provider": "Adzuna",
        "provider_job_id": str(provider_id) if provider_id is not None else "",
        "created": created,
        "type": job_type,
        "experience": "",
        "salary": salary,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_currency": "",
        "workplace_type": "",
        "skills": [],
        "company_logo": "",
        "category": _safe_text(category_data.get("label")),
    }


def _normalize_theirstack_job(item: dict, index: int) -> dict:
    company_object = item.get("company_object") if isinstance(item.get("company_object"), dict) else {}
    title = _safe_text(item.get("job_title")) or _safe_text(item.get("title"), "Untitled job")
    company = _safe_text(item.get("company")) or _safe_text(company_object.get("name"))
    location = _safe_text(item.get("long_location")) or _safe_text(item.get("location")) or _safe_text(item.get("short_location"))
    created = _safe_text(item.get("date_posted"))
    url = _safe_external_url(item.get("final_url")) or _safe_external_url(item.get("url")) or _safe_external_url(item.get("source_url"))
    provider_id = item.get("id")
    salary_min = _number(item.get("min_annual_salary"))
    salary_max = _number(item.get("max_annual_salary"))
    salary_currency = _safe_text(item.get("salary_currency"))
    salary = _safe_text(item.get("salary_string"))
    if not salary and (salary_min is not None or salary_max is not None):
        prefix = f"{salary_currency} " if salary_currency else ""
        if salary_min is not None and salary_max is not None:
            salary = f"{prefix}{_format_number(salary_min)} - {_format_number(salary_max)}"
        elif salary_min is not None:
            salary = f"From {prefix}{_format_number(salary_min)}"
        else:
            salary = f"Up to {prefix}{_format_number(salary_max)}"
        period = _safe_text(item.get("salary_period"))
        if period:
            salary = f"{salary} per {period}"
    employment = item.get("employment_statuses")
    employment_names = [value.replace("_", " ").title() for value in employment if isinstance(value, str)] if isinstance(employment, list) else []
    experience = _safe_text(item.get("seniority")).replace("_", " ").title()
    workplace = "Remote" if item.get("remote") is True else "Hybrid" if item.get("hybrid") is True else "On-site" if item.get("remote") is False and item.get("hybrid") is False else ""
    keywords = item.get("technology_slugs")
    skills = list(dict.fromkeys(value for value in keywords if isinstance(value, str) and value.strip()))[:20] if isinstance(keywords, list) else []
    logo = _safe_external_url(company_object.get("logo"), require_https=True)
    if not logo:
        logo = _safe_external_url(item.get("company_logo"), require_https=True)
    return {
        "id": _stable_id("TheirStack", provider_id, url, title, company, location, created, index),
        "title": title,
        "company": company or "Not specified",
        "location": location or "Not specified",
        "description": _safe_text(item.get("description")),
        "url": url,
        "source": "TheirStack",
        "original_provider": "TheirStack",
        "provider_job_id": str(provider_id) if provider_id is not None else "",
        "created": created,
        "type": ", ".join(employment_names),
        "experience": experience,
        "salary": salary,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_currency": salary_currency,
        "workplace_type": workplace,
        "skills": skills,
        "company_logo": logo,
        "category": "",
    }


def _canonical_url(value: str) -> str:
    if not value:
        return ""
    try:
        parsed = urlsplit(value.strip())
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return ""
        host = parsed.hostname.lower().removeprefix("www.")
        port = parsed.port
        netloc = host if port is None or (parsed.scheme.lower(), port) in {("https", 443), ("http", 80)} else f"{host}:{port}"
        ignored = {"fbclid", "gclid", "ref", "source", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}
        query = urlencode([(key, val) for key, val in parse_qsl(parsed.query, keep_blank_values=True) if key.casefold() not in ignored])
        path = parsed.path.rstrip("/") or "/"
        return urlunsplit((parsed.scheme.lower(), netloc, path, query, ""))
    except (TypeError, ValueError):
        return ""


def _job_identity(job: dict) -> tuple[str, str, str, str]:
    return (
        _canonical_url(job.get("url", "")),
        re.sub(r"\s+", " ", job.get("company", "").casefold()).strip(),
        re.sub(r"\s+", " ", job.get("title", "").casefold()).strip(),
        re.sub(r"\s+", " ", job.get("location", "").casefold()).strip(),
    )


def _is_duplicate(candidate: dict, existing: dict) -> bool:
    candidate_url, candidate_company, candidate_title, candidate_location = _job_identity(candidate)
    existing_url, existing_company, existing_title, existing_location = _job_identity(existing)
    if candidate_url and existing_url:
        return candidate_url == existing_url
    if "not specified" in {candidate_company, existing_company, candidate_location, existing_location}:
        return False
    return bool(candidate_company and candidate_title and candidate_location) and (
        candidate_company == existing_company and candidate_title == existing_title and candidate_location == existing_location
    )


def _sort_jobs(jobs: list[dict]) -> list[dict]:
    def order(job):
        value = job.get("created", "")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except (AttributeError, TypeError, ValueError, OverflowError):
            try:
                return datetime.combine(date.fromisoformat(value[:10]), datetime.min.time(), tzinfo=timezone.utc).timestamp()
            except (TypeError, ValueError):
                return float("-inf")
    return sorted(jobs, key=order, reverse=True)


async def search_adzuna(role: str, location: str, page: int, app_id: str, app_key: str) -> ProviderPage:
    if not app_id or not app_key:
        return ProviderPage([], False, "not_configured")
    key = ("adzuna", _fingerprint(app_id), _fingerprint(app_key), role.casefold(), location.casefold(), page)

    async def load():
        url = f"https://api.adzuna.com/v1/api/jobs/in/search/{page}"
        params = {"app_id": app_id, "app_key": app_key, "results_per_page": 20, "what": role, "where": location, "content-type": "application/json"}
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(PROVIDER_TIMEOUT_SECONDS, connect=4.0)) as client:
                response = await client.get(url, params=params)
        except httpx.TimeoutException:
            return ProviderPage([], False, "timeout")
        except httpx.RequestError:
            return ProviderPage([], False, "unavailable")
        latency = round((time.perf_counter() - started) * 1000)
        if response.status_code == 429:
            return ProviderPage([], False, "rate_limited", latency_ms=latency)
        if response.status_code in (401, 403):
            return ProviderPage([], False, "unauthorized", latency_ms=latency)
        if response.status_code != 200:
            return ProviderPage([], False, "unavailable", latency_ms=latency)
        try:
            data = response.json()
        except (ValueError, TypeError):
            return ProviderPage([], False, "invalid_response", latency_ms=latency)
        if not isinstance(data, dict) or not isinstance(data.get("results"), list):
            return ProviderPage([], False, "invalid_response", latency_ms=latency)
        results = data["results"]
        total = data.get("count")
        if total is not None and (isinstance(total, bool) or not isinstance(total, int) or total < 0):
            return ProviderPage([], False, "invalid_response", latency_ms=latency)
        if any(not isinstance(item, dict) for item in results):
            return ProviderPage([], False, "invalid_response", latency_ms=latency)
        jobs = [_normalize_adzuna_job(item, page, index) for index, item in enumerate(results)]
        has_more = page < 10 and (page * 20 < total if total is not None else len(results) >= 20)
        return ProviderPage(jobs, has_more, "available", total_count=total, latency_ms=latency)

    return await _cached_page(key, load)


async def search_theirstack(role: str, location: str, page: int, api_key: str) -> ProviderPage:
    if not api_key:
        return ProviderPage([], False, "not_configured")
    page_size = theirstack_page_size()
    key = ("theirstack", _fingerprint(api_key), role.casefold(), location.casefold(), page, page_size)

    async def load():
        location_id = await _theirstack_location_id(location, api_key)
        if location_id is None:
            return ProviderPage([], False, "location_unavailable")
        payload = {
            "job_title_or": [role],
            "job_location_or": [{"id": location_id}],
            "posted_at_max_age_days": THEIRSTACK_MAX_POST_AGE_DAYS,
            "include_total_results": False,
            "limit": page_size,
            "page": page - 1,
        }
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(PROVIDER_TIMEOUT_SECONDS, connect=4.0)) as client:
                response = await client.post(THEIRSTACK_URL, json=payload, headers={"Authorization": f"Bearer {api_key}"})
        except httpx.TimeoutException:
            return ProviderPage([], False, "timeout")
        except httpx.RequestError:
            return ProviderPage([], False, "unavailable")
        latency = round((time.perf_counter() - started) * 1000)
        if response.status_code == 429:
            return ProviderPage([], False, "rate_limited", latency_ms=latency)
        if response.status_code == 402:
            return ProviderPage([], False, "credits_exhausted", latency_ms=latency)
        if response.status_code in (401, 403):
            return ProviderPage([], False, "unauthorized", latency_ms=latency)
        if response.status_code != 200:
            return ProviderPage([], False, "unavailable", latency_ms=latency)
        try:
            data = response.json()
        except (ValueError, TypeError):
            return ProviderPage([], False, "invalid_response", latency_ms=latency)
        if not isinstance(data, dict) or not isinstance(data.get("data"), list) or not isinstance(data.get("metadata"), dict):
            return ProviderPage([], False, "invalid_response", latency_ms=latency)
        if any(not isinstance(item, dict) for item in data["data"]):
            return ProviderPage([], False, "invalid_response", latency_ms=latency)
        jobs = [_normalize_theirstack_job(item, index) for index, item in enumerate(data["data"])]
        return ProviderPage(jobs, len(jobs) == page_size and page < 10, "available", latency_ms=latency)

    return await _cached_page(key, load)


def merge_provider_pages(adzuna: ProviderPage, theirstack: ProviderPage) -> list[dict]:
    merged = []
    seen_ids = set()
    for job in (*adzuna.jobs, *theirstack.jobs):
        if job["id"] in seen_ids or any(_is_duplicate(job, previous) for previous in merged):
            continue
        seen_ids.add(job["id"])
        merged.append(job)
    return _sort_jobs(merged)


def safe_status_message(provider: str, status: str, other_provider: str) -> str:
    if status == "available":
        return ""
    if status == "not_configured":
        return f"{provider} is not configured; showing available {other_provider} results." if other_provider else f"{provider} is not configured."
    if status == "rate_limited":
        return f"{provider} is rate limited; showing available {other_provider} results." if other_provider else f"{provider} is rate limited."
    if status == "credits_exhausted":
        return f"{provider} has no available API credits; showing available {other_provider} results." if other_provider else f"{provider} has no available API credits."
    if status == "unauthorized":
        return f"{provider} rejected its server credentials; showing available {other_provider} results." if other_provider else f"{provider} rejected its server credentials."
    if status == "timeout":
        return f"{provider} timed out; showing available {other_provider} results." if other_provider else f"{provider} timed out."
    if status == "location_unavailable":
        return f"{provider} could not resolve that location; showing available {other_provider} results." if other_provider else f"{provider} could not resolve that location."
    if status == "invalid_response":
        return f"{provider} returned an invalid response; showing available {other_provider} results." if other_provider else f"{provider} returned an invalid response."
    return f"{provider} is temporarily unavailable; showing available {other_provider} results." if other_provider else f"{provider} is temporarily unavailable."
