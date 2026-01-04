"""Tests for assignment import service."""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest

from ..services import assignment_import


@pytest.mark.asyncio
async def test_import_new_assignments():
    """Test importing new assignments successfully."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock(return_value="INSERT 0 1")  # Inserted
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    assignments = [
        {
            "agency_serial": "ASSIGN-001",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": 49.4333333333,
            "longitude": 7.6,
            "valid_from": "2018-06-05",
            "expiration_date": "2021-12-31",
        },
        {
            "agency_serial": "ASSIGN-002",
            "center_frequency_hz": 2700000,
            "bandwidth_hz": 200,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 2
    assert result["skipped"] == 0
    assert len(result["errors"]) == 0
    assert mock_conn.execute.call_count == 2


@pytest.mark.asyncio
async def test_import_skip_duplicates():
    """Test that duplicate assignments are skipped."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    # First call: inserted, second call: skipped (conflict)
    mock_conn.execute = AsyncMock(side_effect=["INSERT 0 1", "INSERT 0 0"])
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    assignments = [
        {
            "agency_serial": "ASSIGN-001",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
        {
            "agency_serial": "ASSIGN-001",  # Duplicate
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 1
    assert result["skipped"] == 1
    assert len(result["errors"]) == 0


@pytest.mark.asyncio
async def test_import_freq_derivation():
    """Test frequency derivation using floor/ceil."""
    import math
    
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock(return_value="INSERT 0 1")
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    # Test with odd bandwidth (should use floor/ceil correctly)
    assignments = [
        {
            "agency_serial": "ASSIGN-001",
            "center_frequency_hz": 100,
            "bandwidth_hz": 101,  # Odd number
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 1
    assert len(result["errors"]) == 0
    
    # Verify the SQL was called with correct derived frequencies
    call_args = mock_conn.execute.call_args[0]  # Tuple of positional arguments
    # Parameters: query (0), site (1), serial (2), source_name (3), center (4), bandwidth (5), freq_start (6), freq_stop (7), lat (8), lon (9), valid_from (10), valid_to (11)
    freq_start_hz = call_args[6]
    freq_stop_hz = call_args[7]
    
    expected_start = 100 - math.floor(101 / 2)  # 100 - 50 = 50
    expected_stop = 100 + math.ceil(101 / 2)  # 100 + 51 = 151
    
    assert freq_start_hz == expected_start
    assert freq_stop_hz == expected_stop


@pytest.mark.asyncio
async def test_import_validation_errors():
    """Test validation errors for invalid assignments."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    assignments = [
        {
            "agency_serial": "ASSIGN-001",
            "center_frequency_hz": -100,  # Invalid: <= 0
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
        {
            "agency_serial": "ASSIGN-002",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 0,  # Invalid: <= 0
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
        {
            "agency_serial": "ASSIGN-003",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": "invalid-date",  # Invalid date format
            "expiration_date": None,
        },
        {
            "agency_serial": "ASSIGN-004",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": "2021-12-31",
            "expiration_date": "2020-01-01",  # Invalid: valid_from > expiration_date
        },
        {
            "agency_serial": "",  # Missing serial (empty string treated as falsy)
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 0
    assert result["skipped"] == 0
    assert len(result["errors"]) == 5
    
    # Check error messages
    error_messages = [e["error"] for e in result["errors"]]
    assert any("center_frequency_hz must be > 0" in msg for msg in error_messages)
    assert any("bandwidth_hz must be > 0" in msg for msg in error_messages)
    assert any("YYYY-MM-DD format" in msg for msg in error_messages)
    assert any("valid_from" in msg and ("expiration_date" in msg or "review_date" in msg) for msg in error_messages)
    assert any("agency_serial is required" in msg for msg in error_messages)
    
    # Verify no database calls were made (all failed validation)
    mock_conn.execute.assert_not_called()


@pytest.mark.asyncio
async def test_import_partial_errors():
    """Test partial errors - mix of valid and invalid records."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    # First valid record: inserted, second valid record: skipped (duplicate)
    mock_conn.execute = AsyncMock(side_effect=["INSERT 0 1", "INSERT 0 0"])
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    assignments = [
        {
            "agency_serial": "ASSIGN-001",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
        {
            "agency_serial": "ASSIGN-002",
            "center_frequency_hz": -100,  # Invalid
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
        {
            "agency_serial": "ASSIGN-001",  # Duplicate of first
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 1
    assert result["skipped"] == 1
    assert len(result["errors"]) == 1
    assert result["errors"][0]["index"] == 1
    assert "center_frequency_hz must be > 0" in result["errors"][0]["error"]


@pytest.mark.asyncio
async def test_import_expiration_date_precedence():
    """Test that expiration_date takes precedence over review_date when both are present."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock(return_value="INSERT 0 1")
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    assignments = [
        {
            "agency_serial": "ASSIGN-001",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "review_date": "2025-12-31",
            "expiration_date": "2024-12-31",  # Should use this, not review_date
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 1
    assert len(result["errors"]) == 0
    
    # Verify expiration_date was used (2024-12-31), not review_date (2025-12-31)
    call_args = mock_conn.execute.call_args[0]  # Tuple of positional arguments
    valid_to = call_args[11]  # 12th argument (0-indexed: query is 0, then site, serial, source_name, center, bandwidth, freq_start, freq_stop, lat, lon, valid_from, valid_to)
    assert valid_to == date(2024, 12, 31)


@pytest.mark.asyncio
async def test_import_review_date_when_no_expiration():
    """Test that review_date is used when expiration_date is not present."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock(return_value="INSERT 0 1")
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    assignments = [
        {
            "agency_serial": "ASSIGN-001",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "review_date": "2025-12-31",
            # No expiration_date
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 1
    assert len(result["errors"]) == 0
    
    # Verify review_date was used
    call_args = mock_conn.execute.call_args[0]  # Tuple of positional arguments
    valid_to = call_args[11]  # 12th argument (0-indexed: query is 0, then site, serial, source_name, center, bandwidth, freq_start, freq_stop, lat, lon, valid_from, valid_to)
    assert valid_to == date(2025, 12, 31)


@pytest.mark.asyncio
async def test_import_null_dates():
    """Test handling of null dates."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock(return_value="INSERT 0 1")
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    assignments = [
        {
            "agency_serial": "ASSIGN-001",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 1
    assert len(result["errors"]) == 0
    
    # Verify null dates were passed correctly
    call_args = mock_conn.execute.call_args[0]  # Tuple of positional arguments
    valid_from = call_args[10]  # 11th argument (0-indexed: query is 0, then site, serial, source_name, center, bandwidth, freq_start, freq_stop, lat, lon, valid_from, valid_to)
    valid_to = call_args[11]
    assert valid_from is None
    assert valid_to is None


@pytest.mark.asyncio
async def test_import_constraint_violation():
    """Test handling of database constraint violations."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    # Simulate constraint violation (e.g., freq_start > freq_stop due to overflow)
    constraint_error = asyncpg.exceptions.CheckViolationError(
        "new row for relation \"assignments\" violates check constraint \"assignments_freq_bounds_ck\""
    )
    mock_conn.execute = AsyncMock(side_effect=constraint_error)
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    assignments = [
        {
            "agency_serial": "ASSIGN-001",
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
            "latitude": None,
            "longitude": None,
            "valid_from": None,
            "expiration_date": None,
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 0
    assert result["skipped"] == 0
    assert len(result["errors"]) == 1
    assert "Constraint violation" in result["errors"][0]["error"]


@pytest.mark.asyncio
async def test_import_missing_required_fields():
    """Test handling of missing required fields."""
    mock_pool = AsyncMock()
    mock_conn = AsyncMock()
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_context.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_context)
    
    assignments = [
        {
            # Missing agency_serial
            "center_frequency_hz": 2602500,
            "bandwidth_hz": 100,
        },
        {
            "agency_serial": "ASSIGN-002",
            # Missing center_frequency_hz
            "bandwidth_hz": 100,
        },
        {
            "agency_serial": "ASSIGN-003",
            "center_frequency_hz": 2602500,
            # Missing bandwidth_hz
        },
    ]
    
    with patch("app.services.assignment_import.get_pool", return_value=mock_pool):
        result = await assignment_import.import_assignments(
            site="TestSite",
            source_name="SFAF",
            assignments=assignments,
        )
    
    assert result["inserted"] == 0
    assert result["skipped"] == 0
    assert len(result["errors"]) == 3
    assert any("assignment_serial is required" in e["error"] for e in result["errors"])
    assert any("center_frequency_hz is required" in e["error"] for e in result["errors"])
    assert any("bandwidth_hz is required" in e["error"] for e in result["errors"])
    
    # Verify no database calls were made
    mock_conn.execute.assert_not_called()


