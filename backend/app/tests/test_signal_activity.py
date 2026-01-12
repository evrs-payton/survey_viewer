"""Tests for signal activity functionality."""

from __future__ import annotations

import numpy as np
import pytest

from app.services.rfproc_data_source import RfprocGoldSilverDataSource


def test_extract_activity_regions_simple():
    """Test region extraction with known spans."""
    data_source = RfprocGoldSilverDataSource()
    
    # Create test data: activity >= 0.05 at indices 10-15 and 20-25
    n_freqs = 30
    activity = np.zeros(n_freqs, dtype=np.float32)
    activity[10:16] = 0.1  # Region 1: indices 10-15
    activity[20:26] = 0.08  # Region 2: indices 20-25
    
    start_hz = 100e6
    step_hz = 2e3
    freqs = np.array([start_hz + i * step_hz for i in range(n_freqs)], dtype=np.float64)
    
    threshold = 0.05
    regions = data_source._extract_activity_regions(activity, freqs, threshold)
    
    assert len(regions) == 2
    assert regions[0]["start_hz"] == pytest.approx(freqs[10], rel=1e-6)
    assert regions[0]["stop_hz"] == pytest.approx(freqs[15] + step_hz, rel=1e-6)
    assert regions[1]["start_hz"] == pytest.approx(freqs[20], rel=1e-6)
    assert regions[1]["stop_hz"] == pytest.approx(freqs[25] + step_hz, rel=1e-6)


def test_extract_activity_regions_merges_adjacent():
    """Test that adjacent bins are merged into single region."""
    data_source = RfprocGoldSilverDataSource()
    
    # Create test data: activity >= 0.05 at indices 10-20 (contiguous)
    n_freqs = 30
    activity = np.zeros(n_freqs, dtype=np.float32)
    activity[10:21] = 0.1  # Contiguous region
    
    start_hz = 100e6
    step_hz = 2e3
    freqs = np.array([start_hz + i * step_hz for i in range(n_freqs)], dtype=np.float64)
    
    threshold = 0.05
    regions = data_source._extract_activity_regions(activity, freqs, threshold)
    
    assert len(regions) == 1
    assert regions[0]["start_hz"] == pytest.approx(freqs[10], rel=1e-6)
    assert regions[0]["stop_hz"] == pytest.approx(freqs[20] + step_hz, rel=1e-6)


def test_extract_activity_regions_no_active():
    """Test that empty list is returned when no bins meet threshold."""
    data_source = RfprocGoldSilverDataSource()
    
    n_freqs = 30
    activity = np.zeros(n_freqs, dtype=np.float32)  # All zeros
    start_hz = 100e6
    step_hz = 2e3
    freqs = np.array([start_hz + i * step_hz for i in range(n_freqs)], dtype=np.float64)
    
    threshold = 0.05
    regions = data_source._extract_activity_regions(activity, freqs, threshold)
    
    assert len(regions) == 0


def test_extract_activity_regions_all_active():
    """Test region extraction when all bins are active."""
    data_source = RfprocGoldSilverDataSource()
    
    n_freqs = 30
    activity = np.full(n_freqs, 0.1, dtype=np.float32)  # All above threshold
    start_hz = 100e6
    step_hz = 2e3
    freqs = np.array([start_hz + i * step_hz for i in range(n_freqs)], dtype=np.float64)
    
    threshold = 0.05
    regions = data_source._extract_activity_regions(activity, freqs, threshold)
    
    assert len(regions) == 1
    assert regions[0]["start_hz"] == pytest.approx(freqs[0], rel=1e-6)
    assert regions[0]["stop_hz"] == pytest.approx(freqs[-1] + step_hz, rel=1e-6)


def test_extract_activity_regions_empty_arrays():
    """Test that empty arrays return empty list."""
    data_source = RfprocGoldSilverDataSource()
    
    activity = np.array([], dtype=np.float32)
    freqs = np.array([], dtype=np.float64)
    
    threshold = 0.05
    regions = data_source._extract_activity_regions(activity, freqs, threshold)
    
    assert len(regions) == 0


def test_extract_activity_regions_length_mismatch():
    """Test that length mismatch raises ValueError."""
    data_source = RfprocGoldSilverDataSource()
    
    activity = np.array([0.1, 0.2], dtype=np.float32)
    freqs = np.array([100e6, 100.002e6, 100.004e6], dtype=np.float64)  # Different length
    
    threshold = 0.05
    with pytest.raises(ValueError, match="must have same length"):
        data_source._extract_activity_regions(activity, freqs, threshold)


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_signal_activity_success():
    """Test successful aggregation of signal activity."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    
    result = data_source.get_signal_activity(survey_id, band_id)
    
    # Check required fields
    assert "freqs" in result
    assert "activity" in result
    assert "metadata" in result
    
    # Check that arrays have matching lengths
    assert len(result["freqs"]) == len(result["activity"])
    
    # Check metadata structure
    metadata = result["metadata"]
    assert "threshold_method" in metadata
    assert "n_bins_active_gt0" in metadata
    assert "max_activity_fraction" in metadata
    assert "p95_activity_fraction" in metadata
    
    # Check activity values are in valid range
    activity = np.array(result["activity"])
    assert np.all(activity >= 0.0)
    assert np.all(activity <= 1.0)


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_get_signal_activity_axis_mismatch():
    """Test that axis mismatch raises ValueError with structured error."""
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    
    # This should raise ValueError if axis mismatch occurs
    with pytest.raises(ValueError, match="axis mismatch"):
        data_source.get_signal_activity(survey_id, band_id)


@pytest.mark.skip(reason="Requires MinIO connection and test data")
def test_signal_activity_endpoint_response_keys():
    """Smoke test for endpoint response shape."""
    # This would test the actual HTTP endpoint
    # For now, we test the service method directly
    data_source = RfprocGoldSilverDataSource()
    survey_id = "rfproc:survey:Lask:CRFS:run01"
    band_id = "band_001"
    
    try:
        result = data_source.get_signal_activity(survey_id, band_id)
        
        # Verify response keys
        assert "freqs" in result
        assert "activity" in result
        assert "metadata" in result
        
        # Verify metadata keys
        metadata = result["metadata"]
        required_metadata_keys = [
            "threshold_method",
            "n_bins_active_gt0",
            "max_activity_fraction",
            "p95_activity_fraction",
        ]
        for key in required_metadata_keys:
            assert key in metadata, f"Missing metadata key: {key}"
    except ValueError:
        # Expected if test data is not available
        pass
