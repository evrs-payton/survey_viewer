export interface BandMeta {
  id: string;
  meta: Record<string, unknown>;
}

export type SummaryResponse = Record<string, number[]> & { freqs: number[] };

export interface PeakRequest {
  curve: string;
  height?: number;
  prominence?: number;
  distance?: number;
  f0?: number;
  f1?: number;
}

export interface PeakItem {
  freq: number;
  value: number;
  properties: Record<string, number>;
}

export interface MarkersPayload {
  markers: Marker[];
}

export interface Marker {
  id: string;
  freq: number;
  label?: string;
  color?: string;
  width?: number;
}

export interface PlaybackTick {
  t0: number;
  t1: number;
  cursor_unix: number;
}

export interface FeatureRow {
  location: string;
  year: string;
  month: string;
  band_index: number;
  band_label?: string | null;
  start_hz: number;
  stop_hz: number;
  step_hz: number;
  n_traces: number;
  n_freqs: number;
  unix_time_min: number;
  unix_time_max: number;
  power_min: number;
  power_max: number;
  power_mean: number;
  mission_type: string;
  site: string;
  sensor: string;
  days: string[];
  run_ids: string[];
}

export interface FeatureSchema {
  path: string;
  schema: { column: string; type: string; null: string; key: string; default: string; extra: string }[];
}

export interface BronzeBandInfo {
  band_index: number;
  band_label?: string | null;
  days: string[];
  run_ids: string[];
  object_keys: string[];
}

export interface FeatureLocations {
  locations: string[];
}

export interface FeatureMonths {
  location: string;
  months: string[];
}

export interface BronzeBandSummary {
  band_index: number;
  band_label?: string | null;
  n_traces: number;
  start_hz: number;
  stop_hz: number;
  step_hz: number;
  unix_time_min: number | null;
  unix_time_max: number | null;
  days: string[];
  stats: { freq_hz: number; power_min: number; power_max: number; power_mean: number }[];
  source?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

export async function fetchJSON<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function getBands(): Promise<BandMeta[]> {
  return fetchJSON<BandMeta[]>('/bands');
}

export async function getBandMeta(id: string): Promise<Record<string, unknown>> {
  return fetchJSON<Record<string, unknown>>(`/bands/${id}/meta`);
}

export async function getSummary(
  id: string,
  params: { f0?: number; f1?: number; max_pts?: number } = {}
): Promise<SummaryResponse> {
  const query = new URLSearchParams();
  if (params.f0 !== undefined) query.set('f0', params.f0.toString());
  if (params.f1 !== undefined) query.set('f1', params.f1.toString());
  if (params.max_pts !== undefined) query.set('max_pts', params.max_pts.toString());
  const url = `/bands/${id}/summary${query.toString() ? `?${query}` : ''}`;
  return fetchJSON<SummaryResponse>(url);
}

export interface WaterfallTileResponse {
  blob: Blob;
  headers: Headers;
}

export async function getWaterfallTile(
  id: string,
  params: { f0?: number; f1?: number; t0?: number; t1?: number; maxw?: number; maxt?: number; fmt?: string } = {}
): Promise<WaterfallTileResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const response = await fetch(
    `${API_BASE}/bands/${id}/waterfall_tile${query.toString() ? `?${query}` : ''}`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch waterfall tile');
  }
  const blob = await response.blob();
  return { blob, headers: response.headers };
}

export async function postPeaks(id: string, payload: PeakRequest): Promise<PeakItem[]> {
  const response = await fetch(`${API_BASE}/bands/${id}/peaks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    let details = '';
    try {
      const text = await response.text();
      details = text ? ` — ${text}` : '';
    } catch {}
    throw new Error(`Failed to detect peaks (HTTP ${response.status})${details}`);
  }
  const data = (await response.json()) as { peaks: PeakItem[] };
  return data.peaks;
}

export async function getMarkers(id: string): Promise<Marker[]> {
  const payload = await fetchJSON<MarkersPayload>(`/bands/${id}/markers`);
  return payload.markers;
}

export async function saveMarkers(id: string, markers: Marker[]): Promise<Marker[]> {
  const response = await fetch(`${API_BASE}/bands/${id}/markers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ markers })
  });
  if (!response.ok) {
    throw new Error('Failed to save markers');
  }
  const payload = (await response.json()) as MarkersPayload;
  return payload.markers;
}

export function createPlaybackSocket(
  id: string,
  params: { window_s?: number; fps?: number } = {}
): WebSocket {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const wsUrl = new URL(`${API_BASE.replace(/^http/, 'ws')}/ws/bands/${id}`);
  if ([...query.keys()].length) {
    wsUrl.search = query.toString();
  }
  return new WebSocket(wsUrl.toString());
}

export async function getFeature(params: {
  location: string;
  month: string;
  band_index?: number;
  band_label?: string;
  day?: string;
  run_id?: string;
  limit?: number;
}): Promise<FeatureRow[]> {
  const query = new URLSearchParams();
  query.set('location', params.location);
  query.set('month', params.month);
  if (params.band_index !== undefined) query.set('band_index', params.band_index.toString());
  if (params.band_label !== undefined) query.set('band_label', params.band_label);
  if (params.day !== undefined) query.set('day', params.day);
  if (params.run_id !== undefined) query.set('run_id', params.run_id);
  if (params.limit !== undefined) query.set('limit', params.limit.toString());
  return fetchJSON<FeatureRow[]>(`/feature?${query.toString()}`);
}

export async function getFeatureSchema(location: string, month: string): Promise<FeatureSchema> {
  const query = new URLSearchParams({ location, month });
  return fetchJSON<FeatureSchema>(`/feature/schema?${query.toString()}`);
}

export async function listBronzeBands(params: {
  mission_type: string;
  site: string;
  sensor: string;
  year: string;
  month: string;
  day?: string;
  band_index?: number;
  band_label?: string;
  run_id?: string;
}): Promise<{ count: number; bands: BronzeBandInfo[] }> {
  const query = new URLSearchParams({
    mission_type: params.mission_type,
    site: params.site,
    sensor: params.sensor,
    year: params.year,
    month: params.month
  });
  if (params.day) query.set('day', params.day);
  if (params.band_index !== undefined) query.set('band_index', params.band_index.toString());
  if (params.band_label !== undefined) query.set('band_label', params.band_label);
  if (params.run_id !== undefined) query.set('run_id', params.run_id);
  return fetchJSON<{ count: number; bands: BronzeBandInfo[] }>(`/bronze/bands?${query.toString()}`);
}

export async function getFeatureLocations(): Promise<FeatureLocations> {
  return fetchJSON<FeatureLocations>('/feature/locations');
}

export async function getFeatureMonths(location: string): Promise<FeatureMonths> {
  const query = new URLSearchParams({ location });
  return fetchJSON<FeatureMonths>(`/feature/months?${query.toString()}`);
}

export async function getBronzeBandSummary(
  band_index: number,
  params: {
    mission_type: string;
    site: string;
    sensor: string;
    year: string;
    month: string;
    day?: string;
    run_id?: string;
    use_feature?: boolean;
  }
): Promise<BronzeBandSummary> {
  const query = new URLSearchParams({
    mission_type: params.mission_type,
    site: params.site,
    sensor: params.sensor,
    year: params.year,
    month: params.month
  });
  if (params.day) query.set('day', params.day);
  if (params.run_id) query.set('run_id', params.run_id);
  if (params.use_feature !== undefined) query.set('use_feature', params.use_feature.toString());
  return fetchJSON<BronzeBandSummary>(`/bronze/band/${band_index}/summary?${query.toString()}`);
}

export interface Assignment {
  lat: number;
  long: number;
  center_freq_hz: number;
  bandwidth_hz: number;
  label: string;
}

export interface AssignmentsResponse {
  location: string;
  month: string;
  assignments: Assignment[];
}

export async function uploadAssignments(
  location: string,
  month: string,
  file: File
): Promise<{ message: string; location: string; month: string; rows: number; path: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE}/assignments/upload?location=${encodeURIComponent(location)}&month=${encodeURIComponent(month)}`, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${text}`);
  }
  return response.json();
}

export async function getAssignments(location: string, month: string): Promise<AssignmentsResponse> {
  const query = new URLSearchParams({ location, month });
  return fetchJSON<AssignmentsResponse>(`/assignments?${query.toString()}`);
}

export async function createAssignment(
  location: string,
  month: string,
  assignment: Assignment
): Promise<AssignmentsResponse> {
  const query = new URLSearchParams({ location, month });
  const response = await fetch(`${API_BASE}/assignments?${query.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(assignment)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create assignment: ${text}`);
  }
  return (await response.json()) as AssignmentsResponse;
}

export async function deleteAssignment(
  location: string,
  month: string,
  assignment: { center_freq_hz: number; bandwidth_hz: number }
): Promise<AssignmentsResponse> {
  const query = new URLSearchParams({ location, month });
  const response = await fetch(`${API_BASE}/assignments?${query.toString()}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(assignment)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to delete assignment: ${text}`);
  }
  return (await response.json()) as AssignmentsResponse;
}

export interface BronzeSitesResponse {
  sites: string[];
}

export interface BronzeMonthsResponse {
  site: string;
  months: string[];
}

export interface BronzeBandInfo {
  band_index: number;
  band_label?: string | null;
  mission_type: string;
  sensor: string;
  year: string;
  month: string;
  days: string[];
  run_ids: string[];
}

export interface BronzeBandsBySiteMonthResponse {
  site: string;
  year: string;
  month: string;
  count: number;
  bands: BronzeBandInfo[];
}

export async function listBronzeSites(): Promise<BronzeSitesResponse> {
  return fetchJSON<BronzeSitesResponse>('/bronze/sites');
}

export async function listBronzeMonths(site: string): Promise<BronzeMonthsResponse> {
  const query = new URLSearchParams({ site });
  return fetchJSON<BronzeMonthsResponse>(`/bronze/months?${query.toString()}`);
}

export async function listBandsBySiteMonth(site: string, year: string, month: string): Promise<BronzeBandsBySiteMonthResponse> {
  const query = new URLSearchParams({ site, year, month });
  return fetchJSON<BronzeBandsBySiteMonthResponse>(`/bronze/bands-by-site-month?${query.toString()}`);
}

// DataSource API interfaces and functions
export interface SurveyInfo {
  survey_id: string;
  site?: string;
  month?: string;
  mission_type?: string;
  sensor?: string;
  run_id?: string;
}

export interface SurveyBandInfo {
  band_id: string;
  band_index?: number;
  band_label?: string;
  survey_id: string;
  axis?: {
    start_hz?: number;
    step_hz?: number;
    n_freqs?: number;
    stop_hz?: number;
  };
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
    band_index?: number;
    unix_time_min?: number | null;
    unix_time_max?: number | null;
    days?: string[];
    [key: string]: unknown;
  };
  source_mode: 'legacy' | 'rfproc';
}

export interface DataSourceModeResponse {
  mode: 'legacy' | 'rfproc';
}

export async function getDataSourceMode(): Promise<DataSourceModeResponse> {
  return fetchJSON<DataSourceModeResponse>('/bands/mode');
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