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
