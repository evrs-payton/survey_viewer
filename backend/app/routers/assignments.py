"""Assignments router for assignment overlay endpoints."""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..services import assignments_service

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


@router.get("/overlay")
async def get_overlay(
    site: str = Query(..., description="Site name"),
    band_start_hz: int = Query(..., description="Band start frequency in Hz (BIGINT)"),
    band_stop_hz: int = Query(..., description="Band stop frequency in Hz (BIGINT)"),
    valid_on: Optional[str] = Query(None, description="Date filter (YYYY-MM-DD)"),
) -> List[dict]:
    """Get assignment overlays that overlap with the given frequency band.
    
    Args:
        site: Site name (required)
        band_start_hz: Band start frequency in Hz (required, integer)
        band_stop_hz: Band stop frequency in Hz (required, integer)
        valid_on: Optional date filter in YYYY-MM-DD format
        
    Returns:
        List of assignment overlay records
        
    Raises:
        HTTPException: 400 if validation fails, 500 if database error
    """
    # Validate site
    if not site or not site.strip():
        raise HTTPException(status_code=400, detail="site parameter is required and cannot be empty")
    
    # Validate frequency range
    if band_start_hz < 0:
        raise HTTPException(status_code=400, detail="band_start_hz must be non-negative")
    if band_stop_hz < 0:
        raise HTTPException(status_code=400, detail="band_stop_hz must be non-negative")
    if band_stop_hz < band_start_hz:
        raise HTTPException(status_code=400, detail="band_stop_hz must be >= band_start_hz")
    
    # Parse valid_on date if provided
    valid_on_date: Optional[date] = None
    if valid_on is not None:
        try:
            valid_on_date = date.fromisoformat(valid_on)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"valid_on must be in YYYY-MM-DD format, got: {valid_on}",
            )
    
    try:
        overlays = await get_overlays_service(
            site=site.strip(),
            band_start_hz=band_start_hz,
            band_stop_hz=band_stop_hz,
            valid_on=valid_on_date,
        )
        return overlays
    except RuntimeError as e:
        # Database connection or configuration errors
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        # Unexpected errors
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

