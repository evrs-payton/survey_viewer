from __future__ import annotations

import logging
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ..services.rfproc_data_source import RfprocGoldSilverDataSource

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bands", tags=["bands"])

# Create a single instance of the data source
_data_source = RfprocGoldSilverDataSource()


@router.get("/surveys")
def list_surveys() -> List[Dict]:
    """List available surveys.

    Returns surveys in format: {mission_type}:{site}:{sensor}:{run_id}
    """
    return _data_source.list_surveys({})


@router.get("/survey/{survey_id}/bands")
def list_bands_for_survey(survey_id: str) -> List[Dict]:
    """List bands for a survey.

    Args:
        survey_id: Survey identifier in format '{mission_type}:{site}:{sensor}:{run_id}'
    """
    try:
        return _data_source.list_bands(survey_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/survey/{survey_id}/band/{band_id}/holds")
def get_holds(
    survey_id: str,
    band_id: str,
    max_points: Optional[int] = Query(default=None, ge=1, description="Maximum number of points (downsample if needed)"),
) -> Dict:
    """Get normalized holds data for frontend.

    Args:
        survey_id: Survey identifier in format '{mission_type}:{site}:{sensor}:{run_id}'
        band_id: Band identifier (band_id string from run manifest)
        max_points: Optional maximum number of points (recommended: 50000)

    Returns:
        Normalized holds data with freqs, max_hold, min_hold, avg_hold, metadata
    """
    try:
        return _data_source.get_holds(survey_id, band_id, product_type="holds", max_points=max_points)
    except ValueError as e:
        logger.error(f"Error getting holds for survey_id={survey_id}, band_id={band_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Unexpected error getting holds for survey_id={survey_id}, band_id={band_id}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/survey/{survey_id}/band/{band_id}/signal-activity")
def get_signal_activity(
    survey_id: str,
    band_id: str,
) -> Dict:
    """Get signal activity data for frontend.

    Args:
        survey_id: Survey identifier in format '{mission_type}:{site}:{sensor}:{run_id}'
        band_id: Band identifier (band_id string from run manifest)

    Returns:
        Signal activity data with freqs, activity, metadata
    """
    try:
        return _data_source.get_signal_activity(survey_id, band_id)
    except ValueError as e:
        error_msg = str(e)
        logger.error(f"Error getting signal activity for survey_id={survey_id}, band_id={band_id}: {error_msg}")
        # Check if it's an axis mismatch error
        if "axis mismatch" in error_msg.lower():
            # Try to extract axis details for structured error
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "axis_mismatch",
                    "message": error_msg,
                }
            )
        # Check if it's a not found error
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=404, detail=error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as e:
        logger.exception(f"Unexpected error getting signal activity for survey_id={survey_id}, band_id={band_id}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/survey/{survey_id}/band/{band_id}/signal-activity/regions")
def get_signal_activity_regions(
    survey_id: str,
    band_id: str,
    threshold: float = Query(default=0.05, ge=0.0, le=1.0, description="Activity threshold (0..1)"),
) -> Dict:
    """Get activity regions where activity >= threshold.

    Args:
        survey_id: Survey identifier in format '{mission_type}:{site}:{sensor}:{run_id}'
        band_id: Band identifier (band_id string from run manifest)
        threshold: Activity threshold (0..1, default: 0.05)

    Returns:
        Dictionary with threshold and list of regions:
        {
            "threshold": float,
            "regions": [{"start_hz": float, "stop_hz": float}, ...]
        }
    """
    try:
        # Get signal activity data
        activity_data = _data_source.get_signal_activity(survey_id, band_id)
        
        # Extract regions
        activity = np.array(activity_data["activity"])
        freqs = np.array(activity_data["freqs"])
        regions = _data_source._extract_activity_regions(activity, freqs, threshold)
        
        return {
            "threshold": threshold,
            "regions": regions,
        }
    except ValueError as e:
        error_msg = str(e)
        logger.error(f"Error getting signal activity regions for survey_id={survey_id}, band_id={band_id}, threshold={threshold}: {error_msg}")
        if "axis mismatch" in error_msg.lower():
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "axis_mismatch",
                    "message": error_msg,
                }
            )
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=404, detail=error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as e:
        logger.exception(f"Unexpected error getting signal activity regions for survey_id={survey_id}, band_id={band_id}, threshold={threshold}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
