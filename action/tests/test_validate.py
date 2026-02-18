"""Tests for the extraction validation module."""

from extract.validate import validate_extraction


def test_housing_price_index_valid():
    data = [
        {"period": "2025-01", "index_value": 150.5, "base_year": 2020},
        {"period": "2025-02", "index_value": 151.2, "base_year": 2020},
    ]
    schema = {"type": "housing_price_index", "fields": ["period", "index_value"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 2
    assert len(errors) == 0


def test_housing_price_index_missing_period():
    data = [{"index_value": 150.5}]
    schema = {"type": "housing_price_index", "fields": ["period", "index_value"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 0
    assert len(errors) == 1
    assert "period" in errors[0]


def test_housing_price_index_out_of_range():
    data = [{"period": "2025-01", "index_value": 15000}]
    schema = {"type": "housing_price_index", "fields": ["period", "index_value"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 0
    assert any("out of range" in e for e in errors)


def test_avg_apartment_prices_valid():
    data = [
        {"period": "2025-01", "district": "Jerusalem", "avg_price_nis_thousands": 2500},
    ]
    schema = {"type": "avg_apartment_prices", "fields": ["period", "district", "avg_price_nis_thousands"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 1
    assert len(errors) == 0


def test_avg_apartment_prices_missing_district():
    data = [{"period": "2025-01", "avg_price_nis_thousands": 2500}]
    schema = {"type": "avg_apartment_prices", "fields": ["period", "district", "avg_price_nis_thousands"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 0
    assert any("district" in e for e in errors)


def test_consumer_price_index_valid():
    data = [
        {"period": "2025-01", "index_code": "110011", "index_value": 108.3},
    ]
    schema = {"type": "consumer_price_index", "fields": ["period", "index_code", "index_value"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 1


def test_consumer_price_index_missing_code():
    data = [{"period": "2025-01", "index_value": 108.3}]
    schema = {"type": "consumer_price_index", "fields": ["period", "index_code", "index_value"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 0


def test_review_insights_with_summary():
    data = [{"summary": "Market shows growth"}]
    schema = {"type": "review_insights", "fields": ["summary"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 1


def test_review_insights_no_content():
    data = [{"topic": "Housing"}]
    schema = {"type": "review_insights", "fields": ["summary", "extracted_text"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 0
    assert any("no content" in e for e in errors)


def test_mixed_valid_and_invalid():
    data = [
        {"period": "2025-01", "index_value": 150.5},
        {"period": "", "index_value": 151.2},  # empty period
        {"period": "2025-03", "index_value": 152.0},
    ]
    schema = {"type": "housing_price_index", "fields": ["period", "index_value"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 2
    assert len(errors) == 1


def test_unknown_schema_type_passes_all():
    data = [{"some_field": "some_value"}]
    schema = {"type": "unknown_type", "fields": ["some_field"]}
    valid, errors = validate_extraction(data, schema)
    assert len(valid) == 1
    assert len(errors) == 0
