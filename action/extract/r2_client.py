import os
import json
import boto3
from typing import Any


def _get_client():
    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def _bucket() -> str:
    return os.environ["R2_BUCKET_NAME"]


def list_extraction_requests(run_id: str) -> list[dict[str, Any]]:
    """List all pending extraction requests from R2."""
    client = _get_client()
    prefix = "pipeline/extraction-requests/"

    response = client.list_objects_v2(Bucket=_bucket(), Prefix=prefix)
    requests = []

    for obj in response.get("Contents", []):
        key = obj["Key"]
        if not key.endswith(".json"):
            continue

        body = client.get_object(Bucket=_bucket(), Key=key)["Body"].read()
        data = json.loads(body)

        # Filter by run_id if specified
        if run_id and data.get("run_id") != run_id:
            # Include requests from any run (to catch retries)
            pass

        requests.append(data)

    return requests


def read_request(request_id: str) -> dict[str, Any]:
    """Read a specific extraction request from R2."""
    client = _get_client()
    key = f"pipeline/extraction-requests/{request_id}.json"
    body = client.get_object(Bucket=_bucket(), Key=key)["Body"].read()
    return json.loads(body)


def download_pdf(r2_key: str, local_path: str) -> str:
    """Download a PDF file from R2 to a local path."""
    client = _get_client()
    client.download_file(_bucket(), r2_key, local_path)
    return local_path


def write_result(request_id: str, result: dict[str, Any]) -> None:
    """Write an extraction result to R2."""
    client = _get_client()
    key = f"pipeline/extracted/{request_id}-result.json"
    client.put_object(
        Bucket=_bucket(),
        Key=key,
        Body=json.dumps(result, indent=2, ensure_ascii=False),
        ContentType="application/json",
    )
    print(f"Wrote result to R2: {key}")
