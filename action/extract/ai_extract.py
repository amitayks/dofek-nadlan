import os
import json
import base64
import anthropic
from typing import Any


def extract_data_from_images(
    image_paths: list[str],
    extraction_schema: dict[str, Any],
    expected_content: str,
) -> dict[str, Any]:
    """Send PDF page images to AI vision model for data extraction.

    Returns dict with 'data' (list of records) and 'confidence' (float).
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHRIPIC_API_KEY"])

    # Build content with images
    content: list[dict[str, Any]] = []
    for path in image_paths:
        with open(path, "rb") as f:
            img_data = base64.standard_b64encode(f.read()).decode("utf-8")
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": img_data,
            },
        })

    # Build the extraction prompt
    schema_type = extraction_schema.get("type", "unknown")
    fields = extraction_schema.get("fields", [])

    prompt = f"""Analyze these images from an Israeli government statistical publication.
The expected content is: {expected_content}

Extract ALL data from the tables/text in the images and return it as a JSON array.

Each record in the array MUST have these fields: {json.dumps(fields)}

Schema type: {schema_type}

Rules:
- Return ONLY valid JSON, no markdown or commentary
- Extract ALL rows/entries visible in the images
- For Hebrew text, preserve the original Hebrew characters
- Numbers should be parsed as numeric values (not strings)
- If a value is missing or unclear, use null
- Dates/periods should be preserved as shown in the source

Return format: {{"data": [...records...], "confidence": 0.0-1.0}}
Where confidence reflects your certainty about the extraction accuracy."""

    content.append({"type": "text", "text": prompt})

    # Call Claude
    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=8192,
        messages=[{"role": "user", "content": content}],
    )

    # Parse response
    response_text = response.content[0].text.strip()

    # Try to parse JSON directly
    try:
        result = json.loads(response_text)
        if "data" in result:
            return result
        # If the response is a raw array
        if isinstance(result, list):
            return {"data": result, "confidence": 0.8}
    except json.JSONDecodeError:
        pass

    # Try to extract JSON from markdown code blocks
    if "```json" in response_text:
        json_str = response_text.split("```json")[1].split("```")[0].strip()
        try:
            result = json.loads(json_str)
            if "data" in result:
                return result
            if isinstance(result, list):
                return {"data": result, "confidence": 0.8}
        except json.JSONDecodeError:
            pass

    # Retry with more explicit prompt
    print("First extraction attempt returned invalid JSON, retrying...")
    retry_content = content[:-1]  # Keep images
    retry_content.append({
        "type": "text",
        "text": f"""The previous extraction failed to return valid JSON.

Please extract the data from these images and return ONLY a JSON object.
No explanations, no markdown formatting, just the JSON object.

Required format:
{{"data": [list of objects with fields {json.dumps(fields)}], "confidence": 0.0-1.0}}

Return ONLY the JSON object, nothing else.""",
    })

    retry_response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=8192,
        messages=[{"role": "user", "content": retry_content}],
    )

    retry_text = retry_response.content[0].text.strip()
    try:
        result = json.loads(retry_text)
        if "data" in result:
            return result
        if isinstance(result, list):
            return {"data": result, "confidence": 0.7}
    except json.JSONDecodeError:
        # Return failure
        return {
            "data": [],
            "confidence": 0.0,
            "error": f"Failed to parse AI response as JSON after 2 attempts",
            "raw_response": retry_text[:2000],
        }

    return {"data": [], "confidence": 0.0}
