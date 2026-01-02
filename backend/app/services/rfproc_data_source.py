"""rfproc gold/silver data source adapter.

Reads new rfproc gold products from MinIO using run manifests as discovery index.
"""

from __future__ import annotations

import json
import math
import tempfile
from typing import Dict, List, Optional

import numpy as np

from .data_source import DataSource
from .duck import get_connection
from .legacy_data_source import _downsample_arrays
from .minio_client import bucket_name, get_minio_client


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


class RfprocGoldSilverDataSource(DataSource):
    """Data source adapter for rfproc gold/silver products.

    Reads from: gold/mission_type={mission_type}/site={site}/sensor={sensor}/run_id={run_id}/band_id={band_id}/product=holds/
    Survey ID format: rfproc:{mission_type}:{site}:{sensor}:{run_id}
    Uses run manifests as discovery index (runs/.../run_manifest.json)
    """

    def list_surveys(self, filters: Dict) -> List[Dict]:
        """List available surveys from run manifests.

        Args:
            filters: Optional filter dictionary (currently unused)

        Returns:
            List of survey dictionaries with 'survey_id' in format 'rfproc:{mission_type}:{site}:{sensor}:{run_id}'
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

            # Optionally check run manifest status (for efficiency, we could skip this and filter in list_bands)
            # For now, include all run manifests; filtering by status can happen in list_bands
            survey_id = f"rfproc:{mission_type}:{site}:{sensor}:{run_id}"
            if survey_id not in surveys:
                surveys[survey_id] = {
                    "survey_id": survey_id,
                    "mission_type": mission_type,
                    "site": site,
                    "sensor": sensor,
                    "run_id": run_id,
                }

        return sorted(surveys.values(), key=lambda x: x["survey_id"])

    def list_bands(self, survey_id: str) -> List[Dict]:
        """List bands for a survey by reading run manifest.

        Args:
            survey_id: Survey identifier in format 'rfproc:{mission_type}:{site}:{sensor}:{run_id}'

        Returns:
            List of band dictionaries with band identifiers and metadata
        """
        # Parse survey_id
        if not survey_id.startswith("rfproc:"):
            raise ValueError(f"Invalid rfproc survey_id format: {survey_id}")
        parts = survey_id[7:].split(":")  # Remove 'rfproc:' prefix
        if len(parts) != 4:
            raise ValueError(f"Invalid rfproc survey_id format: {survey_id}")
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
            result.append(
                {
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
            )

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
            survey_id: Survey identifier in format 'rfproc:{mission_type}:{site}:{sensor}:{run_id}'
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
        if not survey_id.startswith("rfproc:"):
            raise ValueError(f"Invalid rfproc survey_id format: {survey_id}")
        parts = survey_id[7:].split(":")
        if len(parts) != 4:
            raise ValueError(f"Invalid rfproc survey_id format: {survey_id}")
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
            table = con.execute(f"SELECT * FROM read_parquet('{data_path}')").arrow()
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
            "run_id": run_id,
        }

        return {
            "freqs": arrays["freqs"].tolist(),
            "max_hold": arrays["max_hold"].tolist(),
            "min_hold": arrays["min_hold"].tolist(),
            "avg_hold": arrays["avg_hold"].tolist(),
            "metadata": metadata,
            "source_mode": "rfproc",
        }

