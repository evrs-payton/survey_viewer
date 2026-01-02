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
