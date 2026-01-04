"""Assignments router for assignment overlay endpoints."""

from __future__ import annotations

import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict

from ..services.assignments_service import get_overlays as get_overlays_service
from ..services.assignment_import import import_assignments as import_assignments_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


# Pydantic models for import endpoint
class AssignmentRecord(BaseModel):
    """Single assignment record in import request."""
    
    model_config = ConfigDict(extra="ignore")  # Ignore extra fields like stations, name, agency, etc.
    
    agency_serial: str = Field(..., description="Agency serial number (mapped to assignment_serial in database)")
    center_frequency_hz: int = Field(..., description="Center frequency in Hz (BIGINT, accepts float values)")
    bandwidth_hz: int = Field(..., description="Bandwidth in Hz (BIGINT, accepts float values)")
    latitude: Optional[float] = Field(None, description="Latitude (optional)")
    longitude: Optional[float] = Field(None, description="Longitude (optional)")
    valid_from: Optional[str] = Field(None, description="Valid from date (YYYY-MM-DD or ISO format, optional)")
    review_date: Optional[str] = Field(None, description="Review date (YYYY-MM-DD or ISO format, optional)")
    expiration_date: Optional[str] = Field(None, description="Expiration date (YYYY-MM-DD or ISO format, optional)")


class AssignmentImport(BaseModel):
    """Import request body."""
    
    site: str = Field(..., description="Site name (required, user-provided)")
    source_name: str = Field(default="SFAF", description="Source name (default: SFAF)")
    assignments: List[AssignmentRecord] = Field(..., description="List of assignment records")


class ImportError(BaseModel):
    """Per-record error in import response."""
    
    index: int = Field(..., description="Index of the assignment in the request array")
    assignment_serial: str = Field(..., description="Assignment serial number")
    error: str = Field(..., description="Error message")


class ImportResponse(BaseModel):
    """Import response with statistics."""
    
    site: str = Field(..., description="Site name")
    source_name: str = Field(..., description="Source name")
    received: int = Field(..., description="Number of assignments received")
    inserted: int = Field(..., description="Number of assignments inserted")
    skipped: int = Field(..., description="Number of assignments skipped (duplicates)")
    errors: List[ImportError] = Field(default_factory=list, description="List of per-record errors")


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
        logger.error(f"Database error in get_overlay endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        # Unexpected errors
        logger.error(f"Unexpected error in get_overlay endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/import", response_model=ImportResponse)
async def import_assignments_endpoint(request: AssignmentImport) -> ImportResponse:
    """Import assignment records into PostgreSQL.
    
    This endpoint accepts already-parsed assignment data and inserts it into
    the database. Duplicate assignments (same site + assignment_serial) are
    skipped silently. The endpoint returns import statistics including counts
    of inserted, skipped, and errored records.
    
    This endpoint is intentionally minimal—it only stores the minimum overlay
    fields needed for visualization (assignment_serial, frequencies, location,
    validity dates). It does not store station classes, emissions, power,
    comments, equipment, or other classification-sensitive data.
    
    Args:
        request: Import request with site, source_name, and assignments array
        
    Returns:
        ImportResponse with statistics (received, inserted, skipped, errors)
        
    Raises:
        HTTPException: 400 if validation fails, 500 if database error
    """
    # Validate site
    if not request.site or not request.site.strip():
        raise HTTPException(status_code=400, detail="site is required and cannot be empty")
    
    # Convert assignments to dict list for service function
    assignments_dict = [assignment.model_dump() for assignment in request.assignments]
    
    try:
        result = await import_assignments_service(
            site=request.site.strip(),
            source_name=request.source_name,
            assignments=assignments_dict,
        )
        
        # Convert errors to ImportError models
        error_models = [
            ImportError(index=e["index"], assignment_serial=e["assignment_serial"], error=e["error"])
            for e in result["errors"]
        ]
        
        return ImportResponse(
            site=request.site.strip(),
            source_name=request.source_name,
            received=len(request.assignments),
            inserted=result["inserted"],
            skipped=result["skipped"],
            errors=error_models,
        )
    except RuntimeError as e:
        # Database connection or configuration errors
        logger.error(f"Database error in import_assignments endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        # Unexpected errors
        logger.error(f"Unexpected error in import_assignments endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

