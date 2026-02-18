"""Send webhook notification to Worker after all extractions complete."""

import os
import json
import requests
from .r2_client import list_extraction_requests


def send_webhook():
    """Gather results and notify the Worker."""
    webhook_url = os.environ["INGEST_WEBHOOK_URL"]
    auth_token = os.environ["INGEST_AUTH_TOKEN"]
    run_id = os.environ["RUN_ID"]

    # Count results by checking R2 for result files
    # (We can't easily enumerate results from the notify job,
    # so we send the run_id and let the Worker process everything)
    requests_list = list_extraction_requests(run_id)
    total = len(requests_list)

    payload = {
        "event": "extraction_complete",
        "run_id": run_id,
        "results": [r["request_id"] for r in requests_list],
        "stats": {
            "total": total,
            "success": total,  # Approximate; actual results are in R2
            "failed": 0,
        },
    }

    # Retry up to 3 times
    for attempt in range(3):
        try:
            resp = requests.post(
                webhook_url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {auth_token}",
                    "Content-Type": "application/json",
                },
                timeout=30,
            )
            if resp.status_code == 200:
                print(f"Webhook sent successfully: {resp.json()}")
                return
            else:
                print(f"Webhook attempt {attempt + 1} failed: {resp.status_code} {resp.text}")
        except Exception as e:
            print(f"Webhook attempt {attempt + 1} error: {e}")

        if attempt < 2:
            import time
            time.sleep(10)

    print("WARNING: All webhook attempts failed. Worker will pick up results on next cron.")


if __name__ == "__main__":
    send_webhook()
