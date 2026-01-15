"""rfproc gold/silver data source.

Reads new rfproc gold products from MinIO using run manifests as discovery index.
"""

from __future__ import annotations

import json
import math
import tempfile
from datetime import datetime
from typing import Dict, List, Optional

import numpy as np

from .axis_validation import validate_axis_compatibility
from .duck import get_connection
from .minio_client import bucket_name, get_minio_client


def _downsample_arrays(arrays: Dict[str, np.ndarray], max_points: Optional[int]) -> Dict[str, np.ndarray]:
    """Downsample arrays if n_freqs > max_points by taking every k-th point.
    
    Args:
        arrays: Dictionary with array keys (freqs, max_hold, min_hold, avg_hold)
        max_points: Optional maximum number of points (if None, return arrays unchanged)
    
    Returns:
        Dictionary with downsampled arrays (or original arrays if no downsampling needed)
    """
    if max_points is None:
        return arrays
    
    # Get array length from freqs (assume all arrays have same length)
    n_freqs = len(arrays["freqs"])
    if n_freqs <= max_points:
        return arrays
    
    # Compute decimation factor: take every k-th point
    k = math.ceil(n_freqs / max_points)
    
    # Decimate all arrays uniformly
    return {key: arr[::k] for key, arr in arrays.items()}


def _read_manifest(minio_client, bucket: str, manifest_path: str) -> Optional[Dict]:
    """Read and parse a JSON manifest from MinIO.

    Args:
        minio_client: MinIO client
        bucket: MinIO bucket name
        manifest_path: Path to manifest.json

    Returns:
        Parsed manifest dictionary, or None if manifest doesn't exist or can't be read
    """
    try:
        response = minio_client.get_object(bucket, manifest_path)
        try:
            manifest_data = response.read()
            manifest = json.loads(manifest_data.decode("utf-8"))
            return manifest
        finally:
            response.close()
            response.release_conn()
    except Exception:
        return None


class RfprocGoldSilverDataSource:
    """Data source for rfproc gold/silver products.

    Reads from: gold/mission_type={mission_type}/site={site}/sensor={sensor}/run_id={run_id}/band_id={band_id}/product=holds/
    Survey ID format: {mission_type}:{site}:{sensor}:{run_id}
    Uses run manifests as discovery index (runs/.../run_manifest.json)
    """

    def list_surveys(self, filters: Dict) -> List[Dict]:
        """List available surveys from run manifests.

        Args:
            filters: Optional filter dictionary (currently unused)

        Returns:
            List of survey dictionaries with 'survey_id' in format '{mission_type}:{site}:{sensor}:{run_id}'
            and optional 'year' and 'month' fields extracted from run manifest
        """
        client = get_minio_client()
        bucket = bucket_name()
        prefix = "runs/"

        surveys = {}
        for obj in client.list_objects(bucket, prefix=prefix, recursive=True):
            if not obj.object_name.endswith("/run_manifest.json"):
                continue

            # Parse path: runs/mission_type={mission_type}/site={site}/sensor={sensor}/run_id={run_id}/run_manifest.json
            path_parts = obj.object_name.split("/")
            path_dict = {}
            for part in path_parts:
                if "=" in part:
                    k, v = part.split("=", 1)
                    path_dict[k] = v

            mission_type = path_dict.get("mission_type")
            site = path_dict.get("site")
            sensor = path_dict.get("sensor")
            run_id = path_dict.get("run_id")

            if not all([mission_type, site, sensor, run_id]):
                continue

            survey_id = f"{mission_type}:{site}:{sensor}:{run_id}"
            if survey_id not in surveys:
                # Read run manifest to extract date information
                run_manifest = _read_manifest(client, bucket, obj.object_name)
                year = None
                month = None

                if run_manifest:
                    # Try to extract from included_days first (format: YYYY-MM-DD)
                    included_days = run_manifest.get("included_days", [])
                    if included_days and len(included_days) > 0:
                        # Parse first day: YYYY-MM-DD
                        first_day = included_days[0]
                        if isinstance(first_day, str) and len(first_day) >= 7:
                            parts = first_day.split("-")
                            if len(parts) >= 2:
                                try:
                                    year = int(parts[0])
                                    month = int(parts[1])
                                except (ValueError, IndexError):
                                    pass
                    
                    # Fallback to time_start_utc if included_days didn't work
                    if year is None or month is None:
                        time_start_utc = run_manifest.get("time_start_utc")
                        if time_start_utc:
                            try:
                                # Parse ISO format: 2025-09-15T10:30:00Z or 2025-09-15T10:30:00+00:00
                                time_str = time_start_utc.replace("Z", "+00:00") if "Z" in time_start_utc else time_start_utc
                                # Handle both with and without timezone
                                if "+" in time_str or time_str.endswith("+00:00"):
                                    dt = datetime.fromisoformat(time_str)
                                else:
                                    # Parse without timezone
                                    dt = datetime.fromisoformat(time_str)
                                year = dt.year
                                month = dt.month
                            except (ValueError, AttributeError):
                                pass

                surveys[survey_id] = {
                    "survey_id": survey_id,
                    "mission_type": mission_type,
                    "site": site,
                    "sensor": sensor,
                    "run_id": run_id,
                }
                
                # Add year and month if we successfully extracted them
                if year is not None and month is not None:
                    surveys[survey_id]["year"] = year
                    surveys[survey_id]["month"] = month

        return sorted(surveys.values(), key=lambda x: x["survey_id"])

    def list_bands(self, survey_id: str) -> List[Dict]:
        """List bands for a survey by reading run manifest.

        Args:
            survey_id: Survey identifier in format '{mission_type}:{site}:{sensor}:{run_id}'

        Returns:
            List of band dictionaries with band identifiers and metadata
        """
        # Parse survey_id
        parts = survey_id.split(":")
        if len(parts) != 4:
            raise ValueError(f"Invalid survey_id format: {survey_id} (expected 'mission_type:site:sensor:run_id')")
        mission_type, site, sensor, run_id = parts

        # Construct run manifest path
        run_manifest_path = (
            f"runs/mission_type={mission_type}/site={site}/sensor={sensor}/"
            f"run_id={run_id}/run_manifest.json"
        )

        # Read run manifest
        client = get_minio_client()
        bucket = bucket_name()
        run_manifest = _read_manifest(client, bucket, run_manifest_path)

        if not run_manifest:
            raise ValueError(f"Run manifest not found: {run_manifest_path}")

        # Check status (optional, but recommended)
        if run_manifest.get("status") != "success":
            raise ValueError(f"Run manifest status is not 'success': {run_manifest_path}")

        # Extract bands field
        bands = run_manifest.get("bands", {})
        result = []

        for band_id, band_info in bands.items():
            axis = band_info.get("axis", {})
            band_dict = {
                "band_id": band_id,
                "band_label": band_info.get("band_label", ""),
                "survey_id": survey_id,
                "axis": {
                    "start_hz": axis.get("start_hz"),
                    "step_hz": axis.get("step_hz"),
                    "n_freqs": axis.get("n_freqs"),
                    "stop_hz": axis.get("stop_hz"),
                },
            }
            
            # Extract capture_duration_sec_active from silver manifests
            silver_manifest_paths = band_info.get("silver_manifests", [])
            capture_durations = []
            
            for manifest_path in silver_manifest_paths:
                silver_manifest = _read_manifest(client, bucket, manifest_path)
                if silver_manifest:
                    capture_duration = silver_manifest.get("capture_duration_sec_active")
                    if capture_duration is not None:
                        try:
                            capture_durations.append(float(capture_duration))
                        except (ValueError, TypeError):
                            pass
            
            # Aggregate capture durations: sum if multiple days
            if capture_durations:
                band_dict["capture_duration_sec_active"] = sum(capture_durations)
            
            result.append(band_dict)

        return sorted(result, key=lambda x: x["band_id"])

    def get_holds(
        self,
        survey_id: str,
        band_id: str,
        product_type: str = "holds",
        max_points: Optional[int] = None,
    ) -> Dict:
        """Get normalized holds data for frontend.

        Args:
            survey_id: Survey identifier in format '{mission_type}:{site}:{sensor}:{run_id}'
            band_id: Band identifier (band_id string from run manifest)
            product_type: Product type (default: "holds")
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
        parts = survey_id.split(":")
        if len(parts) != 4:
            raise ValueError(f"Invalid survey_id format: {survey_id} (expected 'mission_type:site:sensor:run_id')")
        mission_type, site, sensor, run_id = parts

        # Construct gold manifest path deterministically
        gold_manifest_path = (
            f"gold/mission_type={mission_type}/site={site}/sensor={sensor}/"
            f"run_id={run_id}/band_id={band_id}/product=holds/manifest.json"
        )

        # Read gold manifest
        client = get_minio_client()
        bucket = bucket_name()
        gold_manifest = _read_manifest(client, bucket, gold_manifest_path)

        if not gold_manifest:
            raise ValueError(f"Gold manifest not found: {gold_manifest_path}")

        # Validate status
        if gold_manifest.get("status") != "success":
            raise ValueError(f"Gold manifest status is not 'success': {gold_manifest_path}")

        # Get data object path
        data_object = gold_manifest.get("data_object")
        if not data_object:
            raise ValueError(f"Gold manifest missing data_object: {gold_manifest_path}")

        # Extract metadata from manifest
        start_hz = float(gold_manifest.get("start_hz", 0))
        step_hz = float(gold_manifest.get("step_hz", 0))
        n_freqs = int(gold_manifest.get("n_freqs", 0))
        stop_hz = float(gold_manifest.get("stop_hz", 0))
        band_label = gold_manifest.get("band_label", "")
        n_traces_total = int(gold_manifest.get("n_traces_total", 0))

        # Read parquet data using DuckDB
        con = get_connection()
        data_path = f"s3://{bucket}/{data_object}"
        try:
            table = con.execute(f"SELECT * FROM read_parquet('{data_path}')").fetch_arrow_table()
        except Exception as e:
            raise ValueError(f"Failed to read gold parquet data: {e}")

        # Extract arrays from single row
        if table.num_rows != 1:
            raise ValueError(f"Expected single row in gold parquet, got {table.num_rows}")

        # Extract FixedSizeList arrays from first (and only) row
        min_hold_array = table["min_hold_dbm"][0]
        max_hold_array = table["max_hold_dbm"][0]
        avg_hold_array = table["avg_hold_dbm"][0]

        # Convert FixedSizeList to numpy arrays
        # For FixedSizeList arrays, .values gives the underlying flat array
        min_hold = min_hold_array.values.to_numpy(zero_copy_only=False).astype(np.float32)
        max_hold = max_hold_array.values.to_numpy(zero_copy_only=False).astype(np.float32)
        avg_hold = avg_hold_array.values.to_numpy(zero_copy_only=False).astype(np.float32)

        # Build frequency axis using exact formula: freqs[i] = start_hz + i * step_hz
        freqs = np.array([start_hz + i * step_hz for i in range(n_freqs)], dtype=np.float64)

        # Prepare arrays for downsampling
        arrays = {
            "freqs": freqs,
            "max_hold": max_hold,
            "min_hold": min_hold,
            "avg_hold": avg_hold,
        }

        # Apply downsampling if needed
        arrays = _downsample_arrays(arrays, max_points)

        metadata = {
            "band_id": band_id,
            "band_label": band_label,
            "n_traces": n_traces_total,
            "start_hz": start_hz,
            "stop_hz": stop_hz,
            "step_hz": step_hz,
            "n_freqs": n_freqs,
            "mission_type": mission_type,
            "site": site,
            "sensor": sensor,
            "run_ids": [run_id],
        }

        return {
            "freqs": arrays["freqs"].tolist(),
            "max_hold": arrays["max_hold"].tolist(),
            "min_hold": arrays["min_hold"].tolist(),
            "avg_hold": arrays["avg_hold"].tolist(),
            "metadata": metadata,
        }

    def _extract_activity_regions(
        self,
        activity: np.ndarray,
        freqs: np.ndarray,
        threshold: float,
    ) -> List[Dict[str, float]]:
        """Extract contiguous frequency regions where activity >= threshold.
        
        Args:
            activity: Activity fraction array (0..1)
            freqs: Frequency array in Hz
            threshold: Activity threshold (0..1)
        
        Returns:
            List of region dictionaries with start_hz and stop_hz
        """
        if len(activity) != len(freqs):
            raise ValueError(f"Activity and freqs arrays must have same length: {len(activity)} vs {len(freqs)}")
        
        if len(activity) == 0:
            return []
        
        # Find bins where activity >= threshold
        active_mask = activity >= threshold
        
        if not np.any(active_mask):
            return []
        
        # Find contiguous regions
        regions = []
        in_region = False
        start_idx = None
        
        for i in range(len(active_mask)):
            if active_mask[i] and not in_region:
                # Start of new region
                start_idx = i
                in_region = True
            elif not active_mask[i] and in_region:
                # End of current region
                # stop_hz should be the end of the last active bin
                # For the last bin, use freqs[-1] + step_hz, but we need step_hz
                # Approximate: use next bin's start, or if last bin, use freqs[-1] + (freqs[-1] - freqs[-2])
                if i > 0:
                    step_hz = freqs[1] - freqs[0] if len(freqs) > 1 else 0
                    stop_hz = freqs[i - 1] + step_hz
                else:
                    stop_hz = freqs[0]
                
                regions.append({
                    "start_hz": float(freqs[start_idx]),
                    "stop_hz": float(stop_hz),
                })
                in_region = False
        
        # Handle region that extends to end of array
        if in_region and start_idx is not None:
            step_hz = freqs[1] - freqs[0] if len(freqs) > 1 else 0
            stop_hz = freqs[-1] + step_hz
            regions.append({
                "start_hz": float(freqs[start_idx]),
                "stop_hz": float(stop_hz),
            })
        
        return regions

    def get_signal_activity(
        self,
        survey_id: str,
        band_id: str,
    ) -> Dict:
        """Get signal activity data for a band from gold product.
        
        Reads pre-aggregated signal_activity from gold product (run-level per-bin maximum).
        
        Args:
            survey_id: Survey identifier in format '{mission_type}:{site}:{sensor}:{run_id}'
            band_id: Band identifier (band_id string from run manifest)
        
        Returns:
            Dictionary with signal activity data:
            {
                "freqs": List[float],
                "activity": List[float],  # 0..1
                "metadata": {
                    "threshold_method": str,
                    "noise_percentile": float | None,
                    "margin_db": float | None,
                    "n_bins_active_gt0": int,
                    "max_activity_fraction": float,
                    "p95_activity_fraction": float,
                }
            }
        
        Raises:
            ValueError: If survey_id format is invalid, gold manifest not found,
                        or gold product status is not success
        """
        # Parse survey_id
        parts = survey_id.split(":")
        if len(parts) != 4:
            raise ValueError(f"Invalid survey_id format: {survey_id} (expected 'mission_type:site:sensor:run_id')")
        mission_type, site, sensor, run_id = parts

        # Construct gold manifest path deterministically
        gold_manifest_path = (
            f"gold/mission_type={mission_type}/site={site}/sensor={sensor}/"
            f"run_id={run_id}/band_id={band_id}/product=signal_activity/manifest.json"
        )

        # Read gold manifest
        client = get_minio_client()
        bucket = bucket_name()
        gold_manifest = _read_manifest(client, bucket, gold_manifest_path)

        if not gold_manifest:
            raise ValueError(f"Gold signal_activity manifest not found: {gold_manifest_path}")

        # Validate status
        if gold_manifest.get("status") != "success":
            raise ValueError(f"Gold signal_activity manifest status is not 'success': {gold_manifest_path}")

        # Get data object path
        data_object = gold_manifest.get("data_object")
        if not data_object:
            raise ValueError(f"Gold manifest missing data_object: {gold_manifest_path}")

        # Extract metadata from manifest
        start_hz = float(gold_manifest.get("start_hz", 0))
        step_hz = float(gold_manifest.get("step_hz", 0))
        n_freqs = int(gold_manifest.get("n_freqs", 0))
        stop_hz = float(gold_manifest.get("stop_hz", 0))
        band_label = gold_manifest.get("band_label", "")
        n_traces_total = int(gold_manifest.get("n_traces_total", 0))

        # Read parquet data using DuckDB
        con = get_connection()
        data_path = f"s3://{bucket}/{data_object}"
        try:
            table = con.execute(f"SELECT * FROM read_parquet('{data_path}')").fetch_arrow_table()
        except Exception as e:
            raise ValueError(f"Failed to read gold signal_activity parquet data: {e}")

        # Extract arrays from single row
        if table.num_rows != 1:
            raise ValueError(f"Expected single row in gold parquet, got {table.num_rows}")

        # Extract activity_fraction array from first (and only) row
        activity_fraction_array = table["activity_fraction"][0]

        # Convert FixedSizeList to numpy array
        activity_run = activity_fraction_array.values.to_numpy(zero_copy_only=False).astype(np.float32)

        # Build frequency axis using exact formula: freqs[i] = start_hz + i * step_hz
        freqs = np.array([start_hz + i * step_hz for i in range(n_freqs)], dtype=np.float64)

        # Extract metadata from gold manifest
        threshold_method = gold_manifest.get("threshold_method", "unknown")
        noise_percentile = gold_manifest.get("noise_percentile")
        margin_db = gold_manifest.get("margin_db")
        n_bins_active_gt0 = int(gold_manifest.get("n_bins_active_gt0", 0))
        max_activity_fraction = float(gold_manifest.get("max_activity_fraction", 0.0))
        p95_activity_fraction = float(gold_manifest.get("p95_activity_fraction", 0.0))

        metadata = {
            "threshold_method": threshold_method,
            "noise_percentile": noise_percentile,
            "margin_db": margin_db,
            "n_bins_active_gt0": n_bins_active_gt0,
            "max_activity_fraction": max_activity_fraction,
            "p95_activity_fraction": p95_activity_fraction,
        }

        return {
            "freqs": freqs.tolist(),
            "activity": activity_run.tolist(),
            "metadata": metadata,
        }

    def get_signal_candidates(
        self,
        survey_id: str,
        band_id: str,
        min_activity_peak: Optional[float] = None,
        min_obw_hz: Optional[float] = None,
        max_candidates: Optional[int] = None,
    ) -> List[Dict]:
        """Get signal candidates for a band from gold product.
        
        Reads signal_candidates parquet file (one row per candidate) and returns
        filtered list of candidates with JSON-safe types.
        
        Args:
            survey_id: Survey identifier in format '{mission_type}:{site}:{sensor}:{run_id}'
            band_id: Band identifier (band_id string from run manifest)
            min_activity_peak: Optional minimum activity_peak filter (inclusive)
            min_obw_hz: Optional minimum OBW in Hz filter (inclusive)
            max_candidates: Optional maximum number of candidates to return (after filtering, sorted by center_freq_hz)
        
        Returns:
            List of candidate dictionaries with fields:
            - center_freq_hz: float
            - f_low_99_hz: float
            - f_high_99_hz: float
            - activity_peak: float
            - activity_mean: float
            - peak_dbm: float | None (optional field)
            - Other fields from parquet schema as needed
        
        Raises:
            ValueError: If survey_id format is invalid, gold manifest not found,
                        or gold product status is not success
        """
        # Parse survey_id
        parts = survey_id.split(":")
        if len(parts) != 4:
            raise ValueError(f"Invalid survey_id format: {survey_id} (expected 'mission_type:site:sensor:run_id')")
        mission_type, site, sensor, run_id = parts

        # Construct gold manifest path deterministically
        gold_manifest_path = (
            f"gold/mission_type={mission_type}/site={site}/sensor={sensor}/"
            f"run_id={run_id}/band_id={band_id}/product=signal_candidates/manifest.json"
        )

        # Read gold manifest
        client = get_minio_client()
        bucket = bucket_name()
        gold_manifest = _read_manifest(client, bucket, gold_manifest_path)

        if not gold_manifest:
            raise ValueError(f"Gold signal_candidates manifest not found: {gold_manifest_path}")

        # Validate status
        if gold_manifest.get("status") != "success":
            raise ValueError(f"Gold signal_candidates manifest status is not 'success': {gold_manifest_path}")

        # Get data object path
        data_object = gold_manifest.get("data_object")
        if not data_object:
            raise ValueError(f"Gold manifest missing data_object: {gold_manifest_path}")

        # Read parquet data using DuckDB
        con = get_connection()
        data_path = f"s3://{bucket}/{data_object}"
        try:
            table = con.execute(f"SELECT * FROM read_parquet('{data_path}')").fetch_arrow_table()
        except Exception as e:
            raise ValueError(f"Failed to read gold signal_candidates parquet data: {e}")

        # Convert Arrow table to list of dicts (one per candidate row)
        candidates = []
        for i in range(table.num_rows):
            row_dict = {}
            for col_name in table.column_names:
                col = table[col_name]
                value = col[i].as_py()  # Convert to Python native type
                
                # Handle None values
                if value is None:
                    row_dict[col_name] = None
                    continue
                
                # Convert numpy/pandas types to JSON-safe Python types
                if isinstance(value, (np.integer, np.int64, np.int32)):
                    row_dict[col_name] = int(value)
                elif isinstance(value, (np.floating, np.float64, np.float32)):
                    row_dict[col_name] = float(value)
                elif isinstance(value, (np.bool_, bool)):
                    row_dict[col_name] = bool(value)
                else:
                    # For strings and other types, use as-is
                    row_dict[col_name] = value
            
            candidates.append(row_dict)

        # Apply filters
        filtered_candidates = candidates
        
        # Filter by min_activity_peak
        if min_activity_peak is not None:
            filtered_candidates = [
                c for c in filtered_candidates
                if c.get("activity_peak") is not None and c["activity_peak"] >= min_activity_peak
            ]
        
        # Filter by min_obw_hz
        if min_obw_hz is not None:
            filtered_candidates = [
                c for c in filtered_candidates
                if c.get("f_low_99_hz") is not None and c.get("f_high_99_hz") is not None
                and (c["f_high_99_hz"] - c["f_low_99_hz"]) >= min_obw_hz
            ]
        
        # Sort by center_freq_hz (ascending)
        filtered_candidates.sort(key=lambda c: c.get("center_freq_hz", 0) if c.get("center_freq_hz") is not None else 0)
        
        # Apply max_candidates limit (after filtering and sorting)
        if max_candidates is not None and max_candidates > 0:
            filtered_candidates = filtered_candidates[:max_candidates]
        
        return filtered_candidates