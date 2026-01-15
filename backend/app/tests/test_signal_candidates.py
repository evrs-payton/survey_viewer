"""Tests for signal candidates endpoint."""

from __future__ import annotations

import pytest

from app.services.rfproc_data_source import RfprocGoldSilverDataSource


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_signal_candidates_response_shape():
    """Test that get_signal_candidates returns expected shape."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    result = data_source.get_signal_candidates(survey_id, band_id)

    # Should return a list
    assert isinstance(result, list)
    
    # Each candidate should be a dict with required fields
    for candidate in result:
        assert isinstance(candidate, dict)
        assert "center_freq_hz" in candidate
        assert "f_low_99_hz" in candidate
        assert "f_high_99_hz" in candidate
        # Legacy candidates include activity_peak/activity_mean; tracewise may not
        if "activity_peak" in candidate:
            assert "activity_mean" in candidate
        if "presence" in candidate:
            assert "n_traces_hit" in candidate
            assert "n_traces_total" in candidate
        
        # Check types are JSON-safe (int/float, not numpy types)
        assert isinstance(candidate["center_freq_hz"], (int, float))
        assert isinstance(candidate["f_low_99_hz"], (int, float))
        assert isinstance(candidate["f_high_99_hz"], (int, float))
        if candidate.get("activity_peak") is not None:
            assert isinstance(candidate["activity_peak"], (int, float))
        if candidate.get("activity_mean") is not None:
            assert isinstance(candidate["activity_mean"], (int, float))


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_signal_candidates_empty_list():
    """Test that empty list is valid (no candidates found)."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    # This might return empty list if no candidates exist
    result = data_source.get_signal_candidates(survey_id, band_id)
    assert isinstance(result, list)


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_signal_candidates_filters():
    """Test that filters work correctly."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    
    # Get all candidates
    all_candidates = data_source.get_signal_candidates(survey_id, band_id)
    
    if len(all_candidates) > 0:
        # Test min_activity_peak filter
        filtered = data_source.get_signal_candidates(
            survey_id, band_id, min_activity_peak=0.5
        )
        assert len(filtered) <= len(all_candidates)
        for candidate in filtered:
            assert candidate["activity_peak"] >= 0.5
        
        # Test min_obw_hz filter
        filtered = data_source.get_signal_candidates(
            survey_id, band_id, min_obw_hz=1000.0
        )
        assert len(filtered) <= len(all_candidates)
        for candidate in filtered:
            obw = candidate["f_high_99_hz"] - candidate["f_low_99_hz"]
            assert obw >= 1000.0
        
        # Test max_candidates limit
        limited = data_source.get_signal_candidates(
            survey_id, band_id, max_candidates=5
        )
        assert len(limited) <= 5


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_signal_candidates_optional_fields():
    """Test that missing optional fields are handled gracefully."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    result = data_source.get_signal_candidates(survey_id, band_id)
    
    # peak_dbm may or may not be present
    for candidate in result:
        # Should not raise error if peak_dbm is missing
        if "peak_dbm" in candidate:
            assert candidate["peak_dbm"] is None or isinstance(candidate["peak_dbm"], (int, float))


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_signal_candidates_error_handling():
    """Test error handling for invalid inputs."""
    data_source = RfprocGoldSilverDataSource()
    
    # Invalid survey_id format
    with pytest.raises(ValueError, match="Invalid survey_id format"):
        data_source.get_signal_candidates("invalid", "band_001")
    
    # Non-existent manifest (should raise ValueError)
    with pytest.raises(ValueError, match="not found"):
        data_source.get_signal_candidates("rfproc:site:invalid:sensor:run999", "band_001")
