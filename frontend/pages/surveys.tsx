import { useEffect, useState } from 'react';
import Link from 'next/link';

import { listSurveys, listSurveyBands, type SurveyInfo, type SurveyBandInfo } from '../lib/api';

type Status = 'idle' | 'loading' | 'error' | 'ready';

function formatMonthYear(year: number, month: number): string {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${monthNames[month - 1]} ${year}`;
}

function formatSurveyId(survey: SurveyInfo): string {
  const site = survey.site || '';
  if (survey.year !== undefined && survey.month !== undefined) {
    return `${site} - ${formatMonthYear(survey.year, survey.month)}`;
  }
  // Fallback to original format if date info not available
  const parts = survey.survey_id.split(':');
  if (parts.length === 4) {
    return `Mission: ${parts[0]}, Site: ${parts[1]}, Sensor: ${parts[2]}, Run: ${parts[3]}`;
  }
  return survey.survey_id;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(0)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (minutes === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${minutes}m`;
  }
}

export default function SurveysPage() {
  const [surveys, setSurveys] = useState<SurveyInfo[]>([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string>('');
  const [bands, setBands] = useState<SurveyBandInfo[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [bandsError, setBandsError] = useState<string | null>(null);

  // Load surveys on mount
  useEffect(() => {
    setStatus('loading');
    setError(null);
    listSurveys()
      .then((data) => {
        setSurveys(data);
        if (data.length > 0 && !selectedSurveyId) {
          setSelectedSurveyId(data[0].survey_id);
        }
        setStatus('ready');
      })
      .catch((err) => {
        const errorMessage = err?.message || 'Unknown error';
        console.error('Failed to load surveys', err);
        setError(`Failed to load surveys: ${errorMessage}`);
        setStatus('error');
      });
  }, []);

  // Load bands when survey changes
  useEffect(() => {
    if (!selectedSurveyId) {
      setBands([]);
      setBandsError(null);
      return;
    }

    setStatus('loading');
    setBandsError(null);
    listSurveyBands(selectedSurveyId)
      .then((data) => {
        setBands(data);
        setStatus('ready');
        console.log(`Loaded ${data.length} bands for survey ${selectedSurveyId}`);
      })
      .catch((err) => {
        const errorMessage = err?.message || 'Unknown error';
        console.error('Failed to load bands', {
          surveyId: selectedSurveyId,
          error: err,
          message: errorMessage,
          stack: err?.stack
        });
        setBandsError(`Failed to load bands for survey: ${errorMessage}`);
        setStatus('error');
        setBands([]);
      });
  }, [selectedSurveyId]);

  const handleBandClick = (surveyId: string, bandId: string) => {
    const encodedSurveyId = encodeURIComponent(surveyId);
    const encodedBandId = encodeURIComponent(bandId);
    const url = `/survey-band/${encodedSurveyId}/${encodedBandId}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">RF Spectrum Explorer</p>
          <h1>Surveys</h1>
          <p className="muted">Browse surveys and bands from rfproc data.</p>
        </div>
        <div className="controls">
          <Link href="/" className="button">
            Home
          </Link>
        </div>
      </header>

      {error && (
        <div className="error-banner" style={{ padding: '1rem', margin: '1rem', backgroundColor: '#fee', border: '1px solid #fcc', borderRadius: '4px', color: '#c00' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {bandsError && (
        <div className="error-banner" style={{ padding: '1rem', margin: '1rem', backgroundColor: '#fee', border: '1px solid #fcc', borderRadius: '4px', color: '#c00' }}>
          <strong>Error loading bands:</strong> {bandsError}
        </div>
      )}

      <section style={{ padding: '1rem' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="survey-select" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Select Survey:
          </label>
          <select
            id="survey-select"
            value={selectedSurveyId}
            onChange={(e) => setSelectedSurveyId(e.target.value)}
            style={{ padding: '0.5rem', minWidth: '400px', fontSize: '1rem' }}
            disabled={status === 'loading' || surveys.length === 0}
          >
            {surveys.length === 0 ? (
              <option value="">{status === 'loading' ? 'Loading surveys...' : 'No surveys available'}</option>
            ) : (
              surveys.map((survey) => (
                <option key={survey.survey_id} value={survey.survey_id}>
                  {formatSurveyId(survey)}
                </option>
              ))
            )}
          </select>
        </div>

        {status === 'loading' && <p className="muted">Loading bands...</p>}
        {status === 'ready' && bands.length === 0 && selectedSurveyId && !bandsError && (
          <p className="muted">No bands found for selected survey.</p>
        )}

        <section className="band-grid">
          {bands.map((band) => (
            <article key={`${band.survey_id}-${band.band_id}`} className="band-card">
              <div className="band-card__heading">
                <h2>{band.band_label ?? `Band ${band.band_id}`}</h2>
              </div>
              <dl className="band-card__meta">
                <div className="meta-row">
                  <dt>Survey ID</dt>
                  <dd style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>{band.survey_id}</dd>
                </div>
                {band.capture_duration_sec_active !== undefined && (
                  <div className="meta-row">
                    <dt>Capture Duration</dt>
                    <dd>{formatDuration(band.capture_duration_sec_active)}</dd>
                  </div>
                )}
                {band.axis && (
                  <>
                    {band.axis.start_hz !== undefined && (
                      <div className="meta-row">
                        <dt>Start Hz</dt>
                        <dd>{band.axis.start_hz.toLocaleString()}</dd>
                      </div>
                    )}
                    {band.axis.stop_hz !== undefined && (
                      <div className="meta-row">
                        <dt>Stop Hz</dt>
                        <dd>{band.axis.stop_hz.toLocaleString()}</dd>
                      </div>
                    )}
                    {band.axis.n_freqs !== undefined && (
                      <div className="meta-row">
                        <dt>Frequency Bins</dt>
                        <dd>{band.axis.n_freqs.toLocaleString()}</dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
              <button
                onClick={() => handleBandClick(band.survey_id, band.band_id)}
                className="button-link"
              >
                Open Band Detail (New Tab)
              </button>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

