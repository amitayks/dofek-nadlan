from typing import Any


def validate_extraction(
    data: list[dict[str, Any]],
    schema: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate extracted data against the schema.

    Returns (valid_records, errors).
    """
    schema_type = schema.get("type", "")
    fields = schema.get("fields", [])
    valid = []
    errors = []

    for i, record in enumerate(data):
        record_errors = []

        # Check required fields based on schema type
        if schema_type == "housing_price_index":
            if not _has_value(record, "period"):
                record_errors.append(f"Record {i}: missing 'period'")
            if not _has_numeric(record, "index_value"):
                record_errors.append(f"Record {i}: missing or invalid 'index_value'")
            val = record.get("index_value")
            if isinstance(val, (int, float)) and (val < 0 or val > 10000):
                record_errors.append(f"Record {i}: index_value {val} out of range")

        elif schema_type == "avg_apartment_prices":
            if not _has_value(record, "period"):
                record_errors.append(f"Record {i}: missing 'period'")
            if not _has_value(record, "district"):
                record_errors.append(f"Record {i}: missing 'district'")
            if not _has_numeric(record, "avg_price_nis_thousands"):
                record_errors.append(f"Record {i}: missing or invalid 'avg_price_nis_thousands'")
            val = record.get("avg_price_nis_thousands")
            if isinstance(val, (int, float)) and (val < 0 or val > 100000):
                record_errors.append(f"Record {i}: avg_price {val} out of range")

        elif schema_type == "consumer_price_index":
            if not _has_value(record, "period"):
                record_errors.append(f"Record {i}: missing 'period'")
            if not _has_value(record, "index_code"):
                record_errors.append(f"Record {i}: missing 'index_code'")
            if not _has_numeric(record, "index_value"):
                record_errors.append(f"Record {i}: missing or invalid 'index_value'")

        elif schema_type == "review_insights":
            has_content = (
                _has_value(record, "summary")
                or _has_value(record, "extracted_text")
                or _has_value(record, "key_figures")
            )
            if not has_content:
                record_errors.append(f"Record {i}: no content (summary, text, or figures)")

        if record_errors:
            errors.extend(record_errors)
        else:
            valid.append(record)

    return valid, errors


def _has_value(record: dict, field: str) -> bool:
    val = record.get(field)
    return val is not None and val != "" and val != []


def _has_numeric(record: dict, field: str) -> bool:
    val = record.get(field)
    if val is None:
        return False
    try:
        float(val)
        return True
    except (ValueError, TypeError):
        return False
