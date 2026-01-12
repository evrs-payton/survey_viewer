# Migration Notes: rfproc Gold/Silver Support

This document describes the schema differences between legacy gold products and new rfproc gold/silver products, and how the survey_viewer backend adapts between them.

## Survey Identity

### Survey ID Format

The system uses opaque `survey_id` strings that encode mode-specific identifiers. Backend routes accept `survey_id` as an opaque string; adapters parse and interpret the format.

- **Legacy format**: `legacy:{site}:{yyyy-mm}`
  - Example: `legacy:Lask:2025-01`
  - Components: mode prefix (`legacy:`), site name, year-month in `YYYY-MM` format
  - URI-safe: Uses colons as separators

- **rfproc format**: `rfproc:{mission_type}:{site}:{sensor}:{run_id}`
  - Example: `rfproc:survey:Lask:CRFS:run01`
  - Components: mode prefix (`rfproc:`), mission_type, site, sensor, run_id
  - URI-safe: Uses colons as separators

### Parsing Logic

- Routes receive `survey_id` as-is and pass to adapter factory
- Factory selects adapter based on `DATA_SOURCE_MODE` env var
- Adapter checks `survey_id` prefix to validate format:
  - Legacy adapter expects `legacy:` prefix, splits remainder to extract `[site, yyyy-mm]`
  - rfproc adapter expects `rfproc:` prefix, splits remainder to extract `[mission_type, site, sensor, run_id]`
- Invalid format or prefix mismatch raises `ValueError` with descriptive message
- Adapters are responsible for parsing; routes treat `survey_id` as opaque

## Legacy Gold Schema

- **Path**: `gold/survey/{site}/{YYYY-MM}/band{band_index}_holds.parquet`
- **Format**: Parquet with per-frequency rows
- **Columns**: 
  - `freq_hz` (float64) - Frequency in Hz
  - `power_min`, `power_max`, `power_mean` (float32) - Hold statistics
  - Metadata columns: `meta_site`, `meta_band_label`, `meta_total_traces`, `meta_freq_start_hz`, `meta_freq_stop_hz`, `meta_freq_step_hz`, etc.
- **Discovery**: Path-based discovery from `gold/survey/` prefix
- **No manifests**: Direct parquet files
- **Grouping**: Each file represents one band for one site/month combination

### File Naming Convention

Files follow the pattern: `band{band_index}_holds.parquet` where `band_index` is an integer (0-based).

## New rfproc Gold Schema

- **Path**: `gold/mission_type={mission_type}/site={site}/sensor={sensor}/run_id={run_id}/band_id={band_id}/product=holds/data.parquet`
- **Manifest**: `gold/mission_type={mission_type}/site={site}/sensor={sensor}/run_id={run_id}/band_id={band_id}/product=holds/manifest.json`
- **Format**: Single-row parquet with FixedSizeList arrays
- **Columns**:
  - `min_hold_dbm`, `max_hold_dbm`, `avg_hold_dbm` (FixedSizeList[float32]) - Arrays of length `n_freqs`
  - `start_hz`, `step_hz`, `stop_hz` (float64) - Frequency axis definition
  - `n_freqs` (int32) - Number of frequency bins
  - `band_id`, `band_label` (string) - Band identifiers
  - `n_traces_total` (int64) - Total trace count
- **Discovery**: 
  - Use run manifests as discovery index: `runs/mission_type={mission_type}/site={site}/sensor={sensor}/run_id={run_id}/run_manifest.json`
  - Run manifest contains `bands` field listing available bands (band_id, band_label, axis info)
  - Gold manifest paths are constructed deterministically from survey_id + band_id
  - Gold manifests/data are read lazily only when user requests specific band
- **Manifest fields**: `status="success"`, `band_id`, `band_label`, axis info, `data_object`, `manifest_object`
- **Grouping**: Each gold product represents one band for one run_id

### Run Manifest Structure

Run manifests (`run_manifest.json`) contain:
- `bands`: Dictionary mapping `band_id` to band information including:
  - `band_id`, `band_label`
  - `axis`: `{start_hz, step_hz, n_freqs, stop_hz}`
  - `silver_manifests`: List of contributing silver manifest paths

## Key Differences

1. **Structure**: 
   - Legacy = per-frequency rows (one row per frequency bin)
   - rfproc = single row with FixedSizeList arrays (all frequency bins in one row)

2. **Discovery**: 
   - Legacy = path parsing from `gold/survey/` prefix (list directory, parse filenames)
   - rfproc = run manifest index (list `runs/.../run_manifest.json`, then read run manifest to get bands, construct gold paths deterministically)

3. **Grouping**: 
   - Legacy = site/month (multiple bands per site/month, identified by band_index)
   - rfproc = run_id/band_id (multiple bands per run_id, identified by band_id)

4. **Frequency axis**: 
   - Legacy = explicit `freq_hz` column (one value per row)
   - rfproc = generated as `freqs[i] = start_hz + i * step_hz` for `i in range(n_freqs)` (guarantees exact length match with FixedSizeList arrays of length `n_freqs`, avoids floating-point drift from `arange`)

5. **Lazy loading**: 
   - Legacy = all data read when listing/querying
   - rfproc = only opens gold manifest/data when user requests specific band (not during discovery)

6. **Hold statistics column names**:
   - Legacy = `power_min`, `power_max`, `power_mean`
   - rfproc = `min_hold_dbm`, `max_hold_dbm`, `avg_hold_dbm`

## Frontend Mapping

Frontend expects normalized format: `{ freqs: number[], max_hold: number[], min_hold: number[], avg_hold: number[] }`

### Legacy Mapping

- `freqs` = `freq_hz` column (extracted directly)
- `max_hold` = `power_max` column
- `min_hold` = `power_min` column  
- `avg_hold` = `power_mean` column

### rfproc Mapping

- `freqs` = generated as `freqs[i] = start_hz + i * step_hz` for `i in range(n_freqs)` (ensures exact length match with holds arrays)
- `max_hold` = `max_hold_dbm` array (extracted from FixedSizeList)
- `min_hold` = `min_hold_dbm` array (extracted from FixedSizeList)
- `avg_hold` = `avg_hold_dbm` array (extracted from FixedSizeList)

### Normalization

Both adapters normalize to the same frontend format:
- Legacy adapter maps `power_max` → `max_hold`, `power_min` → `min_hold`, `power_mean` → `avg_hold`
- rfproc adapter extracts arrays and uses same key names
- Frequency axis is always `freqs` regardless of source
- All arrays have matching lengths (enforced by frequency axis generation formula)

## Performance Considerations

### Downsampling

Holds arrays can be very large (tens of thousands to hundreds of thousands of frequency bins). Converting FixedSizeList arrays to Python lists for JSON serialization can be memory-intensive and slow.

The backend supports optional `max_points` query parameter:
- If `n_freqs > max_points`: decimate arrays by taking every k-th point where `k = ceil(n_freqs / max_points)`
- Apply decimation to all arrays uniformly: `freqs`, `max_hold`, `min_hold`, `avg_hold`
- Downsampling occurs before converting to Python lists (process numpy/pyarrow arrays)
- Example: if `n_freqs = 100000` and `max_points = 50000`, take every 2nd point (k=2)

## Discovery Strategy (rfproc)

To avoid scanning all gold manifests (which would be expensive), rfproc mode uses run manifests as a discovery index:

1. **list_surveys()**: Lists `runs/.../run_manifest.json` files (just listing objects, no manifest reads)
2. **list_bands(survey_id)**: Reads the run manifest once, extracts `bands` field
3. **get_holds(survey_id, band_id)**: Constructs gold manifest path deterministically, reads manifest and data lazily

This approach scales well because:
- Discovery only lists run manifest paths (cheap)
- Band listing reads one run manifest per survey (moderate cost)
- Gold data is only read when user requests it (expensive operation, but on-demand)

## Signal Activity Overlay

The signal activity visualization feature provides two capabilities:

1. **Heat underlay**: A frequency heatmap displayed behind hold lines showing `activity_fraction` (0..1) per frequency bin
2. **Threshold regions**: Shaded vertical spans where activity >= user-controlled threshold

### Data Source

Signal activity data is read from **gold products** (`product=signal_activity`) per band. The gold product pre-computes run-level aggregation using **per-bin maximum** across all days in the run:

- Gold product path: `gold/mission_type={mission_type}/site={site}/sensor={sensor}/run_id={run_id}/band_id={band_id}/product=signal_activity/data.parquet`
- For each frequency bin `i`: `activity_run[i] = max(activity_fraction[i])` across all days (computed during gold product creation)
- This shows the peak activity per frequency bin across the entire run

**Note**: The gold product must be created first using `rfproc gold signal-activity` before the backend can serve signal activity data.

### Backend Implementation

**Endpoints**:
- `GET /bands/survey/{survey_id}/band/{band_id}/signal-activity` - Returns signal activity data from gold product
- `GET /bands/survey/{survey_id}/band/{band_id}/signal-activity/regions?threshold=0.05` - Returns thresholded regions

**Service Method**: `RfprocGoldSilverDataSource.get_signal_activity()`
- Constructs gold manifest path deterministically from survey_id and band_id
- Reads gold manifest and validates status == "success"
- Reads gold parquet data (single parquet read, no aggregation needed)
- Extracts `activity_fraction` array and generates frequency axis
- Returns: `{freqs: List[float], activity: List[float], metadata: Dict}`

**Region Extraction**: `_extract_activity_regions()`
- Input: `activity[]`, `freqs[]`, `threshold` (0..1)
- Output: Contiguous frequency spans where `activity >= threshold`
- Merges adjacent/overlapping bins into clean spans

**Error Handling**:
- Axis mismatch: Returns 422 with structured error `{error: "axis_mismatch", message: "..."}`
- No products found: Returns 404
- Other errors: Returns 400 with error message

### Frontend Implementation

**UI Controls** (all off by default):
- Toggle: "Signal activity" - Enables/disables heatmap underlay
- Toggle: "Show activity regions" - Enables/disables threshold regions (disabled if signal activity is off)
- Slider: Threshold (0..0.5, default 0.05, step 0.01) - Controls region threshold (disabled if regions are off)

**Visualization**:
- **Heatmap**: Single-row Plotly heatmap trace with:
  - `zorder: 0` (renders behind line traces)
  - `opacity: 0.3`
  - `colorscale: 'Viridis'`
  - Tooltip shows frequency and activity percentage
- **Regions**: Vertical rectangles (`layout.shapes`) with:
  - `layer: 'below'` (renders behind assignment/manual region shapes)
  - Light red fill (`rgba(255, 100, 100, 0.2)`)
  - Legend annotation: "Activity regions: threshold X%"

**Performance**:
- Signal activity data is cached per band (only fetched once when toggle is enabled)
- Threshold slider changes are debounced (200ms) before fetching regions
- Regions are only fetched if signal activity data is already loaded

**Default State**: All features are **off by default** to ensure zero behavior change for existing users.

