"""Legacy gold data source adapter.

Reads legacy gold parquet files from MinIO and normalizes them to the frontend format.
"""

from __future__ import annotations

import math
import re
from typing import Dict, List, Optional

import numpy as np

from .data_source import DataSource
from .duck import get_connection
from .minio_client import bucket_name, get_minio_client


def _downsample_arrays(
    arrays: Dict[str, np.ndarray], max_points: Optional[int]
) -> Dict[str, np.ndarray]:
    """Downsample arrays if they exceed max_points.

    Args:
        arrays: Dictionary mapping keys to numpy arrays (all same length)
        max_points: Maximum number of points (if None, no downsampling)

    Returns:
        Dictionary with downsampled arrays (or original if no downsampling needed)
    """
    if max_points is None or max_points <= 0:
        return arrays

    # Get length from first array
    first_key = next(iter(arrays))
    n_points = len(arrays[first_key])

    if n_points <= max_points:
        return arrays

    # Compute decimation factor
    k = math.ceil(n_points / max_points)

    # Decimate all arrays
    return {key: arr[::k] for key, arr in arrays.items()}


class LegacyGoldDataSource(DataSource):
    """Data source adapter for legacy gold parquet files.

    Reads from: gold/survey/{site}/{YYYY-MM}/band{band_index}_holds.parquet
    Survey ID format: legacy:{site}:{yyyy-mm}
    """

    def list_surveys(self, filters: Dict) -> List[Dict]:
        """List available surveys from gold/survey/ prefix.

        Args:
            filters: Optional filter dictionary (currently unused for legacy)

        Returns:
            List of survey dictionaries with 'survey_id' in format 'legacy:{site}:{yyyy-mm}'
        """
        client = get_minio_client()
        bucket = bucket_name()
        prefix = "gold/survey/"

        surveys = {}
        for obj in client.list_objects(bucket, prefix=prefix, recursive=True):
            # Parse path: gold/survey/{site}/{YYYY-MM}/...
            path = obj.object_name
            if not path.startswith(prefix):
                continue

            # Extract site and month
            parts = path[len(prefix) :].split("/")
            if len(parts) < 2:
                continue

            site = parts[0]
            month = parts[1]

            # Validate month format (YYYY-MM)
            if not (len(month) == 7 and month[4] == "-" and month.replace("-", "").isdigit()):
                continue

            survey_id = f"legacy:{site}:{month}"
            if survey_id not in surveys:
                surveys[survey_id] = {"survey_id": survey_id, "site": site, "month": month}

        return sorted(surveys.values(), key=lambda x: x["survey_id"])

    def list_bands(self, survey_id: str) -> List[Dict]:
        """List bands for a survey.

        Args:
            survey_id: Survey identifier in format 'legacy:{site}:{yyyy-mm}'

        Returns:
            List of band dictionaries with band identifiers
        """
        # Parse survey_id
        if not survey_id.startswith("legacy:"):
            raise ValueError(f"Invalid legacy survey_id format: {survey_id}")
        parts = survey_id[7:].split(":")  # Remove 'legacy:' prefix
        if len(parts) != 2:
            raise ValueError(f"Invalid legacy survey_id format: {survey_id}")
        site, month = parts

        # List bands from MinIO
        client = get_minio_client()
        bucket = bucket_name()
        prefix = f"gold/survey/{site}/{month}/"

        band_re = re.compile(r"band(\d+)_holds\.parquet$")
        bands = []

        for obj in client.list_objects(bucket, prefix=prefix, recursive=False):
            name = obj.object_name
            if not name.endswith("_holds.parquet"):
                continue

            fname = name.split("/")[-1]
            m = band_re.match(fname)
            if m:
                band_index = int(m.group(1))
                bands.append(
                    {
                        "band_id": str(band_index),
                        "band_index": band_index,
                        "survey_id": survey_id,
                    }
                )

        return sorted(bands, key=lambda x: x["band_index"])

    def get_holds(
        self,
        survey_id: str,
        band_id: str,
        product_type: str = "holds",
        max_points: Optional[int] = None,
    ) -> Dict:
        """Get normalized holds data for frontend.

        Args:
            survey_id: Survey identifier in format 'legacy:{site}:{yyyy-mm}'
            band_id: Band identifier (band_index as string)
            product_type: Product type (default: "holds", ignored for legacy)
            max_points: Optional maximum number of points (downsample if n_freqs > max_points)

        Returns:
            Dictionary with normalized holds data:
            {
                "freqs": List[float],
                "max_hold": List[float],
                "min_hold": List[float],
                "avg_hold": List[float],
                "metadata": Dict,
                "source_mode": str
            }
        """
        # Parse survey_id
        if not survey_id.startswith("legacy:"):
            raise ValueError(f"Invalid legacy survey_id format: {survey_id}")
        parts = survey_id[7:].split(":")
        if len(parts) != 2:
            raise ValueError(f"Invalid legacy survey_id format: {survey_id}")
        site, month = parts

        # Parse band_id
        try:
            band_index = int(band_id)
        except ValueError:
            raise ValueError(f"Invalid band_id for legacy format (expected integer): {band_id}")

        # Read parquet from MinIO
        bucket = bucket_name()
        holds_obj = f"s3://{bucket}/gold/survey/{site}/{month}/band{band_index}_holds.parquet"

        con = get_connection()
        try:
            full_stats_df = con.execute("SELECT * FROM read_parquet(?)", [holds_obj]).fetchdf()
        except Exception as e:
            raise ValueError(f"Failed to read legacy gold holds: {e}")

        if full_stats_df.empty:
            raise ValueError(f"No data found for band {band_index}")

        # Extract frequency and hold arrays
        freqs = full_stats_df["freq_hz"].values.astype(np.float64)
        max_hold = full_stats_df["power_max"].values.astype(np.float32)
        min_hold = full_stats_df["power_min"].values.astype(np.float32)
        avg_hold = full_stats_df["power_mean"].values.astype(np.float32)

        # Prepare arrays for downsampling
        arrays = {
            "freqs": freqs,
            "max_hold": max_hold,
            "min_hold": min_hold,
            "avg_hold": avg_hold,
        }

        # Apply downsampling if needed
        arrays = _downsample_arrays(arrays, max_points)

        # Extract metadata from first row
        first_row = full_stats_df.iloc[0]
        meta_site = first_row.get("meta_site", "")
        meta_band_label = first_row.get("meta_band_label", "")
        meta_total_traces = first_row.get("meta_total_traces")
        meta_time_min = first_row.get("meta_time_min")
        meta_time_max = first_row.get("meta_time_max")
        meta_freq_start = first_row.get("meta_freq_start_hz")
        meta_freq_stop = first_row.get("meta_freq_stop_hz")
        meta_freq_step = first_row.get("meta_freq_step_hz")
        meta_days_str = first_row.get("meta_days", "")
        meta_run_ids_str = first_row.get("meta_run_ids", "")

        # Parse comma-separated lists
        days_list = [d.strip() for d in meta_days_str.split(",")] if meta_days_str else []
        days_list = [d for d in days_list if d]
        run_ids_list = [r.strip() for r in meta_run_ids_str.split(",")] if meta_run_ids_str else []
        run_ids_list = [r for r in run_ids_list if r]

        metadata = {
            "band_index": band_index,
            "band_label": meta_band_label if meta_band_label else None,
            "n_traces": int(meta_total_traces) if meta_total_traces is not None else None,
            "start_hz": float(meta_freq_start) if meta_freq_start is not None else None,
            "stop_hz": float(meta_freq_stop) if meta_freq_stop is not None else None,
            "step_hz": float(meta_freq_step) if meta_freq_step is not None else None,
            "unix_time_min": int(meta_time_min) if meta_time_min is not None else None,
            "unix_time_max": int(meta_time_max) if meta_time_max is not None else None,
            "days": days_list,
            "run_ids": run_ids_list,
            "site": meta_site if meta_site else site,
        }

        return {
            "freqs": arrays["freqs"].tolist(),
            "max_hold": arrays["max_hold"].tolist(),
            "min_hold": arrays["min_hold"].tolist(),
            "avg_hold": arrays["avg_hold"].tolist(),
            "metadata": metadata,
            "source_mode": "legacy",
        }

