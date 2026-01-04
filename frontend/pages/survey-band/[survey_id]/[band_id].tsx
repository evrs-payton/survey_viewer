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
  const [showLabels, setShowLabels] = useState<boolean>(false);
  const [filterText, setFilterText] = useState<string>('');
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

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

  // Filter overlays based on filterText
  const filteredOverlays = useMemo(() => {
    if (!overlays) return [];
    if (!filterText.trim()) return overlays;
    const lowerFilter = filterText.toLowerCase();
    return overlays.filter((overlay) =>
      overlay.assignment_serial.toLowerCase().includes(lowerFilter)
    );
  }, [overlays, filterText]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterText]);

  // Paginate filtered overlays
  const paginatedOverlays = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    return filteredOverlays.slice(startIdx, endIdx);
  }, [filteredOverlays, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredOverlays.length / pageSize);

  const layout = useMemo<Partial<Layout>>(() => {
    const metadata = holdsData?.metadata;
    const bandLabel = metadata?.band_label;
    const bandId = metadata?.band_id || band_id;

    // Create overlay shapes if overlays are enabled and available
    const shapes = showOverlays && filteredOverlays && filteredOverlays.length > 0
      ? filteredOverlays.map((overlay, idx) => {
          const isHighlighted = highlightedIndex === idx;
          return {
            type: 'rect' as const,
            xref: 'x' as const,
            yref: 'paper' as const,
            x0: overlay.freq_start_hz / 1e6, // Convert to MHz
            x1: overlay.freq_stop_hz / 1e6,
            y0: 0,
            y1: 1,
            line: { width: isHighlighted ? 2 : 0, color: isHighlighted ? '#ffcc00' : 'rgba(100, 150, 255, 0.2)' },
            fillcolor: 'rgba(100, 150, 255, 0.2)',
            opacity: isHighlighted ? 0.5 : 0.3,
            hoverinfo: 'skip' as const,
          } as any;
        })
      : [];

    // Create label annotations (de-cluttering disabled for testing)
    const annotations: any[] = [];
    if (showLabels && showOverlays && filteredOverlays && filteredOverlays.length > 0) {
      // Create annotations for all labels (no de-cluttering)
      annotations.push(...filteredOverlays.map((overlay) => ({
        x: (overlay.freq_start_hz + overlay.freq_stop_hz) / 2 / 1e6,
        y: 0.5, // Middle of y-axis (paper coordinates)
        text: overlay.assignment_serial,
        showarrow: false,
        xref: 'x',
        yref: 'paper',
        font: { color: '#f7f7f7', size: 10 },
        bgcolor: 'rgba(0,0,0,0.7)',
        bordercolor: 'rgba(255,255,255,0.3)',
        borderwidth: 1,
        borderpad: 2,
      })));
    }

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
      annotations: annotations.length > 0 ? annotations : [],
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
  }, [holdsData, band_id, zoomRange, showOverlays, filteredOverlays, showLabels, highlightedIndex]);

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

      <section style={{ 
        position: 'sticky', 
        top: 0, 
        zIndex: 100, 
        background: '#0c0d10', 
        paddingBottom: '1rem',
        marginBottom: '1rem',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
          {showOverlays && overlays && overlays.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1.5rem' }}>
              <input
                type="checkbox"
                id="show-labels"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="show-labels" style={{ color: '#f7f7f7', cursor: 'pointer' }}>
                Show assignment labels
              </label>
            </div>
          )}
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

      {/* Overlay Records Panel */}
      {showOverlays && filteredOverlays && filteredOverlays.length > 0 && (
        <section style={{ margin: '2rem 0', padding: '1rem', background: '#0f1320', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 style={{ color: '#f7f7f7', marginBottom: '1rem', fontSize: '1.25rem' }}>Overlay Records</h2>
          
          {/* Filter Input */}
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="Filter by assignment serial..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '400px',
                padding: '0.5rem',
                background: '#1a1d29',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '0.25rem',
                color: '#f7f7f7',
                fontSize: '0.9rem',
              }}
            />
          </div>

          {/* Pagination Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label htmlFor="page-size" style={{ color: '#f7f7f7', fontSize: '0.9rem' }}>Show:</label>
              <select
                id="page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  padding: '0.4rem 0.5rem',
                  background: '#1a1d29',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.25rem',
                  color: '#f7f7f7',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: currentPage === 1 ? '#1a1d29' : '#2a2d39',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.25rem',
                  color: currentPage === 1 ? '#666' : '#f7f7f7',
                  fontSize: '0.9rem',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                }}
              >
                Previous
              </button>
              <span style={{ color: '#f7f7f7', fontSize: '0.9rem' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: currentPage === totalPages ? '#1a1d29' : '#2a2d39',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.25rem',
                  color: currentPage === totalPages ? '#666' : '#f7f7f7',
                  fontSize: '0.9rem',
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                }}
              >
                Next
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#f7f7f7', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Assignment Serial</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Center Frequency (MHz)</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Bandwidth (MHz)</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOverlays.map((overlay, paginatedIdx) => {
                  // Calculate the index in the filtered array for highlighting
                  const filteredIdx = (currentPage - 1) * pageSize + paginatedIdx;
                  const isHighlighted = highlightedIndex === filteredIdx;
                  const centerMHz = overlay.center_frequency_hz / 1e6;
                  const bandwidthMHz = overlay.bandwidth_hz / 1e6;
                  
                  return (
                    <tr
                      key={filteredIdx}
                      onMouseEnter={() => setHighlightedIndex(filteredIdx)}
                      onMouseLeave={() => setHighlightedIndex(null)}
                      onClick={() => setHighlightedIndex(highlightedIndex === filteredIdx ? null : filteredIdx)}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        cursor: 'pointer',
                        backgroundColor: isHighlighted ? 'rgba(255, 204, 0, 0.2)' : 'transparent',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '0.75rem' }}>{overlay.assignment_serial}</td>
                      <td style={{ padding: '0.75rem' }}>{centerMHz.toFixed(3)}</td>
                      <td style={{ padding: '0.75rem' }}>{bandwidthMHz.toFixed(3)}</td>
                      <td style={{ padding: '0.75rem' }}>{overlay.source_name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredOverlays.length === 0 && filterText && (
            <p style={{ color: '#888', marginTop: '1rem', fontStyle: 'italic' }}>
              No assignments match the filter "{filterText}"
            </p>
          )}
        </section>
      )}

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

