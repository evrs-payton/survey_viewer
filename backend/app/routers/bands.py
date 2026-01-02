from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..services.rfproc_data_source import RfprocGoldSilverDataSource

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
        raise HTTPException(status_code=400, detail=str(e))
