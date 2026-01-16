from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from ..services.rfproc_data_source import RfprocGoldSilverDataSource

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/waterfall", tags=["waterfall"])

_data_source = RfprocGoldSilverDataSource()


@router.get("/tile")
def get_waterfall_tile(
    survey_id: str = Query(..., description="Survey ID (mission_type:site:sensor:run_id)"),
    band_id: str = Query(..., description="Band ID"),
    f0: Optional[float] = Query(None, description="Start frequency in Hz"),
    f1: Optional[float] = Query(None, description="Stop frequency in Hz"),
    t0: Optional[float] = Query(None, description="Start time in seconds from start"),
    t1: Optional[float] = Query(None, description="Stop time in seconds from start"),
    maxw: int = Query(1600, ge=1, le=8192, description="Max tile width"),
    maxt: int = Query(600, ge=1, le=8192, description="Max tile height"),
    level_id: Optional[str] = Query(None, description="Optional waterfall level id"),
    vmin: Optional[float] = Query(None, description="Minimum value for color scale (dBm)"),
    vmax: Optional[float] = Query(None, description="Maximum value for color scale (dBm)"),
    downsample: str = Query("mean", description="Downsample mode: mean or max"),
    fmt: str = Query("png", description="Response format: png or json"),
) -> Response:
    """Return a PNG tile for waterfall visualization."""
    try:
        if fmt == "json":
            payload = _data_source.get_waterfall_tile_data(
                survey_id=survey_id,
                band_id=band_id,
                f0=f0,
                f1=f1,
                t0=t0,
                t1=t1,
                maxw=maxw,
                maxt=maxt,
                level_id=level_id,
                downsample_mode=downsample,
            )
            return JSONResponse(content=payload)
        png_bytes, headers = _data_source.get_waterfall_tile(
            survey_id=survey_id,
            band_id=band_id,
            f0=f0,
            f1=f1,
            t0=t0,
            t1=t1,
            maxw=maxw,
            maxt=maxt,
            level_id=level_id,
            vmin=vmin,
            vmax=vmax,
            downsample_mode=downsample,
        )
        return Response(content=png_bytes, media_type="image/png", headers=headers)
    except ValueError as exc:
        error_msg = str(exc)
        logger.error(
            "Error getting waterfall tile for survey_id=%s band_id=%s: %s",
            survey_id,
            band_id,
            error_msg,
        )
        if "not found" in error_msg.lower() or "no waterfall" in error_msg.lower():
            raise HTTPException(status_code=404, detail=error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as exc:
        logger.exception(
            "Unexpected error getting waterfall tile for survey_id=%s band_id=%s",
            survey_id,
            band_id,
        )
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(exc)}")
