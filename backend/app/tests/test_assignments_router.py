"""Tests for assignments router."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from ..main import create_app


@pytest.fixture
def client():
    """Create test client."""
    app = create_app()
    return TestClient(app)


@pytest.mark.asyncio
async def test_get_overlay_success(client):
    """Test GET overlay endpoint with valid parameters."""
    mock_overlays = [
        {
            "assignment_serial": "ASSIGN-001",
            "freq_start_hz": 100000000,
            "freq_stop_hz": 150000000,
            "center_frequency_hz": 125000000,
            "bandwidth_hz": 50000000,
            "source_name": "SFAF",
        }
    ]
    
    with patch(
        "app.routers.assignments.get_overlays_service",
        new_callable=AsyncMock,
        return_value=mock_overlays,
    ):
        response = client.get(
            "/api/assignments/overlay",
            params={
                "site": "TestSite",
                "band_start_hz": 120000000,
                "band_stop_hz": 140000000,
            },
        )
    
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["assignment_serial"] == "ASSIGN-001"


@pytest.mark.asyncio
async def test_get_overlay_with_valid_on(client):
    """Test GET overlay endpoint with valid_on parameter."""
    mock_overlays = []
    
    with patch(
        "app.routers.assignments.get_overlays_service",
        new_callable=AsyncMock,
        return_value=mock_overlays,
    ):
        response = client.get(
            "/api/assignments/overlay",
            params={
                "site": "TestSite",
                "band_start_hz": 100000000,
                "band_stop_hz": 200000000,
                "valid_on": "2025-01-15",
            },
        )
    
    assert response.status_code == 200
    data = response.json()
    assert data == []


def test_get_overlay_missing_site(client):
    """Test GET overlay endpoint with missing site parameter."""
    response = client.get(
        "/api/assignments/overlay",
        params={
            "band_start_hz": 100000000,
            "band_stop_hz": 200000000,
        },
    )
    
    assert response.status_code == 422  # FastAPI validation error


def test_get_overlay_empty_site(client):
    """Test GET overlay endpoint with empty site parameter."""
    response = client.get(
        "/api/assignments/overlay",
        params={
            "site": "",
            "band_start_hz": 100000000,
            "band_stop_hz": 200000000,
        },
    )
    
    assert response.status_code == 400
    assert "cannot be empty" in response.json()["detail"].lower()


def test_get_overlay_invalid_frequency_range(client):
    """Test GET overlay endpoint with invalid frequency range."""
    response = client.get(
        "/api/assignments/overlay",
        params={
            "site": "TestSite",
            "band_start_hz": 200000000,
            "band_stop_hz": 100000000,  # stop < start
        },
    )
    
    assert response.status_code == 400
    assert "band_stop_hz must be >= band_start_hz" in response.json()["detail"]


def test_get_overlay_negative_frequencies(client):
    """Test GET overlay endpoint with negative frequencies."""
    response = client.get(
        "/api/assignments/overlay",
        params={
            "site": "TestSite",
            "band_start_hz": -100000000,
            "band_stop_hz": 200000000,
        },
    )
    
    assert response.status_code == 400
    assert "band_start_hz must be non-negative" in response.json()["detail"]


def test_get_overlay_invalid_date_format(client):
    """Test GET overlay endpoint with invalid date format."""
    response = client.get(
        "/api/assignments/overlay",
        params={
            "site": "TestSite",
            "band_start_hz": 100000000,
            "band_stop_hz": 200000000,
            "valid_on": "invalid-date",
        },
    )
    
    assert response.status_code == 400
    assert "YYYY-MM-DD format" in response.json()["detail"]


@pytest.mark.asyncio
async def test_import_success(client):
    """Test POST import endpoint with valid data."""
    mock_result = {
        "inserted": 2,
        "skipped": 0,
        "errors": [],
    }
    
    with patch(
        "app.routers.assignments.import_assignments_service",
        new_callable=AsyncMock,
        return_value=mock_result,
    ):
        response = client.post(
            "/api/assignments/import",
            json={
                "site": "TestSite",
                "source_name": "SFAF",
                "assignments": [
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
                ],
            },
        )
    
    assert response.status_code == 200
    data = response.json()
    assert data["site"] == "TestSite"
    assert data["source_name"] == "SFAF"
    assert data["received"] == 2
    assert data["inserted"] == 2
    assert data["skipped"] == 0
    assert data["errors"] == []


@pytest.mark.asyncio
async def test_import_skip_duplicates(client):
    """Test POST import endpoint with duplicate assignments."""
    mock_result = {
        "inserted": 1,
        "skipped": 1,
        "errors": [],
    }
    
    with patch(
        "app.routers.assignments.import_assignments_service",
        new_callable=AsyncMock,
        return_value=mock_result,
    ):
        response = client.post(
            "/api/assignments/import",
            json={
                "site": "TestSite",
                "source_name": "SFAF",
                "assignments": [
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
                ],
            },
        )
    
    assert response.status_code == 200
    data = response.json()
    assert data["received"] == 2
    assert data["inserted"] == 1
    assert data["skipped"] == 1
    assert len(data["errors"]) == 0


@pytest.mark.asyncio
async def test_import_validation_errors(client):
    """Test POST import endpoint with validation errors."""
    mock_result = {
        "inserted": 1,
        "skipped": 0,
        "errors": [
            {
                "index": 1,
                "assignment_serial": "ASSIGN-002",
                "error": "bandwidth_hz must be > 0",
            },
        ],
    }
    
    with patch(
        "app.routers.assignments.import_assignments_service",
        new_callable=AsyncMock,
        return_value=mock_result,
    ):
        response = client.post(
            "/api/assignments/import",
            json={
                "site": "TestSite",
                "source_name": "SFAF",
                "assignments": [
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
                        "center_frequency_hz": 2602500,
                        "bandwidth_hz": 0,  # Invalid
                        "latitude": None,
                        "longitude": None,
                        "valid_from": None,
                        "expiration_date": None,
                    },
                ],
            },
        )
    
    assert response.status_code == 200
    data = response.json()
    assert data["received"] == 2
    assert data["inserted"] == 1
    assert data["skipped"] == 0
    assert len(data["errors"]) == 1
    assert data["errors"][0]["index"] == 1
    assert data["errors"][0]["assignment_serial"] == "ASSIGN-002"
    assert "bandwidth_hz must be > 0" in data["errors"][0]["error"]


def test_import_missing_site(client):
    """Test POST import endpoint with missing site."""
    response = client.post(
        "/api/assignments/import",
        json={
            "source_name": "SFAF",
            "assignments": [
                {
                    "assignment_serial": "ASSIGN-001",
                    "center_frequency_hz": 2602500,
                    "bandwidth_hz": 100,
                },
            ],
        },
    )
    
    assert response.status_code == 422  # FastAPI validation error


def test_import_empty_site(client):
    """Test POST import endpoint with empty site."""
    response = client.post(
        "/api/assignments/import",
        json={
            "site": "",
            "source_name": "SFAF",
            "assignments": [
                {
                    "assignment_serial": "ASSIGN-001",
                    "center_frequency_hz": 2602500,
                    "bandwidth_hz": 100,
                },
            ],
        },
    )
    
    assert response.status_code == 400
    assert "cannot be empty" in response.json()["detail"].lower()


def test_import_empty_assignments(client):
    """Test POST import endpoint with empty assignments array."""
    mock_result = {
        "inserted": 0,
        "skipped": 0,
        "errors": [],
    }
    
    with patch(
        "app.routers.assignments.import_assignments_service",
        new_callable=AsyncMock,
        return_value=mock_result,
    ):
        response = client.post(
            "/api/assignments/import",
            json={
                "site": "TestSite",
                "source_name": "SFAF",
                "assignments": [],
            },
        )
    
    assert response.status_code == 200
    data = response.json()
    assert data["received"] == 0
    assert data["inserted"] == 0
    assert data["skipped"] == 0
    assert data["errors"] == []


def test_import_default_source_name(client):
    """Test POST import endpoint with default source_name."""
    mock_result = {
        "inserted": 1,
        "skipped": 0,
        "errors": [],
    }
    
    with patch(
        "app.routers.assignments.import_assignments_service",
        new_callable=AsyncMock,
        return_value=mock_result,
    ):
        response = client.post(
            "/api/assignments/import",
            json={
                "site": "TestSite",
                # source_name omitted, should default to "SFAF"
                "assignments": [
                    {
                        "agency_serial": "ASSIGN-001",
                        "center_frequency_hz": 2602500,
                        "bandwidth_hz": 100,
                    },
                ],
            },
        )
    
    assert response.status_code == 200
    data = response.json()
    assert data["source_name"] == "SFAF"  # Should default to SFAF


@pytest.mark.asyncio
async def test_import_database_error(client):
    """Test POST import endpoint with database error."""
    with patch(
        "app.routers.assignments.import_assignments_service",
        new_callable=AsyncMock,
        side_effect=RuntimeError("Database connection failed"),
    ):
        response = client.post(
            "/api/assignments/import",
            json={
                "site": "TestSite",
                "source_name": "SFAF",
                "assignments": [
                    {
                        "agency_serial": "ASSIGN-001",
                        "center_frequency_hz": 2602500,
                        "bandwidth_hz": 100,
                    },
                ],
            },
        )
    
    assert response.status_code == 500
    assert "Database error" in response.json()["detail"]

