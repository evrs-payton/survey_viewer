"""Tests for shard-aware gold waterfall handling in RfprocGoldSilverDataSource."""

from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from app.services.rfproc_data_source import RfprocGoldSilverDataSource


class DummyArrowColumn:
    """Minimal column wrapper to mimic PyArrow column slices used in _build_waterfall_grid."""

    def __init__(self, values: np.ndarray):
        self._values = values

    def to_numpy(self, zero_copy_only: bool = False):
        return np.asarray(self._values)


class DummyArrowTable:
    """Very small stand-in for the Arrow table returned by DuckDB."""

    def __init__(self, time_bin_index: np.ndarray, intensity: np.ndarray):
        # intensity is shape (n_rows, n_freq_bins) of uint16 / uint8
        self._time_bin_index = DummyArrowColumn(time_bin_index.astype(np.int32))
        # Simulate FixedSizeListArray backing array: flattened values buffer
        flat = intensity.reshape(-1)
        self._intensity_values = flat
        self._n_freq_bins = intensity.shape[1]
        self._num_rows = intensity.shape[0]

    @property
    def num_rows(self) -> int:
        return self._num_rows

    def __getitem__(self, name: str):
        if name == "time_bin_index":
            return self._time_bin_index
        if name == "intensity":
            # Minimal object exposing .values.to_numpy() and optional combine_chunks()
            class _IntensityCol:
                def __init__(self, values: np.ndarray):
                    self.values = pa.array(values)

                def combine_chunks(self):
                    return self

            return _IntensityCol(self._intensity_values)
        raise KeyError(name)


class DummyDuckConnection:
    """Stub DuckDB connection that returns a pre-built Arrow-like table."""

    def __init__(self, table: DummyArrowTable):
        self._table = table

    def execute(self, query: str, params: List) -> "DummyDuckConnection":
        # Ignore query/params, always return self with attached table.
        return self

    def fetch_arrow_table(self) -> DummyArrowTable:
        return self._table


@pytest.fixture
def data_source(monkeypatch) -> RfprocGoldSilverDataSource:
    """Provide a data source with get_connection patched to our dummy connection."""
    ds = RfprocGoldSilverDataSource()

    # Build a tiny dummy grid: 4 time bins x 3 freq bins.
    time_indices = np.array([0, 1, 2, 3], dtype=np.int32)
    intensity = np.array(
        [
            [10, 20, 30],
            [40, 50, 60],
            [70, 80, 90],
            [100, 110, 120],
        ],
        dtype=np.uint16,
    )
    table = DummyArrowTable(time_indices, intensity)
    dummy_con = DummyDuckConnection(table)

    def _dummy_get_connection():
        return dummy_con

    monkeypatch.setattr("app.services.rfproc_data_source.get_connection", _dummy_get_connection)
    return ds


def _build_gold_manifest(
    *, sharded: bool
) -> Tuple[Dict, Dict, Dict]:
    """Construct a minimal run_manifest, band_info, and gold waterfall manifest."""
    run_manifest = {
        "bands": {
            "band_001": {
                "band_label": "test-band",
                "axis": {
                    "start_hz": 100.0,
                    "step_hz": 1.0,
                    "n_freqs": 3,
                    "stop_hz": 103.0,
                },
                # silver_manifests not used when gold is present
                "silver_manifests": [],
            }
        }
    }
    level = {
        "level_id": "T0_F0",
        "time_bin_sec": 1.0,
        "freq_group_size": 1,
        "n_time_bins": 4,
        "n_freq_bins_level": 3,
        "display_min_dbm": -120.0,
        "display_max_dbm": 0.0,
    }
    if sharded:
        level["sharded"] = True
        level["shard_window_bins"] = 4
        level["shards"] = [
            {
                "data_object": "gold/.../shard=bin_0_3/data.parquet",
                "bin_start_index": 0,
                "bin_end_index": 3,
                "n_time_bins": 4,
                "time_start_unix_sec": 0,
                "time_end_unix_sec": 3,
            }
        ]
    else:
        level["data_object"] = "gold/.../level=T0_F0/data.parquet"

    gold_manifest = {
        "manifest_kind": "gold_run_waterfall",
        "product_type": "waterfall",
        "status": "success",
        "start_hz": 100.0,
        "step_hz": 1.0,
        "n_freqs": 3,
        "stop_hz": 103.0,
        "time_start_unix_sec": 0,
        "time_end_unix_sec": 4,
        "intensity_bits": 16,
        "levels": [level],
    }
    band_info = run_manifest["bands"]["band_001"]
    return run_manifest, band_info, gold_manifest


def test_build_waterfall_grid_nonsharded_gold(monkeypatch, data_source: RfprocGoldSilverDataSource) -> None:
    """_build_waterfall_grid should handle a non-sharded gold waterfall manifest."""
    run_manifest, band_info, gold_manifest = _build_gold_manifest(sharded=False)

    def _dummy_read_manifest(_client, _bucket, path: str):
        if path.endswith("/run_manifest.json"):
            return run_manifest
        if "/product=waterfall/" in path:
            return gold_manifest
        return None

    def _dummy_get_minio_client():
        class _C:
            pass

        return _C()

    monkeypatch.setattr("app.services.rfproc_data_source._read_manifest", _dummy_read_manifest)
    monkeypatch.setattr("app.services.rfproc_data_source.get_minio_client", _dummy_get_minio_client)
    monkeypatch.setattr("app.services.rfproc_data_source.bucket_name", lambda: "dummy-bucket")

    grid, headers, meta = data_source._build_waterfall_grid(
        survey_id="survey:site:sensor:run_001",
        band_id="band_001",
        f0=None,
        f1=None,
        t0=None,
        t1=None,
        maxw=1600,
        maxt=600,
        level_id=None,
        downsample_mode="mean",
    )

    assert grid.shape[0] > 0 and grid.shape[1] == 3
    assert headers["X-Waterfall-Level-Id"] == "T0_F0"
    assert meta["intensity_bits"] == 16
    assert meta["display_min_dbm"] == -120.0
    assert meta["display_max_dbm"] == 0.0


def test_build_waterfall_grid_sharded_gold(monkeypatch, data_source: RfprocGoldSilverDataSource) -> None:
    """_build_waterfall_grid should read from shard data_objects for gold waterfalls."""
    run_manifest, band_info, gold_manifest = _build_gold_manifest(sharded=True)

    def _dummy_read_manifest(_client, _bucket, path: str):
        if path.endswith("/run_manifest.json"):
            return run_manifest
        if "/product=waterfall/" in path:
            return gold_manifest
        return None

    def _dummy_get_minio_client():
        class _C:
            pass

        return _C()

    monkeypatch.setattr("app.services.rfproc_data_source._read_manifest", _dummy_read_manifest)
    monkeypatch.setattr("app.services.rfproc_data_source.get_minio_client", _dummy_get_minio_client)
    monkeypatch.setattr("app.services.rfproc_data_source.bucket_name", lambda: "dummy-bucket")

    grid, headers, meta = data_source._build_waterfall_grid(
        survey_id="survey:site:sensor:run_001",
        band_id="band_001",
        f0=None,
        f1=None,
        t0=None,
        t1=None,
        maxw=1600,
        maxt=600,
        level_id=None,
        downsample_mode="mean",
    )

    # Grid shape and metadata should be consistent with non-sharded case.
    assert grid.shape[0] > 0 and grid.shape[1] == 3
    assert headers["X-Waterfall-Level-Id"] == "T0_F0"
    assert meta["intensity_bits"] == 16
    assert meta["display_min_dbm"] == -120.0
    assert meta["display_max_dbm"] == 0.0

