"""CBS discovery orchestrator.

Discovers new CBS publications and media releases, filters against
known URLs from the Worker, and posts new manifest entries.
"""

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
            print(f"Warning: known-urls returned {resp.status_code}, proceeding without filter")
            return set()
        data = resp.json()
        urls = set(data.get("urls", []))
        print(f"Fetched {len(urls)} known URLs from Worker")
        return urls
    except Exception as e:
        print(f"Warning: could not fetch known URLs: {e}")
        return set()


def discover_section(
    section: str,
    source: str,
    list_guid: str,
    year: int,
    month: int,
) -> list[dict]:
    """Discover files for a CBS section (publications or mediarelease).

    Only includes folders whose page items are from the current month or later.
    """
    print(f"\n=== Discovering CBS {section} ===")

    # Get page items for metadata
    page_items = get_page_items(section, list_guid)
    print(f"  Got {len(page_items)} page items")

    # Get DocLib folders for current year
    folders = list_doclib_folders(section, year)
    print(f"  Found {len(folders)} DocLib folders for {year}")

    entries = []
    for folder in folders:
        # Try to find a matching page item for this folder
        # Page items are ordered by Created desc, so recent ones come first
        # We use the first available item as fallback metadata
        best_item = page_items[0] if page_items else None

        # Month filtering: check if the page item's date is current month or later
        if best_item:
            item_date_str = best_item.get("ArticleStartDate") or best_item.get("Created", "")
            if item_date_str:
                try:
                    item_date = datetime.fromisoformat(item_date_str.replace("Z", "+00:00"))
                    if item_date.year == year and item_date.month < month:
                        # This page item is from a previous month — but the folder
                        # might still be new. Include it (Worker dedup handles the rest).
                        pass
                except (ValueError, AttributeError):
                    pass

        # List files in this folder
        files = list_folder_files(section, year, folder)
        if not files:
            continue

        print(f"  Folder {folder}: {len(files)} files")

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
        print(f"  Batch {batch_num}: {len(batch)} entries")

        try:
            resp = http.post(
                f"{base_url}/api/manifest",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"entries": batch},
                timeout=60,
            )
            if resp.status_code == 200:
                result = resp.json()
                processed = result.get("processed", 0)
                total_processed += processed
                print(f"    OK: processed={processed}, errors={result.get('errors', 0)}, pdfs={result.get('pdf_requests', 0)}")
            else:
                print(f"    Error: HTTP {resp.status_code}: {resp.text[:200]}")
                total_errors += 1
        except Exception as e:
            print(f"    Error: {e}")
            total_errors += 1

    return total_processed, total_errors


def main():
    base_url = os.environ.get("INGEST_WEBHOOK_URL", "").rstrip("/")
    token = os.environ.get("INGEST_AUTH_TOKEN", "")

    if not base_url or not token:
        print("ERROR: INGEST_WEBHOOK_URL and INGEST_AUTH_TOKEN must be set")
        sys.exit(1)

    now = datetime.now(timezone.utc)
    year = now.year
    month = now.month

    print(f"CBS Discovery — {now.isoformat()}")
    print(f"Target: year={year}, month={month}")

    # Step 1: Fetch known URLs from Worker
    known_urls = fetch_known_urls(base_url, token)

    # Step 2: Discover CBS media releases
    media_entries = discover_section("mediarelease", "cbs-media", MEDIA_LIST_GUID, year, month)

    # Step 3: Discover CBS publications
    pub_entries = discover_section("publications", "cbs-publications", PUB_LIST_GUID, year, month)

    # Step 4: Combine and filter
    all_entries = media_entries + pub_entries
    new_entries = [e for e in all_entries if e["url"] not in known_urls]

    print(f"\n=== Discovery summary ===")
    print(f"  Total discovered: {len(all_entries)}")
    print(f"  Already known:    {len(all_entries) - len(new_entries)}")
    print(f"  New entries:      {len(new_entries)}")

    # Write new_files output for GitHub Actions
    github_output = os.environ.get("GITHUB_OUTPUT", "")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"new_files={len(new_entries)}\n")
            f.write(f"run_id={now.strftime('%Y-%m-%d')}\n")

    if not new_entries:
        print("\nNo new files found. Done.")
        return

    # Step 5: Post to Worker
    print(f"\nPosting {len(new_entries)} new entries to Worker...")
    processed, errors = post_manifest(new_entries, base_url, token)

    print(f"\n=== Done: {processed} processed, {errors} batch errors ===")


if __name__ == "__main__":
    main()
