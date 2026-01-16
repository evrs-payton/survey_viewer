const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

export async function fetchJSON<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

// DataSource API interfaces and functions
export interface SurveyInfo {
  survey_id: string;
  mission_type?: string;
  site?: string;
  sensor?: string;
  run_id?: string;
  year?: number;
  month?: number;
}

export interface SurveyBandInfo {
  band_id: string;
  band_label?: string;
  survey_id: string;
  axis?: {
    start_hz?: number;
    step_hz?: number;
    n_freqs?: number;
    stop_hz?: number;
  };
  capture_duration_sec_active?: number;
}

export interface SurveyHoldsResponse {
  freqs: number[];
  max_hold: number[];
  min_hold: number[];
  avg_hold: number[];
  metadata: {
    band_id: string;
    band_label?: string | null;
    n_traces?: number | null;
    start_hz?: number | null;
    stop_hz?: number | null;
    step_hz?: number | null;
    n_freqs?: number;
    mission_type?: string;
    site?: string;
    sensor?: string;
    run_ids?: string[];
    [key: string]: unknown;
  };
}

export interface AssignmentOverlay {
  assignment_serial: string;
  freq_start_hz: number;
  freq_stop_hz: number;
  center_frequency_hz: number;
  bandwidth_hz: number;
  source_name: string;
}

export interface AssignmentRecord {
  id: number;
  site: string;
  assignment_serial: string;
  source_name: string;
  center_frequency_hz: number;
  bandwidth_hz: number;
  freq_start_hz: number;
  freq_stop_hz: number;
  latitude: number | null;
  longitude: number | null;
  valid_from: string | null;
  valid_to: string | null;
  ingested_at_utc: string | null;
}

export interface ManualRegion {
  id: string;
  site: string;
  freq_start_hz: number;
  freq_stop_hz: number;
  label: string | null;
  color: string | null;
  created_by: string | null;
  created_at_utc: string | null;
}

export interface SignalActivityResponse {
  freqs: number[];
  activity: number[];  // 0..1
  metadata: {
    threshold_method: string;
    noise_percentile?: number;
    margin_db?: number;
    n_bins_active_gt0: number;
    max_activity_fraction: number;
    p95_activity_fraction: number;
  };
}

export interface ActivityRegionsResponse {
  threshold: number;
  regions: Array<{
    start_hz: number;
    stop_hz: number;
  }>;
}

export interface SignalCandidate {
  center_freq_hz: number;
  f_low_99_hz: number;
  f_high_99_hz: number;
  activity_peak?: number;
  activity_mean?: number;
  peak_dbm?: number;
  presence?: number;
  n_traces_hit?: number;
  n_traces_total?: number;
  bw_hz?: number;
}

export interface WaterfallTileParams {
  f0?: number;
  f1?: number;
  t0?: number;
  t1?: number;
  maxw?: number;
  maxt?: number;
  fmt?: 'png' | 'json';
  level_id?: string;
  vmin?: number;
  vmax?: number;
}

export async function getWaterfallTile(
  surveyId: string,
  bandId: string,
  params: WaterfallTileParams
): Promise<{ blob: Blob; headers: Headers }> {
  const query = new URLSearchParams();
  query.set('survey_id', surveyId);
  query.set('band_id', bandId);
  if (params.f0 !== undefined) query.set('f0', params.f0.toString());
  if (params.f1 !== undefined) query.set('f1', params.f1.toString());
  if (params.t0 !== undefined) query.set('t0', params.t0.toString());
  if (params.t1 !== undefined) query.set('t1', params.t1.toString());
  if (params.maxw !== undefined) query.set('maxw', params.maxw.toString());
  if (params.maxt !== undefined) query.set('maxt', params.maxt.toString());
  if (params.fmt) query.set('fmt', params.fmt);
  if (params.level_id) query.set('level_id', params.level_id);
  if (params.vmin !== undefined) query.set('vmin', params.vmin.toString());
  if (params.vmax !== undefined) query.set('vmax', params.vmax.toString());
  const response = await fetch(`${API_BASE}/waterfall/tile?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  const blob = await response.blob();
  return { blob, headers: response.headers };
}

export async function getWaterfallTileData(
  surveyId: string,
  bandId: string,
  params: WaterfallTileParams
): Promise<{ intensity: Array<Array<number | null>>; meta: Record<string, number | string | null> }> {
  const query = new URLSearchParams();
  query.set('survey_id', surveyId);
  query.set('band_id', bandId);
  if (params.f0 !== undefined) query.set('f0', params.f0.toString());
  if (params.f1 !== undefined) query.set('f1', params.f1.toString());
  if (params.t0 !== undefined) query.set('t0', params.t0.toString());
  if (params.t1 !== undefined) query.set('t1', params.t1.toString());
  if (params.maxw !== undefined) query.set('maxw', params.maxw.toString());
  if (params.maxt !== undefined) query.set('maxt', params.maxt.toString());
  query.set('fmt', 'json');
  if (params.level_id) query.set('level_id', params.level_id);
  const response = await fetch(`${API_BASE}/waterfall/tile?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

export async function listSurveys(): Promise<SurveyInfo[]> {
  return fetchJSON<SurveyInfo[]>('/bands/surveys');
}

export async function listSurveyBands(surveyId: string): Promise<SurveyBandInfo[]> {
  const encodedSurveyId = encodeURIComponent(surveyId);
  return fetchJSON<SurveyBandInfo[]>(`/bands/survey/${encodedSurveyId}/bands`);
}

export async function getSurveyHolds(
  surveyId: string,
  bandId: string,
  maxPoints?: number
): Promise<SurveyHoldsResponse> {
  const encodedSurveyId = encodeURIComponent(surveyId);
  const encodedBandId = encodeURIComponent(bandId);
  const query = new URLSearchParams();
  if (maxPoints !== undefined) {
    query.set('max_points', maxPoints.toString());
  }
  const queryString = query.toString() ? `?${query.toString()}` : '';
  return fetchJSON<SurveyHoldsResponse>(`/bands/survey/${encodedSurveyId}/band/${encodedBandId}/holds${queryString}`);
}

export async function getAssignmentOverlays(
  site: string,
  bandStartHz: number,
  bandStopHz: number,
  validOn?: string
): Promise<AssignmentOverlay[]> {
  const query = new URLSearchParams();
  query.set('site', site);
  query.set('band_start_hz', bandStartHz.toString());
  query.set('band_stop_hz', bandStopHz.toString());
  if (validOn !== undefined) {
    query.set('valid_on', validOn);
  }
  return fetchJSON<AssignmentOverlay[]>(`/api/assignments/overlay?${query.toString()}`);
}

export async function listAssignmentSites(): Promise<string[]> {
  return fetchJSON<string[]>('/api/assignments/sites');
}

export async function listAssignmentsForSite(site: string): Promise<AssignmentRecord[]> {
  const encodedSite = encodeURIComponent(site);
  return fetchJSON<AssignmentRecord[]>(`/api/assignments/by-site/${encodedSite}`);
}

export async function uploadAssignmentsFile(
  site: string,
  file: File,
  sourceName?: string
): Promise<void> {
  const formData = new FormData();
  formData.append('site', site);
  if (sourceName) {
    formData.append('source_name', sourceName);
  }
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/api/assignments/import/file`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const data = await response.json();
      if (data?.detail) {
        message = Array.isArray(data.detail)
          ? data.detail.map((d: any) => d.msg ?? String(d)).join('; ')
          : data.detail;
      }
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }
}

export async function deleteAssignment(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/api/assignments/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export async function getManualRegions(
  site: string,
  bandStartHz: number,
  bandStopHz: number
): Promise<ManualRegion[]> {
  const query = new URLSearchParams();
  query.set('site', site);
  query.set('band_start_hz', bandStartHz.toString());
  query.set('band_stop_hz', bandStopHz.toString());
  return fetchJSON<ManualRegion[]>(`/api/manual-regions?${query.toString()}`);
}

export async function createManualRegion(region: {
  site: string;
  freq_start_hz: number;
  freq_stop_hz: number;
  label?: string;
  color?: string;
}): Promise<ManualRegion> {
  const response = await fetch(`${API_BASE}/api/manual-regions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(region),
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as ManualRegion;
}

export async function deleteManualRegion(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/manual-regions/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export async function getSignalActivity(
  surveyId: string,
  bandId: string
): Promise<SignalActivityResponse> {
  const encodedSurveyId = encodeURIComponent(surveyId);
  const encodedBandId = encodeURIComponent(bandId);
  return fetchJSON<SignalActivityResponse>(
    `/bands/survey/${encodedSurveyId}/band/${encodedBandId}/signal-activity`
  );
}

export async function getActivityRegions(
  surveyId: string,
  bandId: string,
  threshold: number
): Promise<ActivityRegionsResponse> {
  const encodedSurveyId = encodeURIComponent(surveyId);
  const encodedBandId = encodeURIComponent(bandId);
  const query = new URLSearchParams();
  query.set('threshold', threshold.toString());
  return fetchJSON<ActivityRegionsResponse>(
    `/bands/survey/${encodedSurveyId}/band/${encodedBandId}/signal-activity/regions?${query.toString()}`
  );
}

export async function getSignalCandidates(
  site: string,
  missionType: string,
  sensor: string,
  runId: string,
  bandId: string,
  minActivityPeak?: number,
  minObwHz?: number,
  maxCandidates?: number
): Promise<SignalCandidate[]> {
  const query = new URLSearchParams();
  query.set('site', site);
  query.set('mission_type', missionType);
  query.set('sensor', sensor);
  query.set('run_id', runId);
  query.set('band_id', bandId);
  if (minActivityPeak !== undefined) {
    query.set('min_activity_peak', minActivityPeak.toString());
  }
  if (minObwHz !== undefined) {
    query.set('min_obw_hz', minObwHz.toString());
  }
  if (maxCandidates !== undefined) {
    query.set('max_candidates', maxCandidates.toString());
  }
  return fetchJSON<SignalCandidate[]>(`/signals/candidates?${query.toString()}`);
}
