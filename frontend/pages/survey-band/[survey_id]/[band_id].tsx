import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Layout, PlotData } from 'plotly.js';

import { getAssignmentOverlays, getSurveyHolds, type AssignmentOverlay, type SurveyHoldsResponse } from '../../../lib/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

type Status = 'idle' | 'loading' | 'error' | 'ready';

function formatFrequency(hz: number): string {
  if (Math.abs(hz) >= 1_000_000_000) return `${(hz / 1_000_000_000).toFixed(3)} GHz`;
  if (Math.abs(hz) >= 1_000_000) return `${(hz / 1_000_000).toFixed(3)} MHz`;
  if (Math.abs(hz) >= 1_000) return `${(hz / 1_000).toFixed(3)} kHz`;
  return `${hz.toFixed(3)} Hz`;
}

function formatSurveyId(surveyId: string): string {
  const parts = surveyId.split(':');
  if (parts.length === 4) {
    return `Mission: ${parts[0]}, Site: ${parts[1]}, Sensor: ${parts[2]}, Run: ${parts[3]}`;
  }
  return surveyId;
}

export default function SurveyBandDetailPage() {
  const router = useRouter();
  const { survey_id, band_id } = router.query as {
    survey_id?: string;
    band_id?: string;
  };

  const [holdsData, setHoldsData] = useState<SurveyHoldsResponse | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number] | undefined>(undefined);
  const [showOverlays, setShowOverlays] = useState<boolean>(false);
  const [overlays, setOverlays] = useState<AssignmentOverlay[] | null>(null);
  const [overlaysLoading, setOverlaysLoading] = useState<boolean>(false);

  const decodedSurveyId = survey_id ? decodeURIComponent(survey_id) : '';
  const decodedBandId = band_id ? decodeURIComponent(band_id) : '';

  useEffect(() => {
    if (!survey_id || !band_id) return;

    setStatus('loading');
    setError(null);

    getSurveyHolds(decodedSurveyId, decodedBandId, 50000)
      .then((data) => {
        setHoldsData(data);
        setStatus('ready');
      })
      .catch((err: any) => {
        setError(err?.message ?? 'Failed to load band data');
        setStatus('error');
      });
  }, [survey_id, band_id, decodedSurveyId, decodedBandId]);

  // Reset overlays when toggle is disabled or survey/band changes
  useEffect(() => {
    if (!showOverlays || !holdsData) {
      setOverlays(null);
      setOverlaysLoading(false);
    }
  }, [showOverlays, holdsData, decodedSurveyId, decodedBandId]);

  // Fetch overlays when toggle is enabled
  useEffect(() => {
    if (!showOverlays || !holdsData || overlays !== null || overlaysLoading) return;

    const metadata = holdsData.metadata;
    const startHz = metadata.start_hz;
    const stopHz = metadata.stop_hz;
    // Extract site from survey_id (format: mission_type:site:sensor:run_id)
    const parts = decodedSurveyId.split(':');
    const site = parts.length === 4 ? parts[1] : metadata.site;

    if (!site || startHz === null || startHz === undefined || stopHz === null || stopHz === undefined) {
      return;
    }

    setOverlaysLoading(true);
    getAssignmentOverlays(site, Math.round(startHz), Math.round(stopHz))
      .then((data) => {
        setOverlays(data);
        setOverlaysLoading(false);
      })
      .catch((err: any) => {
        console.error('Failed to load assignment overlays:', err);
        setOverlays([]);
        setOverlaysLoading(false);
      });
  }, [showOverlays, holdsData, overlays, overlaysLoading, decodedSurveyId]);

  const traces = useMemo<PlotData[]>(() => {
    if (!holdsData) return [];

    const freqsMHz = holdsData.freqs.map((f) => f / 1e6); // Convert to MHz
    const minHold = holdsData.min_hold;
    const maxHold = holdsData.max_hold;
    const avgHold = holdsData.avg_hold;

    return [
      {
        x: freqsMHz,
        y: minHold,
        type: 'scatter',
        mode: 'lines',
        name: 'Min',
        line: { color: '#ff6b6b', width: 1.5 },
        hoverinfo: 'x+y+name',
      },
      {
        x: freqsMHz,
        y: avgHold,
        type: 'scatter',
        mode: 'lines',
        name: 'Mean',
        line: { color: '#4ecdc4', width: 2 },
        hoverinfo: 'x+y+name',
      },
      {
        x: freqsMHz,
        y: maxHold,
        type: 'scatter',
        mode: 'lines',
        name: 'Max',
        line: { color: '#ffa500', width: 1.5 },
        hoverinfo: 'x+y+name',
      },
    ];
  }, [holdsData]);

  const layout = useMemo<Partial<Layout>>(() => {
    const metadata = holdsData?.metadata;
    const bandLabel = metadata?.band_label;
    const bandId = metadata?.band_id || band_id;

    // Create overlay shapes if overlays are enabled and available
    const shapes = showOverlays && overlays && overlays.length > 0
      ? overlays.map((overlay) => ({
          type: 'rect' as const,
          xref: 'x' as const,
          yref: 'paper' as const,
          x0: overlay.freq_start_hz / 1e6, // Convert to MHz
          x1: overlay.freq_stop_hz / 1e6,
          y0: 0,
          y1: 1,
          line: { width: 0 },
          fillcolor: 'rgba(100, 150, 255, 0.2)',
          opacity: 0.3,
        }))
      : [];

    return {
      title: `Band ${bandId}${bandLabel ? ` (${bandLabel})` : ''} — Power Statistics`,
      dragmode: 'zoom',
      margin: { l: 64, r: 32, t: 80, b: 72 },
      paper_bgcolor: '#0c0d10',
      plot_bgcolor: '#0c0d10',
      font: { color: '#f7f7f7' },
      xaxis: {
        title: 'Frequency (MHz)',
        range: zoomRange,
        showline: true,
        mirror: true,
        ticks: 'outside',
        tickcolor: '#888',
        ticklen: 6,
        tickwidth: 1,
        automargin: true,
      },
      yaxis: {
        title: 'Power (dBm)',
        autorange: true,
        zeroline: false,
        showline: true,
        mirror: true,
        automargin: true,
      },
      shapes,
      showlegend: true,
      legend: {
        orientation: 'h',
        x: 0,
        y: 1.12,
        xanchor: 'left',
        yanchor: 'bottom',
        bgcolor: 'rgba(0,0,0,0)',
      },
    };
  }, [holdsData, band_id, zoomRange, showOverlays, overlays]);

  const handleRelayout = useCallback((eventData: any) => {
    if (eventData['xaxis.range[0]'] && eventData['xaxis.range[1]']) {
      setZoomRange([eventData['xaxis.range[0]'], eventData['xaxis.range[1]']]);
    } else if (eventData['xaxis.autorange']) {
      setZoomRange(undefined);
    }
  }, []);

  if (!survey_id || !band_id) {
    return (
      <main className="app-shell">
        <p>Loading...</p>
      </main>
    );
  }

  if (status === 'loading') {
    return (
      <main className="app-shell">
        <p>Loading band data...</p>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="app-shell">
        <header className="app-header">
          <h1>Error</h1>
          <p className="error">{error || 'Failed to load band data'}</p>
        </header>
      </main>
    );
  }

  if (!holdsData) {
    return (
      <main className="app-shell">
        <p>No data available</p>
      </main>
    );
  }

  const metadata = holdsData.metadata;
  const startHz = metadata.start_hz ?? null;
  const stopHz = metadata.stop_hz ?? null;
  const nTraces = metadata.n_traces ?? null;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Band Detail</p>
          <h1>
            Band {metadata.band_id}
            {metadata.band_label && ` — ${metadata.band_label}`}
          </h1>
          <p className="muted">
            Survey: {formatSurveyId(decodedSurveyId)}
            {startHz !== null && stopHz !== null && (
              <>
                <br />
                Frequency: {formatFrequency(startHz)} - {formatFrequency(stopHz)} | Traces: {nTraces ?? 'N/A'}
              </>
            )}
          </p>
        </div>
      </header>

      <section style={{ margin: '2rem 0' }}>
        <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            id="show-overlays"
            checked={showOverlays}
            onChange={(e) => setShowOverlays(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="show-overlays" style={{ color: '#f7f7f7', cursor: 'pointer' }}>
            Show Assignment Overlays
          </label>
          {overlaysLoading && <span style={{ color: '#888', fontSize: '0.9rem' }}>(loading...)</span>}
        </div>
        {traces.length > 0 && (
          <Plot
            data={traces}
            layout={layout}
            style={{ width: '100%', height: '600px', display: 'block' }}
            useResizeHandler
            config={{ displaylogo: false, responsive: true }}
            onRelayout={handleRelayout}
          />
        )}
      </section>

      <section style={{ padding: '1rem', marginTop: '2rem' }}>
        <h2 style={{ color: '#f7f7f7', marginBottom: '1rem' }}>Metadata</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '0.5rem 1rem', color: '#f7f7f7' }}>
          <dt style={{ fontWeight: 'bold' }}>Band ID:</dt>
          <dd>{metadata.band_id}</dd>
          {metadata.band_label && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Band Label:</dt>
              <dd>{metadata.band_label}</dd>
            </>
          )}
          {metadata.n_traces !== null && metadata.n_traces !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Traces:</dt>
              <dd>{metadata.n_traces.toLocaleString()}</dd>
            </>
          )}
          {metadata.start_hz !== null && metadata.start_hz !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Start Frequency:</dt>
              <dd>{formatFrequency(metadata.start_hz)}</dd>
            </>
          )}
          {metadata.stop_hz !== null && metadata.stop_hz !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Stop Frequency:</dt>
              <dd>{formatFrequency(metadata.stop_hz)}</dd>
            </>
          )}
          {metadata.step_hz !== null && metadata.step_hz !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Step Frequency:</dt>
              <dd>{formatFrequency(metadata.step_hz)}</dd>
            </>
          )}
          {metadata.n_freqs !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Frequency Bins:</dt>
              <dd>{metadata.n_freqs.toLocaleString()}</dd>
            </>
          )}
          {metadata.site && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Site:</dt>
              <dd>{metadata.site}</dd>
            </>
          )}
          {metadata.mission_type && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Mission Type:</dt>
              <dd>{metadata.mission_type}</dd>
            </>
          )}
          {metadata.sensor && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Sensor:</dt>
              <dd>{metadata.sensor}</dd>
            </>
          )}
          {metadata.run_ids && metadata.run_ids.length > 0 && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Run IDs:</dt>
              <dd>{metadata.run_ids.join(', ')}</dd>
            </>
          )}
        </dl>
      </section>
    </main>
  );
}

