"""Tests for LegacyGoldDataSource."""

from __future__ import annotations

import pytest

from app.services.legacy_data_source import LegacyGoldDataSource


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_list_surveys():
    """Test that list_surveys returns surveys in legacy format."""
    data_source = LegacyGoldDataSource()
    surveys = data_source.list_surveys({})
    assert isinstance(surveys, list)
    for survey in surveys:
        assert "survey_id" in survey
        assert survey["survey_id"].startswith("legacy:")
        assert len(survey["survey_id"].split(":")) == 3


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_list_bands():
    """Test that list_bands returns bands for a survey."""
    data_source = LegacyGoldDataSource()
    survey_id = "legacy:Lask:2025-01"
    bands = data_source.list_bands(survey_id)
    assert isinstance(bands, list)
    for band in bands:
        assert "band_id" in band
        assert "survey_id" in band
        assert band["survey_id"] == survey_id


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_holds_response_shape():
    """Test that get_holds returns normalized format matching frontend expectations."""
    data_source = LegacyGoldDataSource()
    survey_id = "legacy:Lask:2025-01"
    band_id = "0"
    result = data_source.get_holds(survey_id, band_id, max_points=None)

    # Check required fields
    assert "freqs" in result
    assert "max_hold" in result
    assert "min_hold" in result
    assert "avg_hold" in result
    assert "metadata" in result
    assert "source_mode" in result

    # Check source_mode
    assert result["source_mode"] == "legacy"

    # Check that arrays have matching lengths
    assert len(result["freqs"]) == len(result["max_hold"])
    assert len(result["freqs"]) == len(result["min_hold"])
    assert len(result["freqs"]) == len(result["avg_hold"])

    # Check metadata structure
    metadata = result["metadata"]
    assert "band_index" in metadata
    assert "n_traces" in metadata or metadata.get("n_traces") is None


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_holds_downsampling():
    """Test that downsampling works when max_points is provided."""
    data_source = LegacyGoldDataSource()
    survey_id = "legacy:Lask:2025-01"
    band_id = "0"
    result = data_source.get_holds(survey_id, band_id, max_points=100)

    # Check that arrays are downsampled (should be <= 100 points)
    assert len(result["freqs"]) <= 100
    assert len(result["max_hold"]) <= 100
    assert len(result["min_hold"]) <= 100
    assert len(result["avg_hold"]) <= 100

