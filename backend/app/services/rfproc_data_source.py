"""rfproc gold/silver data source.

Reads new rfproc gold products from MinIO using run manifests as discovery index.
"""

from __future__ import annotations

import io
import json
import math
import tempfile
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

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

        # Try to get included_days from run manifest
        included_days = None
        run_manifest_path = (
            f"runs/mission_type={mission_type}/site={site}/sensor={sensor}/"
            f"run_id={run_id}/run_manifest.json"
        )
        run_manifest = _read_manifest(client, bucket, run_manifest_path)
        if run_manifest:
            included_days = run_manifest.get("included_days")

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
        
        # Add included_days if available
        if included_days:
            metadata["included_days"] = included_days

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

    def _arrow_row_to_python(self, table) -> List[Dict]:
        """Convert Arrow table rows to JSON-safe dictionaries."""
        rows: List[Dict] = []
        for i in range(table.num_rows):
            row_dict: Dict[str, object] = {}
            for col_name in table.column_names:
                col = table[col_name]
                value = col[i].as_py()
                if value is None:
                    row_dict[col_name] = None
                elif isinstance(value, (np.integer, np.int64, np.int32)):
                    row_dict[col_name] = int(value)
                elif isinstance(value, (np.floating, np.float64, np.float32)):
                    row_dict[col_name] = float(value)
                elif isinstance(value, (np.bool_, bool)):
                    row_dict[col_name] = bool(value)
                else:
                    row_dict[col_name] = value
            rows.append(row_dict)
        return rows

    def _map_tracewise_candidate_fields(self, candidate: Dict) -> Dict:
        """Normalize tracewise candidate fields to legacy schema keys."""
        mapped = dict(candidate)
        if "center_hz" in candidate and "center_freq_hz" not in candidate:
            mapped["center_freq_hz"] = candidate.get("center_hz")
        if "f_lo_hz" in candidate and "f_low_99_hz" not in candidate:
            mapped["f_low_99_hz"] = candidate.get("f_lo_hz")
        if "f_hi_hz" in candidate and "f_high_99_hz" not in candidate:
            mapped["f_high_99_hz"] = candidate.get("f_hi_hz")
        return mapped

    def get_signal_candidates_tracewise(
        self,
        survey_id: str,
        band_id: str,
        min_activity_peak: Optional[float] = None,
        min_obw_hz: Optional[float] = None,
        max_candidates: Optional[int] = None,
    ) -> List[Dict]:
        """Get tracewise signal candidates for a band from gold product."""
        parts = survey_id.split(":")
        if len(parts) != 4:
            raise ValueError(
                f"Invalid survey_id format: {survey_id} (expected 'mission_type:site:sensor:run_id')"
            )
        mission_type, site, sensor, run_id = parts

        gold_manifest_path = (
            f"gold/mission_type={mission_type}/site={site}/sensor={sensor}/"
            f"run_id={run_id}/band_id={band_id}/product=signal_candidates_tracewise/manifest.json"
        )

        client = get_minio_client()
        bucket = bucket_name()
        gold_manifest = _read_manifest(client, bucket, gold_manifest_path)

        if not gold_manifest:
            raise ValueError(
                f"Gold signal_candidates_tracewise manifest not found: {gold_manifest_path}"
            )

        if gold_manifest.get("status") != "success":
            raise ValueError(
                "Gold signal_candidates_tracewise manifest status is not 'success': "
                f"{gold_manifest_path}"
            )

        data_object = gold_manifest.get("data_object")
        if not data_object:
            raise ValueError(
                f"Gold manifest missing data_object: {gold_manifest_path}"
            )

        con = get_connection()
        data_path = f"s3://{bucket}/{data_object}"
        try:
            table = con.execute(
                f"SELECT * FROM read_parquet('{data_path}')"
            ).fetch_arrow_table()
        except Exception as e:
            raise ValueError(
                f"Failed to read gold signal_candidates_tracewise parquet data: {e}"
            )

        candidates = [
            self._map_tracewise_candidate_fields(row)
            for row in self._arrow_row_to_python(table)
        ]

        filtered_candidates = candidates
        if min_activity_peak is not None:
            filtered_candidates = [
                c
                for c in filtered_candidates
                if c.get("activity_peak") is not None
                and c["activity_peak"] >= min_activity_peak
            ]

        if min_obw_hz is not None:
            filtered_candidates = [
                c
                for c in filtered_candidates
                if c.get("f_low_99_hz") is not None
                and c.get("f_high_99_hz") is not None
                and (c["f_high_99_hz"] - c["f_low_99_hz"]) >= min_obw_hz
            ]

        filtered_candidates.sort(
            key=lambda c: c.get("center_freq_hz", 0)
            if c.get("center_freq_hz") is not None
            else 0
        )

        if max_candidates is not None and max_candidates > 0:
            filtered_candidates = filtered_candidates[:max_candidates]

        return filtered_candidates

    def get_signal_candidates(
        self,
        survey_id: str,
        band_id: str,
        min_activity_peak: Optional[float] = None,
        min_obw_hz: Optional[float] = None,
        max_candidates: Optional[int] = None,
    ) -> List[Dict]:
        """Get signal candidates for a band from gold product.

        Prefers tracewise candidates if available; falls back to legacy candidates.
        
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
        try:
            return self.get_signal_candidates_tracewise(
                survey_id=survey_id,
                band_id=band_id,
                min_activity_peak=min_activity_peak,
                min_obw_hz=min_obw_hz,
                max_candidates=max_candidates,
            )
        except ValueError as exc:
            message = str(exc).lower()
            if "manifest not found" not in message and "missing data_object" not in message:
                raise

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

        candidates = self._arrow_row_to_python(table)

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

    def _select_waterfall_level(
        self,
        levels: List[Dict],
        maxw: int,
        maxt: int,
        f0_hz: float,
        f1_hz: float,
        t0_sec: float,
        t1_sec: float,
        step_hz: float,
    ) -> Optional[Dict]:
        """Pick the finest level that fits within maxw/maxt for requested bounds."""
        if not levels:
            return None

        freq_span_hz = max(1.0, abs(f1_hz - f0_hz))
        time_span_sec = max(1.0, abs(t1_sec - t0_sec))

        def level_detail(level: Dict) -> Tuple[float, float]:
            return float(level.get("time_bin_sec", 0)), float(level.get("freq_group_size", 0))

        levels_sorted = sorted(levels, key=level_detail)
        for level in levels_sorted:
            time_bin_sec = float(level.get("time_bin_sec", 0))
            freq_group_size = int(level.get("freq_group_size", 0))
            if time_bin_sec <= 0 or freq_group_size <= 0:
                continue
            freq_group_hz = step_hz * freq_group_size
            n_time_bins = int(math.ceil(time_span_sec / time_bin_sec)) + 1
            n_freq_bins = int(math.ceil(freq_span_hz / freq_group_hz))
            if n_time_bins <= maxt and n_freq_bins <= maxw:
                return level
        return levels_sorted[0]

    def _render_waterfall_image(
        self, intensity: np.ndarray, vmin: Optional[float] = None, vmax: Optional[float] = None
    ) -> Tuple[bytes, int, int]:
        """Render intensity grid to PNG bytes.
        
        Args:
            intensity: Intensity array (uint8 or uint16)
            vmin: Optional minimum value for color scale (if None, use data min)
            vmax: Optional maximum value for color scale (if None, use data max)
        """
        # Convert to float for normalization
        if intensity.dtype == np.uint16:
            intensity_float = intensity.astype(np.float32)
        else:
            intensity_float = intensity.astype(np.float32, copy=False)
        
        # Normalize based on vmin/vmax
        if vmin is None:
            vmin = float(np.min(intensity_float))
        if vmax is None:
            vmax = float(np.max(intensity_float))
        
        # Avoid division by zero
        if vmax <= vmin:
            vmax = vmin + 1.0
        
        # Normalize to 0-1 range
        normalized = np.clip((intensity_float - vmin) / (vmax - vmin), 0.0, 1.0)
        
        # Convert to 0-255 range for colormap
        grid_8 = (normalized * 255.0).astype(np.uint8)

        # Build simple heatmap colormap (red->orange->yellow->green->blue->black)
        stops = np.array(
            [
                [255, 0, 0],
                [255, 165, 0],
                [255, 255, 0],
                [0, 255, 0],
                [0, 0, 255],
                [0, 0, 0],
            ],
            dtype=np.float32,
        )
        t = np.linspace(0, 1, len(stops))
        xi = grid_8.astype(np.float32) / 255.0
        idx = np.clip(np.searchsorted(t, xi, side="right") - 1, 0, len(stops) - 2)
        frac = (xi - t[idx]) / np.maximum(t[idx + 1] - t[idx], 1e-6)
        lower = stops[idx]
        upper = stops[idx + 1]
        rgb = (lower + (upper - lower) * frac[..., None]).astype(np.uint8)

        image = Image.fromarray(rgb, mode="RGB")
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue(), image.width, image.height

    def get_waterfall_tile(
        self,
        survey_id: str,
        band_id: str,
        f0: Optional[float],
        f1: Optional[float],
        t0: Optional[float],
        t1: Optional[float],
        maxw: int,
        maxt: int,
        level_id: Optional[str] = None,
        vmin: Optional[float] = None,
        vmax: Optional[float] = None,
    ) -> Tuple[bytes, Dict[str, str]]:
        """Get a waterfall PNG tile for a band."""
        parts = survey_id.split(":")
        if len(parts) != 4:
            raise ValueError(
                f"Invalid survey_id format: {survey_id} (expected 'mission_type:site:sensor:run_id')"
            )
        mission_type, site, sensor, run_id = parts

        run_manifest_path = (
            f"runs/mission_type={mission_type}/site={site}/sensor={sensor}/"
            f"run_id={run_id}/run_manifest.json"
        )

        client = get_minio_client()
        bucket = bucket_name()
        run_manifest = _read_manifest(client, bucket, run_manifest_path)
        if not run_manifest:
            raise ValueError(f"Run manifest not found: {run_manifest_path}")

        bands = run_manifest.get("bands", {})
        band_info = bands.get(band_id)
        if not band_info:
            raise ValueError(f"Band not found in run manifest: {band_id}")

        silver_manifest_paths = band_info.get("silver_manifests", [])
        waterfall_manifests = [
            p for p in silver_manifest_paths if "/product=waterfall/" in p
        ]

        if not waterfall_manifests:
            raise ValueError(f"No waterfall manifests found for band {band_id}")

        manifest_candidates: List[Dict] = []
        for manifest_path in waterfall_manifests:
            manifest = _read_manifest(client, bucket, manifest_path)
            if manifest:
                manifest_candidates.append(manifest)

        if not manifest_candidates:
            raise ValueError(f"Waterfall manifests not readable for band {band_id}")

        manifest_candidates.sort(
            key=lambda m: int(m.get("time_end_unix_sec", 0)), reverse=True
        )
        manifest = manifest_candidates[0]

        levels = manifest.get("levels", [])
        if not levels:
            raise ValueError("Waterfall manifest missing levels")

        time_start_unix = float(manifest.get("time_start_unix_sec", 0))
        time_end_unix = float(manifest.get("time_end_unix_sec", 0))
        if time_end_unix <= time_start_unix:
            raise ValueError("Invalid time range in waterfall manifest")

        start_hz = float(manifest.get("start_hz", 0))
        stop_hz = float(manifest.get("stop_hz", 0))
        step_hz = float(manifest.get("step_hz", 0))

        total_duration_sec = time_end_unix - time_start_unix

        f0_hz = start_hz if f0 is None else float(f0)
        f1_hz = stop_hz if f1 is None else float(f1)
        t0_rel = 0.0 if t0 is None else float(t0)
        t1_rel = total_duration_sec if t1 is None else float(t1)

        f0_hz = max(start_hz, min(f0_hz, stop_hz))
        f1_hz = max(start_hz, min(f1_hz, stop_hz))
        if f1_hz < f0_hz:
            f0_hz, f1_hz = f1_hz, f0_hz

        t0_rel = max(0.0, min(t0_rel, total_duration_sec))
        t1_rel = max(0.0, min(t1_rel, total_duration_sec))
        if t1_rel < t0_rel:
            t0_rel, t1_rel = t1_rel, t0_rel

        level = None
        if level_id:
            for item in levels:
                if str(item.get("level_id")) == str(level_id):
                    level = item
                    break
        if level is None:
            for item in levels:
                if str(item.get("level_id")) == "T0_F0":
                    level = item
                    break
        if level is None:
            level = self._select_waterfall_level(
                levels=levels,
                maxw=maxw,
                maxt=maxt,
                f0_hz=f0_hz,
                f1_hz=f1_hz,
                t0_sec=t0_rel,
                t1_sec=t1_rel,
                step_hz=step_hz,
            )
        if level is None:
            raise ValueError("No suitable waterfall level found")

        data_object = level.get("data_object")
        if not data_object:
            raise ValueError("Waterfall level missing data_object")

        freq_group_size = int(level.get("freq_group_size", 1))
        time_bin_sec = float(level.get("time_bin_sec", 1.0))
        freq_group_hz = step_hz * freq_group_size

        start_time_idx = int(math.floor(t0_rel / time_bin_sec))
        end_time_idx = int(math.ceil(t1_rel / time_bin_sec))

        start_freq_idx = int(math.floor((f0_hz - start_hz) / freq_group_hz))
        end_freq_idx = int(math.ceil((f1_hz - start_hz) / freq_group_hz))

        con = get_connection()
        data_path = f"s3://{bucket}/{data_object}"
        query = """
        SELECT time_bin_index, intensity
        FROM read_parquet($1)
        WHERE time_bin_index >= $2 AND time_bin_index <= $3
        ORDER BY time_bin_index ASC
        """
        try:
            table = con.execute(
                query,
                [data_path, start_time_idx, end_time_idx],
            ).fetch_arrow_table()
        except Exception as e:
            raise ValueError(f"Failed to read waterfall parquet data: {e}")

        if table.num_rows == 0:
            raise ValueError("No waterfall data available for requested range")

        intensity_col = table["intensity"]
        n_rows = table.num_rows
        n_freq_bins = int(level.get("n_freq_bins_level", 0))
        if hasattr(intensity_col, "combine_chunks"):
            intensity_col = intensity_col.combine_chunks()
        intensity_values = intensity_col.values.to_numpy(zero_copy_only=False)
        grid = intensity_values.reshape((n_rows, n_freq_bins))

        start_freq_idx = max(0, min(start_freq_idx, n_freq_bins))
        end_freq_idx = max(0, min(end_freq_idx, n_freq_bins))
        if end_freq_idx <= start_freq_idx:
            end_freq_idx = min(n_freq_bins, start_freq_idx + 1)

        grid = grid[:, start_freq_idx:end_freq_idx]

        if grid.shape[0] > maxt:
            stride = max(1, int(math.ceil(grid.shape[0] / maxt)))
            grid = grid[::stride]
        if grid.shape[1] > maxw:
            stride = max(1, int(math.ceil(grid.shape[1] / maxw)))
            grid = grid[:, ::stride]

        png_bytes, width, height = self._render_waterfall_image(grid, vmin=vmin, vmax=vmax)

        time_start = start_time_idx * time_bin_sec
        time_end = min(total_duration_sec, (end_time_idx + 1) * time_bin_sec)
        freq_start = start_hz + start_freq_idx * freq_group_hz
        freq_end = start_hz + end_freq_idx * freq_group_hz

        headers = {
            "X-Time-Start": str(time_start),
            "X-Time-End": str(time_end),
            "X-Freq-Start": str(freq_start),
            "X-Freq-End": str(freq_end),
            "X-Tile-Width": str(width),
            "X-Tile-Height": str(height),
            "X-Waterfall-Level-Id": str(level.get("level_id")),
            "X-Waterfall-Time-Bin-Sec": str(level.get("time_bin_sec")),
            "X-Waterfall-Freq-Group-Size": str(level.get("freq_group_size")),
        }
        return png_bytes, headers