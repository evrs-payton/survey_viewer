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

