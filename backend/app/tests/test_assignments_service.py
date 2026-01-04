"""Tests for assignments service."""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ..services import assignments_service


@pytest.mark.asyncio
async def test_get_overlays_basic():
    """Test basic overlay query with site and frequency range."""
    mock_rows = [
        {
            "assignment_serial": "ASSIGN-001",
            "freq_start_hz": 100000000,
            "freq_stop_hz": 150000000,
            "center_frequency_hz": 125000000,
            "bandwidth_hz": 50000000,
            "source_name": "SFAF",
        }
    ]
    
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=mock_rows)
    mock_pool.acquire = AsyncMock()
    mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    
    with patch("app.services.assignments_service.get_pool", return_value=mock_pool):
        result = await assignments_service.get_overlays(
            site="TestSite",
            band_start_hz=120000000,
            band_stop_hz=140000000,
        )
    
    assert len(result) == 1
    assert result[0]["assignment_serial"] == "ASSIGN-001"
    assert result[0]["freq_start_hz"] == 100000000
    assert result[0]["freq_stop_hz"] == 150000000
    assert result[0]["center_frequency_hz"] == 125000000
    assert result[0]["bandwidth_hz"] == 50000000
    assert result[0]["source_name"] == "SFAF"
    
    # Verify query was called with correct parameters
    mock_conn.fetch.assert_called_once()
    call_args = mock_conn.fetch.call_args
    assert "site = $1" in call_args[0][0]
    assert "freq_range && int8range($2, $3" in call_args[0][0]
    assert call_args[0][1] == "TestSite"
    assert call_args[0][2] == 120000000
    assert call_args[0][3] == 140000000


@pytest.mark.asyncio
async def test_get_overlays_with_valid_on():
    """Test overlay query with valid_on date filter."""
    mock_rows = []
    
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=mock_rows)
    mock_pool.acquire = AsyncMock()
    mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    
    valid_date = date(2025, 1, 15)
    
    with patch("app.services.assignments_service.get_pool", return_value=mock_pool):
        result = await assignments_service.get_overlays(
            site="TestSite",
            band_start_hz=100000000,
            band_stop_hz=200000000,
            valid_on=valid_date,
        )
    
    assert result == []
    
    # Verify query includes valid_on filter
    mock_conn.fetch.assert_called_once()
    call_args = mock_conn.fetch.call_args
    assert "valid_from IS NULL OR valid_from <= $4" in call_args[0][0]
    assert "valid_to IS NULL OR valid_to >= $4" in call_args[0][0]
    assert call_args[0][4] == valid_date


@pytest.mark.asyncio
async def test_get_overlays_empty_result():
    """Test overlay query with no matches."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[])
    mock_pool.acquire = AsyncMock()
    mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    
    with patch("app.services.assignments_service.get_pool", return_value=mock_pool):
        result = await assignments_service.get_overlays(
            site="TestSite",
            band_start_hz=100000000,
            band_stop_hz=200000000,
        )
    
    assert result == []

