"""Signals router for signal candidates endpoint."""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..services.rfproc_data_source import RfprocGoldSilverDataSource

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/signals", tags=["signals"])

# Create a single instance of the data source
_data_source = RfprocGoldSilverDataSource()


@router.get("/candidates")
def get_signal_candidates(
    site: str = Query(..., description="Site name"),
    mission_type: str = Query(..., description="Mission type"),
    sensor: str = Query(..., description="Sensor name"),
    run_id: str = Query(..., description="Run ID"),
    band_id: str = Query(..., description="Band ID"),
    min_activity_peak: Optional[float] = Query(None, ge=0.0, description="Minimum activity_peak filter"),
    min_obw_hz: Optional[float] = Query(None, ge=0.0, description="Minimum OBW in Hz"),
    max_candidates: Optional[int] = Query(None, ge=1, description="Maximum number of candidates to return"),
) -> List[Dict]:
    """Get signal candidates for a band.

    Args:
        site: Site name
        mission_type: Mission type
        sensor: Sensor name
        run_id: Run ID
        band_id: Band ID
        min_activity_peak: Optional minimum activity_peak filter (inclusive)
        min_obw_hz: Optional minimum OBW in Hz filter (inclusive)
        max_candidates: Optional maximum number of candidates to return

    Returns:
        List of candidate dictionaries with fields:
        - center_freq_hz: float
        - f_low_99_hz: float
        - f_high_99_hz: float
        - activity_peak: float
        - activity_mean: float
        - peak_dbm: float | None (optional)
    """
    try:
        # Construct survey_id from params
        survey_id = f"{mission_type}:{site}:{sensor}:{run_id}"
        
        # Call service method
        candidates = _data_source.get_signal_candidates(
            survey_id=survey_id,
            band_id=band_id,
            min_activity_peak=min_activity_peak,
            min_obw_hz=min_obw_hz,
            max_candidates=max_candidates,
        )
        
        return candidates
    except ValueError as e:
        error_msg = str(e)
        logger.error(f"Error getting signal candidates for site={site}, mission_type={mission_type}, sensor={sensor}, run_id={run_id}, band_id={band_id}: {error_msg}")
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=404, detail=error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as e:
        logger.exception(f"Unexpected error getting signal candidates for site={site}, mission_type={mission_type}, sensor={sensor}, run_id={run_id}, band_id={band_id}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/reanalyze")
def reanalyze_signal_candidates(
    site: str = Query(..., description="Site name"),
    mission_type: str = Query(..., description="Mission type"),
    sensor: str = Query(..., description="Sensor name"),
    run_id: str = Query(..., description="Run ID"),
    band_id: str = Query(..., description="Band ID"),
    min_presence: float = Query(0.05, ge=0.0, le=1.0, description="Minimum fraction of traces a candidate must appear in"),
    min_bandwidth_hz: float = Query(5000.0, ge=0.0, description="Minimum candidate bandwidth in Hz"),
    wide_threshold: float = Query(0.90, ge=0.0, le=1.0, description="Activity fraction threshold for wide-signal detection"),
    wide_min_bw_hz: float = Query(100000.0, ge=0.0, description="Minimum bandwidth for wide-signal candidates in Hz"),
) -> List[Dict]:
    """Re-filter stored candidates and rerun wide-signal detection with custom thresholds."""
    try:
        survey_id = f"{mission_type}:{site}:{sensor}:{run_id}"
        candidates = _data_source.reanalyze_signal_candidates(
            survey_id=survey_id,
            band_id=band_id,
            min_presence=min_presence,
            min_bandwidth_hz=min_bandwidth_hz,
            wide_threshold=wide_threshold,
            wide_min_bw_hz=wide_min_bw_hz,
        )
        return candidates
    except ValueError as e:
        error_msg = str(e)
        logger.error(f"Error reanalyzing candidates: {error_msg}")
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=404, detail=error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as e:
        logger.exception("Unexpected error reanalyzing candidates")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
