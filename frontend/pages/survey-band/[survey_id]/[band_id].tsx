import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Layout, PlotData } from 'plotly.js';

import { getSurveyHolds, type SurveyHoldsResponse } from '../../../../lib/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

type Status = 'idle' | 'loading' | 'error' | 'ready';

function formatFrequency(hz: number): string {
  if (Math.abs(hz) >= 1_000_000_000) return `${(hz / 1_000_000_000).toFixed(3)} GHz`;
  if (Math.abs(hz) >= 1_000_000) return `${(hz / 1_000_000).toFixed(3)} MHz`;
  if (Math.abs(hz) >= 1_000) return `${(hz / 1_000).toFixed(3)} kHz`;
  return `${hz.toFixed(3)} Hz`;
}

function formatSurveyId(surveyId: string): string {
  if (surveyId.startsWith('legacy:')) {
    const parts = surveyId.substring(7).split(':');
    if (parts.length === 2) {
      return `Site: ${parts[0]}, Month: ${parts[1]}`;
    }
  } else if (surveyId.startsWith('rfproc:')) {
    const parts = surveyId.substring(7).split(':');
    if (parts.length === 4) {
      return `Mission: ${parts[0]}, Site: ${parts[1]}, Sensor: ${parts[2]}, Run: ${parts[3]}`;
    }
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

  useEffect(() => {
    if (!survey_id || !band_id) return;

    const decodedSurveyId = decodeURIComponent(survey_id);
    const decodedBandId = decodeURIComponent(band_id);

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
  }, [survey_id, band_id]);

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
  }, [holdsData, band_id, zoomRange]);

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

  const decodedSurveyId = decodeURIComponent(survey_id);
  const decodedBandId = decodeURIComponent(band_id);

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
                Frequency: {formatFrequency(startHz)} - {formatFrequency(stopHz)} | Traces: {nTraces ?? 'N/A'} | Source: {holdsData.source_mode}
              </>
            )}
          </p>
        </div>
      </header>

      <section style={{ margin: '2rem 0' }}>
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
          <dt style={{ fontWeight: 'bold' }}>Source Mode:</dt>
          <dd>{holdsData.source_mode}</dd>
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

