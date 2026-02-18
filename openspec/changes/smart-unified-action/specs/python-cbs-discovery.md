## Python CBS Discovery Module

### Module Structure
```
action/discover/
  __init__.py
  cbs_client.py    # CBS SharePoint REST API client
  main.py          # Orchestrator: discover → filter → post
```

### cbs_client.py

Constants:
```python
CBS_BASE = "https://www.cbs.gov.il"
PUB_LIST_GUID = "71b30cd4-0261-4757-9482-a52c5a6da90a"
MEDIA_LIST_GUID = "db8f0177-370a-46ec-9ab9-041b54247975"
SP_HEADERS = {
    "Accept": "application/json;odata=nometadata",
    "X-Requested-With": "XMLHttpRequest",
}
ALLOWED_EXTENSIONS = {"xlsx", "xls", "docx", "doc", "pdf", "zip"}
```

Functions:
- `list_doclib_folders(section: str, year: int) -> list[str]` — GET `…/DocLib/{year}/Folders`, return folder names
- `list_folder_files(section: str, year: int, folder: str) -> list[dict]` — GET `…/DocLib/{year}/{folder}/Files`, return file info dicts with Name, ServerRelativeUrl, Length
- `get_page_items(section: str, list_guid: str, top: int = 20) -> list[dict]` — GET list items API, return page items with Title, CbsEnglishTitle, ArticleStartDate, Created
- `build_manifest_entry(source: str, section: str, year: int, folder: str, file_info: dict, page_item: dict | None) -> dict` — Build a ManifestEntry dict from file + metadata

### main.py

Environment variables:
- `INGEST_WEBHOOK_URL` — Worker base URL
- `INGEST_AUTH_TOKEN` — Bearer token for Worker API

Flow:
1. `fetch_known_urls()` — GET `/api/known-urls?source=cbs-publications&source=cbs-media` from Worker
2. `discover_media(year, month)` — Enumerate media DocLib folders, filter by month
3. `discover_publications(year, month)` — Enumerate publications DocLib folders, filter by month
4. Filter out entries whose URL is in known_urls set
5. `post_manifest(entries)` — POST to Worker `/api/manifest` in batches of 10
6. Print summary and exit

### Month Filtering Logic
Get current year and month. When processing DocLib folders:
- Fetch page items (ordered by Created desc, top 20)
- For each DocLib folder, try to match a page item by correlating the folder number with the item's position or date
- Only include folders whose best-match page item has `ArticleStartDate` >= first day of current month
- If no page item can be matched (new folder with no page yet), include it (safe default — the Worker's duplicate detection handles the rest)

### Error Handling
- If CBS API returns non-JSON (HTML block), log warning and skip that section
- If Worker's known-urls endpoint fails, proceed without filtering (all entries treated as new)
- If a batch POST fails, log error and continue with next batch
- Exit code 0 even if some batches fail (partial success is ok)
