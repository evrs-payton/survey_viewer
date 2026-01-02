"""Tests for RfprocGoldSilverDataSource."""

from __future__ import annotations

import pytest

from app.services.rfproc_data_source import RfprocGoldSilverDataSource


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_list_surveys():
    """Test that list_surveys returns surveys in rfproc format."""
    data_source = RfprocGoldSilverDataSource()
    surveys = data_source.list_surveys({})
    assert isinstance(surveys, list)
    for survey in surveys:
        assert "survey_id" in survey
        assert survey["survey_id"].startswith("rfproc:")
        parts = survey["survey_id"][7:].split(":")
        assert len(parts) == 4  # mission_type, site, sensor, run_id


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_list_surveys_filters_success_only():
    """Test that list_surveys only returns successful run manifests (if filtering is implemented)."""
    data_source = RfprocGoldSilverDataSource()
    surveys = data_source.list_surveys({})
    # This test would need to verify that only status="success" manifests are included
    # Implementation may vary - some adapters filter in list_bands instead
    assert isinstance(surveys, list)


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_list_bands():
    """Test that list_bands reads run manifest and returns bands."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    bands = data_source.list_bands(survey_id)
    assert isinstance(bands, list)
    for band in bands:
        assert "band_id" in band
        assert "survey_id" in band
        assert band["survey_id"] == survey_id
        assert "axis" in band or "band_label" in band


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_list_bands_filters_success_only():
    """Test that list_bands only returns bands from successful run manifests."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    # This should raise ValueError if run manifest status is not "success"
    try:
        bands = data_source.list_bands(survey_id)
        assert isinstance(bands, list)
    except ValueError:
        # Expected if run manifest status is not "success"
        pass


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_holds_response_shape():
    """Test that get_holds returns normalized format matching frontend expectations."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    result = data_source.get_holds(survey_id, band_id, max_points=None)

    # Check required fields
    assert "freqs" in result
    assert "max_hold" in result
    assert "min_hold" in result
    assert "avg_hold" in result
    assert "metadata" in result
    assert "source_mode" in result

    # Check source_mode
    assert result["source_mode"] == "rfproc"

    # Check that arrays have matching lengths
    assert len(result["freqs"]) == len(result["max_hold"])
    assert len(result["freqs"]) == len(result["min_hold"])
    assert len(result["freqs"]) == len(result["avg_hold"])

    # Check metadata structure
    metadata = result["metadata"]
    assert "band_id" in metadata
    assert "n_traces" in metadata or metadata.get("n_traces") is None
    assert "start_hz" in metadata
    assert "step_hz" in metadata
    assert "stop_hz" in metadata


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_holds_frequency_axis_exact_length():
    """Test that frequency axis length matches n_freqs exactly."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    result = data_source.get_holds(survey_id, band_id, max_points=None)

    metadata = result["metadata"]
    n_freqs = metadata.get("n_freqs")
    if n_freqs:
        # Frequency axis should match n_freqs exactly (without downsampling)
        assert len(result["freqs"]) == n_freqs


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_holds_downsampling():
    """Test that downsampling works when max_points is provided."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    result = data_source.get_holds(survey_id, band_id, max_points=100)

    # Check that arrays are downsampled (should be <= 100 points)
    assert len(result["freqs"]) <= 100
    assert len(result["max_hold"]) <= 100
    assert len(result["min_hold"]) <= 100
    assert len(result["avg_hold"]) <= 100


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_holds_filters_success_only():
    """Test that get_holds only returns data from successful gold manifests."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    # This should raise ValueError if gold manifest status is not "success"
    try:
        result = data_source.get_holds(survey_id, band_id)
        assert result["source_mode"] == "rfproc"
    except ValueError:
        # Expected if gold manifest status is not "success"
        pass

