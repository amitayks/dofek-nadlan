"""Main entry point for PDF extraction matrix job.

Each job processes one extraction request:
1. Read request from R2
2. Download PDF from R2
3. Convert PDF to images
4. Send images to AI for extraction
5. Validate output
6. Write result to R2
"""

import os
import sys
import tempfile
from datetime import datetime, timezone

from .r2_client import read_request, download_pdf, write_result
from .pdf_to_images import pdf_to_images
from .ai_extract import extract_data_from_images
from .validate import validate_extraction


def main():
    request_id = os.environ.get("REQUEST_ID")
    if not request_id:
        print("ERROR: REQUEST_ID environment variable not set")
        sys.exit(1)

    print(f"Processing extraction request: {request_id}")

    try:
        # 1. Read request
        request = read_request(request_id)
        print(f"Request: source={request['source']}, file={request['file']['r2_key']}")

        # 2. Download PDF
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            pdf_path = tmp.name
        download_pdf(request["file"]["r2_key"], pdf_path)
        print(f"Downloaded PDF to {pdf_path}")

        # 3. Convert to images
        image_paths = pdf_to_images(pdf_path)
        print(f"Converted to {len(image_paths)} images")

        # 4. AI extraction
        ai_result = extract_data_from_images(
            image_paths,
            request["extraction_schema"],
            request["file"]["expected_content"],
        )
        raw_data = ai_result.get("data", [])
        confidence = ai_result.get("confidence", 0.0)
        print(f"AI extracted {len(raw_data)} records (confidence: {confidence})")

        # 5. Validate
        valid_data, validation_errors = validate_extraction(
            raw_data, request["extraction_schema"]
        )
        if validation_errors:
            print(f"Validation: {len(valid_data)} valid, {len(validation_errors)} errors")
            for err in validation_errors[:5]:
                print(f"  - {err}")

        # 6. Determine status
        if len(valid_data) == 0 and len(raw_data) > 0:
            status = "extraction_failed"
        elif len(valid_data) < len(raw_data):
            status = "partial"
        elif len(valid_data) > 0:
            status = "success"
        else:
            status = "extraction_failed"

        # Add publication and file references to each record
        for record in valid_data:
            record["publication_id"] = request["publication_id"]
            record["file_id"] = f"{request['publication_id']}:{os.path.basename(request['file']['r2_key'])}"

        # 7. Write result
        result = {
            "request_id": request_id,
            "status": status,
            "data": valid_data,
            "confidence": confidence,
            "extraction_method": "pdf2image+claude_vision",
            "pages_processed": len(image_paths),
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }

        if status == "extraction_failed":
            result["error_details"] = "; ".join(validation_errors[:10])

        write_result(request_id, result)
        print(f"Result written: status={status}, records={len(valid_data)}")

        # Clean up
        os.unlink(pdf_path)
        for p in image_paths:
            os.unlink(p)

    except Exception as e:
        print(f"ERROR: {e}")
        # Write failure result
        write_result(request_id, {
            "request_id": request_id,
            "status": "extraction_failed",
            "data": [],
            "confidence": 0.0,
            "extraction_method": "pdf2image+claude_vision",
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "error_details": str(e),
        })
        sys.exit(1)


if __name__ == "__main__":
    main()
