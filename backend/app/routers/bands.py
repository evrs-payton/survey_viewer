from __future__ import annotations

import io
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ..services.dataset import DatasetService, get_dataset_service
from ..services.data_source import get_data_source

router = APIRouter(prefix="/bands", tags=["bands"])
@router.get("", response_model=List[Dict[str, object]])
def list_bands(service: DatasetService = Depends(get_dataset_service)) -> List[Dict[str, object]]:
    bands = service.available_bands()
    return [
        {
            "id": info.band_id,
            "meta": info.meta,
        }
        for info in bands
    ]


@router.get("/{band_id}/meta")
def get_band_meta(band_id: str, service: DatasetService = Depends(get_dataset_service)) -> Dict[str, object]:
    try:
        band = service.get_band(band_id)
    except KeyError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return dict(band.meta)


@router.get("/{band_id}/summary")
def get_band_summary(
    band_id: str,
    f0: Optional[float] = Query(default=None),
    f1: Optional[float] = Query(default=None),
    max_pts: int = Query(default=2200, ge=1),
    service: DatasetService = Depends(get_dataset_service),
) -> Dict[str, List[float]]:
    band = service.get_band(band_id)
    summary = band.summary_slice(f0=f0, f1=f1, max_points=max_pts)
    return {key: np.asarray(value).tolist() for key, value in summary.items()}


def _encode_png(tile: np.ndarray) -> bytes:
    from PIL import Image

    data = tile
    min_val = float(np.min(data))
    max_val = float(np.max(data))
    if max_val - min_val < 1e-6:
        max_val = min_val + 1e-6
    norm = (data - min_val) / (max_val - min_val)

    # Build a LUT for black→blue→green→yellow→orange→red
    stops = [
        (0.0, (0, 0, 0)),        # black
        (0.2, (0, 0, 255)),      # blue
        (0.4, (0, 255, 0)),      # green
        (0.6, (255, 255, 0)),    # yellow
        (0.8, (255, 165, 0)),    # orange
        (1.0, (255, 0, 0)),      # red
    ]
    levels = 256
    xs = np.array([s for s, _ in stops], dtype=np.float32)
    cs = np.array([c for _, c in stops], dtype=np.float32)
    lut = np.zeros((levels, 3), dtype=np.uint8)
    for i in range(levels):
        t = i / (levels - 1)
        j = int(np.max(np.where(xs <= t))) if np.any(xs <= t) else 0
        k = min(j + 1, len(xs) - 1)
        denom = float(xs[k] - xs[j]) if xs[k] != xs[j] else 1.0
        a = float((t - xs[j]) / denom)
        col = (1.0 - a) * cs[j] + a * cs[k]
        lut[i] = np.clip(col, 0, 255).astype(np.uint8)

    idx = np.clip((norm * (levels - 1)).astype(np.int32), 0, levels - 1)
    rgb = lut[idx]

    buf = io.BytesIO()
    img = Image.fromarray(rgb, mode="RGB")
    img.save(buf, format="PNG")
    return buf.getvalue()


@router.get("/{band_id}/waterfall_tile")
def get_waterfall_tile(
    band_id: str,
    f0: Optional[float] = Query(default=None),
    f1: Optional[float] = Query(default=None),
    t0: Optional[float] = Query(default=None),
    t1: Optional[float] = Query(default=None),
    maxw: int = Query(default=1600, ge=1),
    maxt: int = Query(default=600, ge=1),
    fmt: str = Query(default="png"),
    service: DatasetService = Depends(get_dataset_service),
) -> Response:
    band = service.get_band(band_id)
    tile, times, freqs = band.waterfall_tile(
        f0=f0, f1=f1, t0=t0, t1=t1, maxw=maxw, maxt=maxt
    )

    headers = {
        "X-Time-Start": str(float(times[0]) if len(times) else 0.0),
        "X-Time-End": str(float(times[-1]) if len(times) else 0.0),
        "X-Freq-Start": str(float(freqs[0]) if len(freqs) else 0.0),
        "X-Freq-End": str(float(freqs[-1]) if len(freqs) else 0.0),
    }

    if fmt == "png":
        payload = _encode_png(tile)
        return Response(content=payload, media_type="image/png", headers=headers)

    buf = io.BytesIO()
    np.savez_compressed(buf, tile=tile, times=times, freqs=freqs)
    return Response(content=buf.getvalue(), media_type="application/octet-stream", headers=headers)


# New routes using DataSource adapter system
@router.get("/mode")
def get_data_source_mode() -> Dict:
    """Get the current data source mode.

    Returns:
        Dictionary with 'mode' field: "legacy" or "rfproc"
    """
    import os
    mode = os.getenv("DATA_SOURCE_MODE", "legacy")
    return {"mode": mode}


@router.get("/surveys")
def list_surveys() -> List[Dict]:
    """List available surveys using DataSource adapter.

    Returns surveys in format determined by DATA_SOURCE_MODE:
    - Legacy: legacy:{site}:{yyyy-mm}
    - rfproc: rfproc:{mission_type}:{site}:{sensor}:{run_id}
    """
    data_source = get_data_source()
    return data_source.list_surveys({})


@router.get("/survey/{survey_id}/bands")
def list_bands_for_survey(survey_id: str) -> List[Dict]:
    """List bands for a survey using DataSource adapter.

    Args:
        survey_id: Opaque survey identifier (format depends on DATA_SOURCE_MODE)
    """
    data_source = get_data_source()
    try:
        return data_source.list_bands(survey_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/survey/{survey_id}/band/{band_id}/holds")
def get_holds(
    survey_id: str,
    band_id: str,
    max_points: Optional[int] = Query(default=None, ge=1, description="Maximum number of points (downsample if needed)"),
) -> Dict:
    """Get normalized holds data for frontend using DataSource adapter.

    Args:
        survey_id: Opaque survey identifier (format depends on DATA_SOURCE_MODE)
        band_id: Band identifier (format depends on DATA_SOURCE_MODE)
        max_points: Optional maximum number of points (recommended: 50000)

    Returns:
        Normalized holds data with freqs, max_hold, min_hold, avg_hold, metadata, source_mode
    """
    data_source = get_data_source()
    try:
        return data_source.get_holds(survey_id, band_id, product_type="holds", max_points=max_points)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
