"""CBS SharePoint REST API client for discovering publications and media releases."""

from __future__ import annotations

import requests
from typing import Any, Optional

CBS_BASE = "https://www.cbs.gov.il"
PUB_LIST_GUID = "71b30cd4-0261-4757-9482-a52c5a6da90a"
MEDIA_LIST_GUID = "db8f0177-370a-46ec-9ab9-041b54247975"

SP_HEADERS = {
    "Accept": "application/json;odata=nometadata",
    "X-Requested-With": "XMLHttpRequest",
}

ALLOWED_EXTENSIONS = {"xlsx", "xls", "docx", "doc", "pdf", "zip"}


def _parse_sp_response(resp: requests.Response, label: str) -> dict | None:
    """Parse SharePoint API response, handling various content-types."""
    if resp.status_code != 200:
        print(f"  Warning: {label} returned HTTP {resp.status_code}", flush=True)
        return None
    # Reject HTML responses (CBS WAF block)
    ct = resp.headers.get("content-type", "")
    if "html" in ct:
        print(f"  Warning: {label} returned HTML (blocked?)", flush=True)
        return None
    # Try to parse JSON regardless of content-type header
    try:
        return resp.json()
    except Exception:
        print(f"  Warning: {label} returned non-JSON (content-type: {ct})", flush=True)
        return None


def list_doclib_folders(section: str, year: int) -> list[str]:
    """List DocLib subfolder names for a section+year."""
    url = (
        f"{CBS_BASE}/he/{section}/Madad/_api/web/"
        f"GetFolderByServerRelativeUrl('/he/{section}/Madad/DocLib/{year}')/Folders"
    )
    try:
        resp = requests.get(url, headers=SP_HEADERS, timeout=30)
        data = _parse_sp_response(resp, f"DocLib folders {section}/{year}")
        if not data:
            return []
        return [item["Name"] for item in data.get("value", [])]
    except Exception as e:
        print(f"  Error listing DocLib folders for {section}/{year}: {e}", flush=True)
        return []


def list_folder_files(section: str, year: int, folder: str) -> list[dict[str, Any]]:
    """List files in a DocLib subfolder."""
    url = (
        f"{CBS_BASE}/he/{section}/Madad/_api/web/"
        f"GetFolderByServerRelativeUrl('/he/{section}/Madad/DocLib/{year}/{folder}')/Files"
    )
    try:
        resp = requests.get(url, headers=SP_HEADERS, timeout=30)
        data = _parse_sp_response(resp, f"files {section}/{year}/{folder}")
        if not data:
            return []
        files = []
        for f in data.get("value", []):
            ext = f["Name"].rsplit(".", 1)[-1].lower() if "." in f["Name"] else ""
            if ext in ALLOWED_EXTENSIONS:
                files.append({
                    "name": f["Name"],
                    "server_url": f["ServerRelativeUrl"],
                    "size": int(f.get("Length", 0)),
                    "ext": ext,
                })
        return files
    except Exception as e:
        print(f"  Error listing files in {section}/{year}/{folder}: {e}", flush=True)
        return []


def get_page_items(section: str, list_guid: str, top: int = 20) -> list[dict[str, Any]]:
    """Get page items from a CBS SharePoint list for title/date metadata."""
    url = (
        f"{CBS_BASE}/he/{section}/Madad/_api/Web/Lists(guid'{list_guid}')/items"
        f"?$orderby=Created%20desc&$top={top}"
        f"&$select=Id,Title,CbsEnglishTitle,ArticleStartDate,Created,FileRef"
    )
    try:
        resp = requests.get(url, headers=SP_HEADERS, timeout=30)
        data = _parse_sp_response(resp, f"page items {section}")
        if not data:
            return []
        items = data.get("value", [])
        print(f"  Page items content-type: {resp.headers.get('content-type', 'N/A')}, items: {len(items)}", flush=True)
        return items
    except Exception as e:
        print(f"  Error getting page items for {section}: {e}", flush=True)
        return []


def build_manifest_entry(
    source: str,
    section: str,
    year: int,
    folder: str,
    file_info: dict[str, Any],
    page_item: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """Build a manifest entry dict from file info and page metadata."""
    if source == "cbs-publications":
        pub_id = f"cbs-pub-{year}-{folder}"
    else:
        pub_id = f"cbs-media-{year}-{folder}"

    title = ""
    title_en = ""
    pub_date = ""
    if page_item:
        title = page_item.get("Title", f"CBS {section} {folder}")
        title_en = page_item.get("CbsEnglishTitle", "")
        pub_date = page_item.get("ArticleStartDate") or page_item.get("Created", "")

    return {
        "source": source,
        "url": f"{CBS_BASE}{file_info['server_url']}",
        "filename": file_info["name"],
        "format": file_info["ext"],
        "publication_id": pub_id,
        "publish_date": pub_date,
        "metadata": {
            "title": title,
            "title_en": title_en,
            "year": str(year),
            "folder": folder,
            "size": file_info["size"],
        },
        "is_new": True,
    }
