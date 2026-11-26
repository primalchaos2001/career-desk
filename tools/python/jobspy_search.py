"""Search job boards with JobSpy and print the postings as JSON.

Adapted from JobSpy's scrape_jobs (https://github.com/speedyapply/JobSpy,
jobspy/__init__.py, python-jobspy 1.5.0). MIT License, Copyright (c) 2023
Cullen Watson; see third_party/jobspy/LICENSE. Changes: no pandas (it returns
plain dicts), sites run one after another, and failures are reported per site
instead of stopping the search.

Why no pandas: Windows Application Control can block pandas' compiled files,
and the DataFrame is only a container. Importing jobspy normally runs its
__init__, which imports pandas, so this script registers the package without
running __init__ and uses the scrapers directly.

Input (stdin, JSON): {"search_term": "...", "location": "...",
  "sites": ["linkedin", "indeed", "naukri"], "results_wanted": 20,
  "hours_old": 168, "country_indeed": "india", "fetch_description": true}
Output (stdout, JSON): {"jobs": [...], "errors": [{"site": "...", "error": "..."}]}

Research only: it reads public listings and never applies or signs in.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path


def _load_jobspy_without_pandas() -> None:
    spec = importlib.util.find_spec("jobspy")
    if spec is None or not spec.submodule_search_locations:
        raise SystemExit(json.dumps({"error": "JobSpy is not installed (pip install python-jobspy)"}))
    package = types.ModuleType("jobspy")
    package.__path__ = list(spec.submodule_search_locations)
    sys.modules["jobspy"] = package


SITES = {
    "linkedin": ("jobspy.linkedin", "LinkedIn"),
    "indeed": ("jobspy.indeed", "Indeed"),
    "naukri": ("jobspy.naukri", "Naukri"),
    "glassdoor": ("jobspy.glassdoor", "Glassdoor"),
    "google": ("jobspy.google", "Google"),
    "zip_recruiter": ("jobspy.ziprecruiter", "ZipRecruiter"),
    "bayt": ("jobspy.bayt", "Bayt"),
    "seek": ("jobspy.seek", "Seek"),
}


def _plain(value: object) -> object:
    """Pydantic dump with enums and dates turned into JSON values."""
    if hasattr(value, "value"):
        return getattr(value, "value")
    if hasattr(value, "isoformat"):
        return value.isoformat()  # type: ignore[union-attr]
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def main() -> None:
    args = json.loads(sys.stdin.read() or "{}")
    _load_jobspy_without_pandas()
    from importlib import import_module

    from jobspy.model import ScraperInput

    sites = [s for s in args.get("sites") or ["linkedin", "indeed", "naukri"] if s in SITES]
    errors: list[dict[str, str]] = []
    jobs: list[dict[str, object]] = []
    base = {
        "search_term": args.get("search_term") or None,
        "location": args.get("location") or None,
        "results_wanted": max(1, min(int(args.get("results_wanted") or 20), 100)),
        "hours_old": args.get("hours_old") or None,
        "country_indeed": args.get("country_indeed") or "india",
        "fetch_description": bool(args.get("fetch_description", True)),
        "is_remote": bool(args.get("is_remote", False)),
        "verbose": 0,
    }
    for site in sites:
        module, cls = SITES[site]
        try:
            scraper_input = ScraperInput.model_validate(
                {**{k: v for k, v in base.items() if v is not None}, "site_name": [site]}
            )
            scraper = getattr(import_module(module), cls)()
            for post in scraper.scrape(scraper_input):
                row = _plain(post.model_dump())
                assert isinstance(row, dict)
                location = row.get("location") or {}
                row["location"] = ", ".join(
                    str(location.get(k)) for k in ("city", "state", "country") if location.get(k)
                ) if isinstance(location, dict) else str(location)
                row["site"] = site
                jobs.append(row)
        except Exception as e:  # one failing board must not lose the others
            errors.append({"site": site, "error": f"{type(e).__name__}: {e}"[:300]})
    json.dump({"jobs": jobs, "errors": errors}, sys.stdout, default=str)


if __name__ == "__main__":
    sys.path = [p for p in sys.path if Path(p).resolve() != Path(__file__).resolve().parent]
    main()
