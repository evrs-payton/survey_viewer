"""Assignments router for assignment overlay endpoints."""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Path, Query, UploadFile
from pydantic import BaseModel, Field, ConfigDict

from ..services.assignments_service import get_overlays as get_overlays_service
from ..services.assignment_import import import_assignments as import_assignments_service
from ..services.sfaf_parser import parse_sfaf_content
from ..services.assignments_admin import (
    list_sites as list_sites_service,
    list_assignments_for_site as list_assignments_for_site_service,
    delete_assignment as delete_assignment_service,
)

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


class AssignmentRecordOut(BaseModel):
    """Assignment record as returned by admin/list endpoints."""

    id: int = Field(..., description="Primary key")
    site: str = Field(..., description="Site name")
    assignment_serial: str = Field(..., description="Assignment serial number")
    source_name: str = Field(..., description="Source name")
    center_frequency_hz: int = Field(..., description="Center frequency in Hz")
    bandwidth_hz: int = Field(..., description="Bandwidth in Hz")
    freq_start_hz: int = Field(..., description="Start frequency in Hz")
    freq_stop_hz: int = Field(..., description="Stop frequency in Hz")
    latitude: Optional[float] = Field(None, description="Latitude (optional)")
    longitude: Optional[float] = Field(None, description="Longitude (optional)")
    valid_from: Optional[str] = Field(None, description="Valid-from date (YYYY-MM-DD)")
    valid_to: Optional[str] = Field(None, description="Valid-to date (YYYY-MM-DD)")
    ingested_at_utc: Optional[str] = Field(
        None, description="Ingestion timestamp in UTC (ISO 8601)"
    )


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


@router.get("/sites", response_model=List[str])
async def list_sites() -> List[str]:
    """List distinct sites that currently have assignments."""
    try:
        return await list_sites_service()
    except RuntimeError as e:
        logger.error("Database error in list_sites endpoint: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:  # pragma: no cover - unexpected
        logger.error("Unexpected error in list_sites endpoint: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}"
        )


@router.get(
    "/by-site/{site}",
    response_model=List[AssignmentRecordOut],
)
async def list_assignments_for_site(site: str = Path(..., description="Site name")):
    """List all assignments for a single site."""
    if not site or not site.strip():
        raise HTTPException(status_code=400, detail="site is required and cannot be empty")

    try:
        records = await list_assignments_for_site_service(site.strip())
        # Pydantic model will validate/serialize records dicts
        return [AssignmentRecordOut.model_validate(r) for r in records]
    except RuntimeError as e:
        logger.error(
            "Database error in list_assignments_for_site endpoint: %s", e, exc_info=True
        )
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:  # pragma: no cover - unexpected
        logger.error(
            "Unexpected error in list_assignments_for_site endpoint: %s",
            e,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}"
        )


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


def _detect_file_type(filename: Optional[str], content: str) -> str:
    """Detect file type (JSON or SFAF) from filename and content.
    
    Args:
        filename: Optional filename (may include extension)
        content: File content as string
        
    Returns:
        File type string: "json" or "sfaf"
        
    Raises:
        ValueError: If file type cannot be determined
    """
    # Check file extension first
    if filename:
        filename_lower = filename.lower()
        if filename_lower.endswith('.json'):
            return "json"
        if filename_lower.endswith('.sfaf'):
            return "sfaf"
        if filename_lower.endswith('.txt'):
            # For .txt files, try JSON first (faster check)
            try:
                parsed = json.loads(content)
                if isinstance(parsed, list):
                    return "json"
            except (json.JSONDecodeError, ValueError):
                pass
            # If JSON parse fails, assume SFAF
            return "sfaf"
    
    # No extension or unknown extension - try JSON first
    try:
        parsed = json.loads(content)
        if isinstance(parsed, list):
            return "json"
    except (json.JSONDecodeError, ValueError):
        pass
    
    # Check for SFAF markers (lines starting with 005 and 924)
    lines = content.split('\n')
    has_005 = any(line.startswith('005') for line in lines[:100])  # Check first 100 lines
    has_924 = any(line.startswith('924') for line in lines)
    
    if has_005 and has_924:
        return "sfaf"
    
    # If we can't determine, try JSON one more time with stricter check
    try:
        parsed = json.loads(content)
        if isinstance(parsed, list):
            return "json"
    except (json.JSONDecodeError, ValueError):
        pass
    
    raise ValueError("Could not determine file type. Expected JSON array or SFAF 1-column format.")


@router.post("/import/file", response_model=ImportResponse)
async def import_assignments_file(
    file: UploadFile = File(..., description="SFAF 1-column or JSON file"),
    site: str = Form(..., description="Site name (required)"),
    source_name: Optional[str] = Form(None, description="Source name (optional, defaults based on file type)"),
) -> ImportResponse:
    """Import assignment records from uploaded file (SFAF or JSON) into PostgreSQL.
    
    This endpoint accepts file uploads in either SFAF 1-column format or JSON format.
    File type is automatically detected based on file extension and content.
    Duplicate assignments (same site + assignment_serial) are skipped silently.
    
    Args:
        file: Uploaded file (SFAF 1-column text or JSON)
        site: Site name (required)
        source_name: Optional source name (defaults to "SFAF" or "JSON" based on file type)
        
    Returns:
        ImportResponse with statistics (received, inserted, skipped, errors)
        
    Raises:
        HTTPException: 400 if validation fails, 500 if database error
    """
    # Validate site
    if not site or not site.strip():
        raise HTTPException(status_code=400, detail="site is required and cannot be empty")
    
    # Read file content
    try:
        content_bytes = await file.read()
        content_str = content_bytes.decode('utf-8')
    except UnicodeDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"File must be UTF-8 encoded text. Error: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Error reading uploaded file: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Error reading file: {str(e)}")
    
    # Detect file type
    try:
        file_type = _detect_file_type(file.filename, content_str)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Parse based on file type
    try:
        if file_type == "json":
            assignments = json.loads(content_str)
            if not isinstance(assignments, list):
                raise HTTPException(
                    status_code=400,
                    detail="JSON file must contain an array of assignment objects"
                )
            # Validate JSON structure (each item should be a dict)
            for i, item in enumerate(assignments):
                if not isinstance(item, dict):
                    raise HTTPException(
                        status_code=400,
                        detail=f"JSON array item at index {i} must be an object"
                    )
        elif file_type == "sfaf":
            assignments = parse_sfaf_content(content_str)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_type}")
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JSON format: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Error parsing file: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Error parsing file: {str(e)}")
    
    if len(assignments) == 0:
        raise HTTPException(status_code=400, detail="File contains no valid assignment records")
    
    # Determine source_name if not provided
    if source_name is None or not source_name.strip():
        source_name = "SFAF" if file_type == "sfaf" else "JSON"
    
    # Call import service
    try:
        result = await import_assignments_service(
            site=site.strip(),
            source_name=source_name,
            assignments=assignments,
        )
        
        # Convert errors to ImportError models
        error_models = [
            ImportError(index=e["index"], assignment_serial=e["assignment_serial"], error=e["error"])
            for e in result["errors"]
        ]
        
        return ImportResponse(
            site=site.strip(),
            source_name=source_name,
            received=len(assignments),
            inserted=result["inserted"],
            skipped=result["skipped"],
            errors=error_models,
        )
    except RuntimeError as e:
        # Database connection or configuration errors
        logger.error(f"Database error in import_assignments_file endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        # Unexpected errors
        logger.error(f"Unexpected error in import_assignments_file endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/{assignment_id}", status_code=204)
async def delete_assignment(assignment_id: int = Path(..., description="Assignment id")):
    """Delete a single assignment by id."""
    try:
        deleted = await delete_assignment_service(assignment_id)
    except RuntimeError as e:
        logger.error(
            "Database error in delete_assignment endpoint: %s", e, exc_info=True
        )
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:  # pragma: no cover - unexpected
        logger.error(
            "Unexpected error in delete_assignment endpoint: %s", e, exc_info=True
        )
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}"
        )

    if not deleted:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # FastAPI will return 204 No Content when no body is returned

