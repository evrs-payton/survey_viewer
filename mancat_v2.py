#!/usr/bin/env python3
"""
mancat_v2.py — Read band parquet files from MinIO bronze, aggregate stats, and
publish a monthly feature parquet to gold/survey/<location>/<YYYY-MM>/feature.parquet.
"""
import argparse
import json
import math
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from minio import Minio  # type: ignore

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover - optional
    yaml = None


DEFAULT_CONFIG_PATH = os.path.expanduser("~/.config/mancat/minio.yaml")
DEFAULT_CACHE_DIR = os.path.expanduser("~/.cache/mancat_minio")


@dataclass
class BandObjects:
    band_index: int
    band_label: Optional[str] = None
    object_keys: List[str] = field(default_factory=list)
    local_paths: List[Path] = field(default_factory=list)
    days: Set[str] = field(default_factory=set)
    run_ids: Set[str] = field(default_factory=set)


@dataclass
class BandStats:
    band_index: int
    band_label: Optional[str]
    start_hz: float
    stop_hz: float
    step_hz: float
    n_traces: int
    n_freqs: int
    unix_time_min: int
    unix_time_max: int
    power_min: float
    power_max: float
    power_mean: float
    mission_type: str
    site: str
    sensor: str
    location: str
    year: str
    month: str
    days: List[str]
    run_ids: List[str]


def load_config(path: Optional[str]) -> Dict:
    if not path:
        return {}
    cfg_path = Path(path).expanduser()
    if not cfg_path.exists():
        return {}
    if cfg_path.suffix.lower() in {".yaml", ".yml"}:
        if yaml is None:
            raise SystemExit("PyYAML is required to read YAML config files.")
        with cfg_path.open("r") as fh:
            return yaml.safe_load(fh) or {}
    with cfg_path.open("r") as fh:
        return json.load(fh)


def parse_month(month_str: str) -> (str, str):
    month_str = month_str.strip()
    if re.fullmatch(r"\d{6}", month_str):
        year, month = month_str[:4], month_str[4:]
    elif re.fullmatch(r"\d{4}-\d{2}", month_str):
        year, month = month_str.split("-", 1)
    else:
        raise SystemExit("Month must be YYYY-MM or YYYYMM (e.g., 2025-12).")
    if not 1 <= int(month) <= 12:
        raise SystemExit("Month must be between 01 and 12.")
    return year, month


def parse_days(day_str: Optional[str]) -> Optional[Set[str]]:
    if not day_str:
        return None
    days = set()
    for part in day_str.split(","):
        part = part.strip()
        if not re.fullmatch(r"\d{2}", part):
            raise SystemExit("Days must be zero-padded (e.g., 01,02,15).")
        days.add(part)
    return days


def normalize_location(loc: str) -> str:
    return loc.strip().replace(" ", "_")


def build_minio_client(endpoint: str, access_key: str, secret_key: str, secure: bool) -> Minio:
    return Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)


def parse_partitions(path_parts: Iterable[str]) -> Dict[str, str]:
    parts = {}
    for part in path_parts:
        if "=" in part:
            k, v = part.split("=", 1)
            parts[k] = v
    return parts


def list_band_parquet_objects(
    client: Minio,
    bucket: str,
    base_prefix: str,
    year: str,
    month: str,
    day_filter: Optional[Set[str]],
    band_label_filter: Optional[str],
    band_index_filter: Optional[int],
    run_id_filter: Optional[str],
) -> Dict[int, BandObjects]:
    band_re = re.compile(r"band(\d+)\.parquet$")
    bands: Dict[int, BandObjects] = {}
    for obj in client.list_objects(bucket, prefix=base_prefix, recursive=True):
        name = obj.object_name
        if not name.endswith(".parquet"):
            continue
        fname = os.path.basename(name)
        m = band_re.match(fname)
        if not m:
            continue
        band_idx = int(m.group(1))
        if band_index_filter is not None and band_idx != band_index_filter:
            continue
        parts = name.split("/")
        partitions = parse_partitions(parts)
        if partitions.get("year") != year or partitions.get("month") != month:
            continue
        day = partitions.get("day")
        if day_filter and (day is None or day not in day_filter):
            continue
        # run_id is no longer in path structure, skip path-based filtering
        band_label = partitions.get("band")
        if band_label_filter and band_label != band_label_filter:
            continue

        entry = bands.setdefault(band_idx, BandObjects(band_index=band_idx))
        entry.object_keys.append(name)
        if band_label:
            entry.band_label = band_label
        if day:
            entry.days.add(day)
        # run_id is no longer in path, so we can't extract it from path
    return bands


def download_band_objects(client: Minio, bucket: str, cache_dir: Path, bands: Dict[int, BandObjects]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    for entry in bands.values():
        entry.local_paths = []
        for obj_key in entry.object_keys:
            dest = cache_dir / obj_key
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists():
                client.fget_object(bucket, obj_key, str(dest))
            entry.local_paths.append(dest)


def _update_min_max(current_min: Optional[float], current_max: Optional[float], array: np.ndarray) -> (float, float):
    arr_min = float(np.nanmin(array))
    arr_max = float(np.nanmax(array))
    if current_min is None:
        current_min = arr_min
    else:
        current_min = min(current_min, arr_min)
    if current_max is None:
        current_max = arr_max
    else:
        current_max = max(current_max, arr_max)
    return current_min, current_max


def compute_band_stats(
    entry: BandObjects,
    mission_type: str,
    site: str,
    sensor: str,
    location: str,
    year: str,
    month: str,
) -> BandStats:
    power_min: Optional[float] = None
    power_max: Optional[float] = None
    power_sum = 0.0
    power_count = 0

    n_traces = 0
    n_freqs: Optional[int] = None
    start_hz = stop_hz = step_hz = None
    unix_time_min: Optional[int] = None
    unix_time_max: Optional[int] = None

    for path in entry.local_paths:
        pf = pq.ParquetFile(path)
        for batch in pf.iter_batches():
            n_traces += batch.num_rows

            # Time span
            tcol = batch.column("unix_time_sec")
            times = tcol.to_numpy(zero_copy_only=False)
            if times.size:
                t_min = int(np.min(times))
                t_max = int(np.max(times))
                unix_time_min = t_min if unix_time_min is None else min(unix_time_min, t_min)
                unix_time_max = t_max if unix_time_max is None else max(unix_time_max, t_max)

            # Frequency axes (assumed constant per band)
            if start_hz is None:
                start_hz = float(batch.column("start_hz")[0].as_py())
                stop_hz = float(batch.column("stop_hz")[0].as_py())
                step_hz = float(batch.column("step_hz")[0].as_py())

            power_col = batch.column("power_dbm")
            list_size = power_col.type.list_size
            if n_freqs is None:
                n_freqs = list_size
            elif n_freqs != list_size:
                raise ValueError(f"Inconsistent frequency bins for band {entry.band_index}")

            power_values = power_col.values.to_numpy(zero_copy_only=False)
            power_np = power_values.reshape((-1, list_size)).astype(np.float64, copy=False)

            power_min, power_max = _update_min_max(power_min, power_max, power_np)
            power_sum += float(np.nansum(power_np))
            power_count += int(power_np.size - np.isnan(power_np).sum())

    if n_freqs is None or start_hz is None or stop_hz is None or step_hz is None:
        raise RuntimeError(f"No data loaded for band {entry.band_index}")

    mean_val = power_sum / power_count if power_count > 0 else math.nan

    return BandStats(
        band_index=entry.band_index,
        band_label=entry.band_label,
        start_hz=start_hz,
        stop_hz=stop_hz,
        step_hz=step_hz,
        n_traces=n_traces,
        n_freqs=n_freqs,
        unix_time_min=unix_time_min or 0,
        unix_time_max=unix_time_max or 0,
        power_min=power_min if power_min is not None else math.nan,
        power_max=power_max if power_max is not None else math.nan,
        power_mean=mean_val,
        mission_type=mission_type,
        site=site,
        sensor=sensor,
        location=location,
        year=year,
        month=month,
        days=sorted(entry.days),
        run_ids=sorted(entry.run_ids),
    )


def write_feature_parquet(stats: List[BandStats], output_path: Path) -> None:
    if not stats:
        raise RuntimeError("No band stats to write.")
    def list_array(items: List[List[str]]):
        return pa.array(items, type=pa.list_(pa.string()))

    table = pa.table({
        "location": [s.location for s in stats],
        "year": [s.year for s in stats],
        "month": [s.month for s in stats],
        "band_index": [s.band_index for s in stats],
        "band_label": [s.band_label for s in stats],
        "start_hz": [s.start_hz for s in stats],
        "stop_hz": [s.stop_hz for s in stats],
        "step_hz": [s.step_hz for s in stats],
        "n_traces": [s.n_traces for s in stats],
        "n_freqs": [s.n_freqs for s in stats],
        "unix_time_min": [s.unix_time_min for s in stats],
        "unix_time_max": [s.unix_time_max for s in stats],
        "power_min": [s.power_min for s in stats],
        "power_max": [s.power_max for s in stats],
        "power_mean": [s.power_mean for s in stats],
        "mission_type": [s.mission_type for s in stats],
        "site": [s.site for s in stats],
        "sensor": [s.sensor for s in stats],
        "days": list_array([s.days for s in stats]),
        "run_ids": list_array([s.run_ids for s in stats]),
    })
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, output_path, compression="zstd")


def write_feature_meta(meta_path: Path, gold_object: str, stats: List[BandStats], source_prefix: str) -> None:
    content = {
        "gold_object": gold_object,
        "bands": len(stats),
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source_prefix": source_prefix,
        "band_indices": [s.band_index for s in stats],
        "days_covered": sorted({d for s in stats for d in s.days}),
        "run_ids": sorted({r for s in stats for r in s.run_ids}),
    }
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(content, indent=2))


def main():
    ap = argparse.ArgumentParser(
        description="Read band parquet from MinIO bronze and publish monthly stats parquet to gold."
    )
    ap.add_argument("--config", default=DEFAULT_CONFIG_PATH, help="YAML/JSON config with MinIO defaults.")
    ap.add_argument("--month", required=True, help="Target month YYYY-MM or YYYYMM.")
    ap.add_argument("--days", help="Comma-separated day list (DD). Default: all days in month.")
    ap.add_argument("--mission-type", default=None, help="Bronze partition: mission_type value.")
    ap.add_argument("--site", default=None, help="Bronze partition: site value.")
    ap.add_argument("--sensor", default=None, help="Bronze partition: sensor value.")
    ap.add_argument("--location", default=None, help="Gold path location; defaults to site.")
    ap.add_argument("--run-id", default=None, help="Optional run_id filter for bronze.")
    ap.add_argument("--band-label", default=None, help="Optional band= filter (e.g., 915.000-925.000MHz).")
    ap.add_argument("--band-index", type=int, default=None, help="Optional band index filter (e.g., 0).")
    ap.add_argument("--bronze-prefix", default=None, help="Override bronze prefix (else derived from mission/site/sensor).")
    ap.add_argument("--bucket", default=None, help="MinIO bucket (default: rf-lake).")
    ap.add_argument("--endpoint", default=None, help="MinIO endpoint host:port.")
    ap.add_argument("--access-key", default=None, help="MinIO access key.")
    ap.add_argument("--secret-key", default=None, help="MinIO secret key.")
    ap.add_argument("--use-ssl", action="store_true", help="Use HTTPS for MinIO.")
    ap.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR, help="Local cache for downloaded parquet.")
    ap.add_argument("--output", default="feature.parquet", help="Local output path for feature parquet.")
    ap.add_argument("--meta-output", default="feature_meta.json", help="Local output path for meta JSON.")
    ap.add_argument("--dry-run", action="store_true", help="List matching objects without processing.")
    ap.add_argument("--list-bands", action="store_true", help="List matching bands then exit.")
    args = ap.parse_args()

    cfg = load_config(args.config)

    def pick(key, default=None):
        val = getattr(args, key, None)
        if val is not None:
            return val
        return cfg.get(key, default)

    endpoint = pick("endpoint")
    access_key = pick("access_key")
    secret_key = pick("secret_key")
    bucket = pick("bucket", "rf-lake")
    mission_type = pick("mission_type", "survey")
    site = pick("site", "lab")
    sensor = pick("sensor", "unknown")
    location = pick("location", site)

    if not (endpoint and access_key and secret_key):
        raise SystemExit("MinIO endpoint/access/secret are required (via config or CLI).")

    year, month = parse_month(args.month)
    day_filter = parse_days(args.days)

    # New path structure: bronze/mission_type={m}/site={s}/year={y}/month={m}/day={d}/sensor={s}/band={b}/
    if args.bronze_prefix:
        base_prefix = args.bronze_prefix
    else:
        # Build prefix with new structure - include year/month, day will be filtered in list_band_parquet_objects
        base_prefix = f"bronze/mission_type={mission_type}/site={site}/year={year}/month={month}/"

    client = build_minio_client(endpoint, access_key, secret_key, secure=args.use_ssl)
    bands = list_band_parquet_objects(
        client=client,
        bucket=bucket,
        base_prefix=base_prefix,
        year=year,
        month=month,
        day_filter=day_filter,
        band_label_filter=args.band_label,
        band_index_filter=args.band_index,
        run_id_filter=args.run_id,
    )

    if not bands:
        print("No matching band parquet objects found.")
        return

    print(f"Found {len(bands)} band(s) in bronze:")
    for idx, entry in sorted(bands.items()):
        days = ", ".join(sorted(entry.days)) if entry.days else "all days"
        runs = ", ".join(sorted(entry.run_ids)) if entry.run_ids else "all run_ids"
        print(f"  band{idx} ({entry.band_label or 'unknown'}): {len(entry.object_keys)} files, days: {days}, runs: {runs}")

    if args.dry_run or args.list_bands:
        return

    cache_dir = Path(args.cache_dir).expanduser()
    download_band_objects(client, bucket, cache_dir, bands)

    stats: List[BandStats] = []
    for entry in bands.values():
        stats.append(
            compute_band_stats(
                entry=entry,
                mission_type=mission_type,
                site=site,
                sensor=sensor,
                location=normalize_location(location),
                year=year,
                month=month,
            )
        )

    feature_path = Path(args.output)
    write_feature_parquet(stats, feature_path)

    gold_prefix = f"gold/survey/{normalize_location(location)}/{year}-{month}"
    gold_object = f"{gold_prefix}/feature.parquet"
    meta_path = Path(args.meta_output)
    write_feature_meta(meta_path, gold_object, stats, base_prefix)

    print(f"Uploading feature parquet to s3://{bucket}/{gold_object}")
    client.fput_object(bucket, gold_object, str(feature_path))
    meta_object = f"{gold_prefix}/feature_meta.json"
    print(f"Uploading feature meta to s3://{bucket}/{meta_object}")
    client.fput_object(bucket, meta_object, str(meta_path))
    print("Done.")


if __name__ == "__main__":
    main()
