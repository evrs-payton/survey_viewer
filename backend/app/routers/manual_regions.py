"""Manual regions router for manual region overlay endpoints."""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.manual_regions_service import (
    create_region as create_region_service,
    delete_region as delete_region_service,
    get_regions as get_regions_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/manual-regions", tags=["manual-regions"])


class ManualRegionCreate(BaseModel):
    """Request body for creating a manual region."""
    
    site: str = Field(..., description="Site name (required)")
    freq_start_hz: int = Field(..., description="Region start frequency in Hz (BIGINT)")
    freq_stop_hz: int = Field(..., description="Region stop frequency in Hz (BIGINT)")
    label: Optional[str] = Field(None, description="Optional label for the region")
    color: Optional[str] = Field(None, description="Optional color (defaults to 'rgba(255, 200, 0, 0.3)')")


class ManualRegion(BaseModel):
    """Manual region response model."""
    
    id: str = Field(..., description="Region UUID")
    site: str = Field(..., description="Site name")
    freq_start_hz: int = Field(..., description="Region start frequency in Hz")
    freq_stop_hz: int = Field(..., description="Region stop frequency in Hz")
    label: Optional[str] = Field(None, description="Region label")
    color: Optional[str] = Field(None, description="Region color")
    created_by: Optional[str] = Field(None, description="User who created the region")
    created_at_utc: Optional[str] = Field(None, description="Creation timestamp (ISO format)")


@router.get("", response_model=List[ManualRegion])
async def get_manual_regions(
    site: str = Query(..., description="Site name"),
    band_start_hz: int = Query(..., description="Band start frequency in Hz (BIGINT)"),
    band_stop_hz: int = Query(..., description="Band stop frequency in Hz (BIGINT)"),
) -> List[ManualRegion]:
    """Get manual regions that overlap with the given frequency band.
    
    Args:
        site: Site name (required)
        band_start_hz: Band start frequency in Hz (required, integer)
        band_stop_hz: Band stop frequency in Hz (required, integer)
        
    Returns:
        List of manual region records
        
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
    
    try:
        regions = await get_regions_service(
            site=site.strip(),
            band_start_hz=band_start_hz,
            band_stop_hz=band_stop_hz,
        )
        return [ManualRegion(**region) for region in regions]
    except RuntimeError as e:
        logger.error(f"Database error in get_manual_regions endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error in get_manual_regions endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=ManualRegion)
async def create_manual_region(request: ManualRegionCreate) -> ManualRegion:
    """Create a new manual region.
    
    Args:
        request: Manual region creation request
        
    Returns:
        Created manual region record
        
    Raises:
        HTTPException: 400 if validation fails, 500 if database error
    """
    # Validate site
    if not request.site or not request.site.strip():
        raise HTTPException(status_code=400, detail="site is required and cannot be empty")
    
    # Validate frequency range
    if request.freq_start_hz < 0:
        raise HTTPException(status_code=400, detail="freq_start_hz must be non-negative")
    if request.freq_stop_hz < 0:
        raise HTTPException(status_code=400, detail="freq_stop_hz must be non-negative")
    if request.freq_stop_hz < request.freq_start_hz:
        raise HTTPException(status_code=400, detail="freq_stop_hz must be >= freq_start_hz")
    
    try:
        region = await create_region_service(
            site=request.site.strip(),
            freq_start_hz=request.freq_start_hz,
            freq_stop_hz=request.freq_stop_hz,
            label=request.label,
            color=request.color,
        )
        return ManualRegion(**region)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Database error in create_manual_region endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error in create_manual_region endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/{region_id}")
async def delete_manual_region(region_id: str) -> dict:
    """Delete a manual region by UUID.
    
    Args:
        region_id: UUID of the region to delete
        
    Returns:
        Success status
        
    Raises:
        HTTPException: 400 if invalid UUID, 404 if not found, 500 if database error
    """
    try:
        deleted = await delete_region_service(region_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Manual region with id {region_id} not found")
        return {"success": True, "message": f"Manual region {region_id} deleted"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Database error in delete_manual_region endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error in delete_manual_region endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
