"""Tests for PDF extraction pipeline components.

Tests the validate module and AI extraction prompt construction.
PDF-to-image conversion tests require PyMuPDF or pdf2image + poppler.
"""

import json
import os
import tempfile
from unittest.mock import patch, MagicMock

import pytest


def test_ai_extract_prompt_construction():
    """Verify the AI extraction prompt includes schema fields and content type."""
    from extract.ai_extract import extract_data_from_images

    schema = {
        "type": "housing_price_index",
        "fields": ["period", "index_value", "base_year"],
    }
    expected_content = "Housing Price Index (national)"

    # Mock the Anthropic client
    mock_response = MagicMock()
    mock_response.content = [
        MagicMock(
            text=json.dumps({
                "data": [{"period": "2025-01", "index_value": 150.5, "base_year": 2020}],
                "confidence": 0.95,
            })
        )
    ]

    with patch.dict(os.environ, {"ANTHRIPIC_API_KEY": "test-key"}):
        with patch("extract.ai_extract.anthropic.Anthropic") as mock_anthropic:
            mock_client = MagicMock()
            mock_client.messages.create.return_value = mock_response
            mock_anthropic.return_value = mock_client

            # Create a minimal test image
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
                img_path = f.name

            try:
                result = extract_data_from_images([img_path], schema, expected_content)

                # Check result
                assert "data" in result
                assert len(result["data"]) == 1
                assert result["confidence"] == 0.95

                # Verify the prompt was constructed with the right fields
                call_args = mock_client.messages.create.call_args
                messages = call_args.kwargs["messages"]
                content = messages[0]["content"]

                # Find the text content block
                text_blocks = [c for c in content if c["type"] == "text"]
                assert len(text_blocks) == 1
                prompt_text = text_blocks[0]["text"]

                assert "Housing Price Index (national)" in prompt_text
                assert "period" in prompt_text
                assert "index_value" in prompt_text
                assert "housing_price_index" in prompt_text
            finally:
                os.unlink(img_path)


def test_ai_extract_retry_on_invalid_json():
    """Verify retry logic when first response isn't valid JSON."""
    from extract.ai_extract import extract_data_from_images

    schema = {"type": "test", "fields": ["value"]}

    # First response is invalid, second is valid
    mock_response_bad = MagicMock()
    mock_response_bad.content = [MagicMock(text="Not valid JSON here")]

    mock_response_good = MagicMock()
    mock_response_good.content = [
        MagicMock(text=json.dumps({"data": [{"value": 42}], "confidence": 0.8}))
    ]

    with patch.dict(os.environ, {"ANTHRIPIC_API_KEY": "test-key"}):
        with patch("extract.ai_extract.anthropic.Anthropic") as mock_anthropic:
            mock_client = MagicMock()
            mock_client.messages.create.side_effect = [mock_response_bad, mock_response_good]
            mock_anthropic.return_value = mock_client

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
                img_path = f.name

            try:
                result = extract_data_from_images([img_path], schema, "test data")

                assert len(result["data"]) == 1
                assert result["data"][0]["value"] == 42
                # Should have been called twice (first attempt + retry)
                assert mock_client.messages.create.call_count == 2
            finally:
                os.unlink(img_path)


def test_ai_extract_json_in_markdown():
    """Verify extraction of JSON from markdown code blocks."""
    from extract.ai_extract import extract_data_from_images

    schema = {"type": "test", "fields": ["value"]}

    mock_response = MagicMock()
    mock_response.content = [
        MagicMock(
            text='Here is the data:\n```json\n{"data": [{"value": 99}], "confidence": 0.9}\n```'
        )
    ]

    with patch.dict(os.environ, {"ANTHRIPIC_API_KEY": "test-key"}):
        with patch("extract.ai_extract.anthropic.Anthropic") as mock_anthropic:
            mock_client = MagicMock()
            mock_client.messages.create.return_value = mock_response
            mock_anthropic.return_value = mock_client

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
                img_path = f.name

            try:
                result = extract_data_from_images([img_path], schema, "test data")
                assert len(result["data"]) == 1
                assert result["data"][0]["value"] == 99
            finally:
                os.unlink(img_path)


def test_pdf_to_images_no_library():
    """Verify proper error when no PDF library is available."""
    from extract import pdf_to_images as module

    # Temporarily disable both libraries
    orig_pymupdf = module.HAS_PYMUPDF
    orig_pdf2image = module.HAS_PDF2IMAGE
    module.HAS_PYMUPDF = False
    module.HAS_PDF2IMAGE = False

    try:
        with pytest.raises(RuntimeError, match="No PDF library available"):
            module.pdf_to_images("/nonexistent.pdf")
    finally:
        module.HAS_PYMUPDF = orig_pymupdf
        module.HAS_PDF2IMAGE = orig_pdf2image
