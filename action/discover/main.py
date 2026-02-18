"""CBS discovery orchestrator.

Discovers new CBS publications and media releases, filters against
known URLs from the Worker, and posts new manifest entries.
"""

from __future__ import annotations

import os
import sys
import json
from datetime import datetime, timezone

import requests as http

from .cbs_client import (
    list_doclib_folders,
    list_folder_files,
    get_page_items,
    build_manifest_entry,
    PUB_LIST_GUID,
    MEDIA_LIST_GUID,
)


def log(msg: str) -> None:
    print(msg, flush=True)


def fetch_known_urls(base_url: str, token: str) -> set[str]:
    """Fetch known file URLs from the Worker."""
    url = f"{base_url}/api/known-urls?source=cbs-publications&source=cbs-media"
    try:
        resp = http.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        if resp.status_code != 200:
            log(f"Warning: known-urls returned {resp.status_code}, proceeding without filter")
            return set()
        data = resp.json()
        urls = set(data.get("urls", []))
        log(f"Fetched {len(urls)} known URLs from Worker")
        return urls
    except Exception as e:
        log(f"Warning: could not fetch known URLs: {e}")
        return set()


def discover_section(
    section: str,
    source: str,
    list_guid: str,
    year: int,
    month: int,
) -> list[dict]:
    """Discover files for a CBS section (publications or mediarelease)."""
    log(f"\n=== Discovering CBS {section} ===")

    # Get page items for metadata
    page_items = get_page_items(section, list_guid)
    log(f"  Got {len(page_items)} page items")

    # Get DocLib folders for current year
    folders = list_doclib_folders(section, year)
    log(f"  Found {len(folders)} DocLib folders for {year}")

    entries = []
    for folder in folders:
        # Use the first page item as fallback metadata
        best_item = page_items[0] if page_items else None

        # List files in this folder
        files = list_folder_files(section, year, folder)
        if not files:
            continue

        log(f"  Folder {folder}: {len(files)} files")

        for file_info in files:
            entry = build_manifest_entry(source, section, year, folder, file_info, best_item)
            entries.append(entry)

    return entries


def post_manifest(entries: list[dict], base_url: str, token: str) -> tuple[int, int]:
    """Post manifest entries to Worker in batches. Returns (processed, errors)."""
    batch_size = 10
    total_processed = 0
    total_errors = 0

    for i in range(0, len(entries), batch_size):
        batch = entries[i : i + batch_size]
        batch_num = i // batch_size + 1
        log(f"  Batch {batch_num}: {len(batch)} entries")

        try:
            resp = http.post(
                f"{base_url}/api/manifest",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"entries": batch},
                timeout=180,
            )
            if resp.status_code == 200:
                result = resp.json()
                processed = result.get("processed", 0)
                total_processed += processed
                log(f"    OK: processed={processed}, errors={result.get('errors', 0)}, pdfs={result.get('pdf_requests', 0)}")
            else:
                log(f"    Error: HTTP {resp.status_code}: {resp.text[:200]}")
                total_errors += 1
        except Exception as e:
            log(f"    Error: {e}")
            total_errors += 1

    return total_processed, total_errors


def main():
    log("=== CBS Discovery Script Starting ===")

    base_url = os.environ.get("INGEST_WEBHOOK_URL", "").rstrip("/")
    token = os.environ.get("INGEST_AUTH_TOKEN", "")

    if not base_url or not token:
        log("ERROR: INGEST_WEBHOOK_URL and INGEST_AUTH_TOKEN must be set")
        sys.exit(1)

    now = datetime.now(timezone.utc)
    year = now.year
    month = now.month

    log(f"CBS Discovery — {now.isoformat()}")
    log(f"Target: year={year}, month={month}")

    # Step 1: Fetch known URLs from Worker
    known_urls = fetch_known_urls(base_url, token)

    # Step 2: Discover CBS media releases
    media_entries = discover_section("mediarelease", "cbs-media", MEDIA_LIST_GUID, year, month)

    # Step 3: Discover CBS publications
    pub_entries = discover_section("publications", "cbs-publications", PUB_LIST_GUID, year, month)

    # Step 4: Combine and filter
    all_entries = media_entries + pub_entries
    new_entries = [e for e in all_entries if e["url"] not in known_urls]

    log(f"\n=== Discovery summary ===")
    log(f"  Total discovered: {len(all_entries)}")
    log(f"  Already known:    {len(all_entries) - len(new_entries)}")
    log(f"  New entries:      {len(new_entries)}")

    # Write new_files output for GitHub Actions
    github_output = os.environ.get("GITHUB_OUTPUT", "")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"new_files={len(new_entries)}\n")
            f.write(f"run_id={now.strftime('%Y-%m-%d')}\n")

    if not new_entries:
        log("\nNo new files found. Done.")
        return

    # Step 5: Post to Worker
    log(f"\nPosting {len(new_entries)} new entries to Worker...")
    processed, errors = post_manifest(new_entries, base_url, token)

    log(f"\n=== Done: {processed} processed, {errors} batch errors ===")


if __name__ == "__main__":
    main()
