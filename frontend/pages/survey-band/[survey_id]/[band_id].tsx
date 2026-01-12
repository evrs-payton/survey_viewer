import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Layout, PlotData } from 'plotly.js';

import { getAssignmentOverlays, getSurveyHolds, getManualRegions, createManualRegion, deleteManualRegion, getSignalActivity, getActivityRegions, type AssignmentOverlay, type SurveyHoldsResponse, type ManualRegion, type SignalActivityResponse, type ActivityRegionsResponse } from '../../../lib/api';

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
  
  // Manual regions state
  const [showManualRegions, setShowManualRegions] = useState<boolean>(false);
  const [manualRegions, setManualRegions] = useState<ManualRegion[] | null>(null);
  const [manualRegionsLoading, setManualRegionsLoading] = useState<boolean>(false);
  const [addRegionMode, setAddRegionMode] = useState<boolean>(false);
  const [editingRegion, setEditingRegion] = useState<{ freq_start: number; freq_stop: number; shapeIndex: number } | null>(null);
  const [showLabelDialog, setShowLabelDialog] = useState<boolean>(false);
  const [pendingRegion, setPendingRegion] = useState<{ freq_start: number; freq_stop: number } | null>(null);
  const [manualRegionLabel, setManualRegionLabel] = useState<string>('');
  const [highlightedManualRegionIndex, setHighlightedManualRegionIndex] = useState<number | null>(null);
  const [showManualRegionLabels, setShowManualRegionLabels] = useState<boolean>(false);

  // Signal activity state
  const [showSignalActivity, setShowSignalActivity] = useState<boolean>(false);
  const [showActivityRegions, setShowActivityRegions] = useState<boolean>(false);
  const [activityThreshold, setActivityThreshold] = useState<number>(0.05);
  const [signalActivityData, setSignalActivityData] = useState<SignalActivityResponse | null>(null);
  const [activityRegions, setActivityRegions] = useState<ActivityRegionsResponse | null>(null);
  const [signalActivityLoading, setSignalActivityLoading] = useState<boolean>(false);
  const [signalActivityError, setSignalActivityError] = useState<string | null>(null);

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

  // Reset manual regions when toggle is disabled or survey/band changes
  useEffect(() => {
    if (!showManualRegions || !holdsData) {
      setManualRegions(null);
      setManualRegionsLoading(false);
      setAddRegionMode(false);
      setEditingRegion(null);
      setShowLabelDialog(false);
      setPendingRegion(null);
    }
  }, [showManualRegions, holdsData, decodedSurveyId, decodedBandId]);

  // Fetch manual regions when toggle is enabled
  useEffect(() => {
    if (!showManualRegions || !holdsData || manualRegions !== null || manualRegionsLoading) return;

    const metadata = holdsData.metadata;
    const startHz = metadata.start_hz;
    const stopHz = metadata.stop_hz;
    // Extract site from survey_id (format: mission_type:site:sensor:run_id)
    const parts = decodedSurveyId.split(':');
    const site = parts.length === 4 ? parts[1] : metadata.site;

    if (!site || startHz === null || startHz === undefined || stopHz === null || stopHz === undefined) {
      return;
    }

    setManualRegionsLoading(true);
    getManualRegions(site, Math.round(startHz), Math.round(stopHz))
      .then((data) => {
        setManualRegions(data);
        setManualRegionsLoading(false);
      })
      .catch((err: any) => {
        console.error('Failed to load manual regions:', err);
        setManualRegions([]);
        setManualRegionsLoading(false);
      });
  }, [showManualRegions, holdsData, manualRegions, manualRegionsLoading, decodedSurveyId]);

  // Reset signal activity when toggle is disabled or survey/band changes
  useEffect(() => {
    if (!showSignalActivity || !holdsData) {
      setSignalActivityData(null);
      setActivityRegions(null);
      setSignalActivityLoading(false);
      setSignalActivityError(null);
    }
  }, [showSignalActivity, holdsData, decodedSurveyId, decodedBandId]);

  // Fetch signal activity when toggle is enabled
  useEffect(() => {
    if (!showSignalActivity || !holdsData || signalActivityData !== null || signalActivityLoading) return;

    setSignalActivityLoading(true);
    setSignalActivityError(null);
    getSignalActivity(decodedSurveyId, decodedBandId)
      .then((data) => {
        setSignalActivityData(data);
        setSignalActivityLoading(false);
      })
      .catch((err: any) => {
        console.error('Failed to load signal activity:', err);
        const errorMsg = err?.message ?? 'Failed to load signal activity';
        setSignalActivityError(errorMsg);
        setSignalActivityLoading(false);
        // Check if it's an axis mismatch error
        if (errorMsg.toLowerCase().includes('axis mismatch')) {
          setShowSignalActivity(false);
          setShowActivityRegions(false);
        }
      });
  }, [showSignalActivity, holdsData, signalActivityData, signalActivityLoading, decodedSurveyId, decodedBandId]);

  // Fetch activity regions when threshold changes (debounced)
  useEffect(() => {
    if (!showActivityRegions || !signalActivityData) {
      setActivityRegions(null);
      return;
    }

    const timeoutId = setTimeout(() => {
      getActivityRegions(decodedSurveyId, decodedBandId, activityThreshold)
        .then((data) => {
          setActivityRegions(data);
        })
        .catch((err: any) => {
          console.error('Failed to load activity regions:', err);
          setActivityRegions(null);
        });
    }, 200); // Debounce 200ms

    return () => clearTimeout(timeoutId);
  }, [showActivityRegions, signalActivityData, activityThreshold, decodedSurveyId, decodedBandId]);

  const traces = useMemo<PlotData[]>(() => {
    if (!holdsData) return [];

    const freqsMHz = holdsData.freqs.map((f) => f / 1e6); // Convert to MHz
    const minHold = holdsData.min_hold;
    const maxHold = holdsData.max_hold;
    const avgHold = holdsData.avg_hold;

    const traces: PlotData[] = [];

    // Add heatmap trace first (renders behind lines)
    if (showSignalActivity && signalActivityData) {
      // Create a heatmap that spans the y-axis by using y values from the power data range
      const activityFreqsMHz = signalActivityData.freqs.map((f) => f / 1e6);
      const activityValues = signalActivityData.activity;
      
      // Calculate y-axis range from holds data to span the full plot height
      const allPowerValues = [...minHold, ...maxHold, ...avgHold].filter(v => !isNaN(v) && isFinite(v));
      const yMin = Math.min(...allPowerValues);
      const yMax = Math.max(...allPowerValues);
      const yRange = yMax - yMin;
      
      // Create y values that span the power range (use enough points for smooth rendering)
      // Use a reasonable number of rows (e.g., 20) to create a smooth vertical gradient
      const numYRows = 20;
      const yValues: number[] = [];
      for (let i = 0; i < numYRows; i++) {
        yValues.push(yMin + (yRange * i) / (numYRows - 1));
      }
      
      // Create a 2D z array by repeating the activity values for each y row
      // This creates a vertical band with the same activity pattern at all y levels
      const zData: number[][] = [];
      for (let i = 0; i < numYRows; i++) {
        zData.push(activityValues);
      }
      
      traces.push({
        x: activityFreqsMHz,
        y: yValues,
        z: zData,
        type: 'heatmap',
        colorscale: 'Viridis',
        showscale: false,
        opacity: 0.3,
        hoverinfo: 'x+z',
        hovertemplate: 'Frequency: %{x:.3f} MHz<br>Activity: %{z:.1%}<extra></extra>',
        zorder: 0, // Behind line traces
      } as PlotData);
    }

    // Add hold line traces
    traces.push(
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
      {
        x: freqsMHz,
        y: minHold,
        type: 'scatter',
        mode: 'lines',
        name: 'Min',
        line: { color: '#ff6b6b', width: 1.5 },
        hoverinfo: 'x+y+name',
      }
    );

    return traces;
  }, [holdsData, showSignalActivity, signalActivityData]);

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

    // Create assignment overlay shapes if overlays are enabled and available
    const assignmentShapes = showOverlays && filteredOverlays && filteredOverlays.length > 0
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
            line: { width: isHighlighted ? 2 : 0, color: isHighlighted ? '#ffcc00' : 'rgba(76, 175, 80, 0.3)' },
            fillcolor: 'rgba(76, 175, 80, 0.3)',
            opacity: isHighlighted ? 0.5 : 0.3,
            hoverinfo: 'skip' as const,
          } as any;
        })
      : [];

    // Create manual region shapes if manual regions are enabled and available
    const manualRegionShapes = showManualRegions && manualRegions && manualRegions.length > 0
      ? manualRegions.map((region, idx) => {
          const isHighlighted = highlightedManualRegionIndex === idx;
          return {
            type: 'rect' as const,
            xref: 'x' as const,
            yref: 'paper' as const,
            x0: region.freq_start_hz / 1e6, // Convert to MHz
            x1: region.freq_stop_hz / 1e6,
            y0: 0,
            y1: 1,
            line: { width: isHighlighted ? 2 : 0, color: isHighlighted ? '#ffcc00' : 'rgba(255, 200, 0, 0.3)' },
            fillcolor: region.color || 'rgba(255, 200, 0, 0.3)',
            opacity: isHighlighted ? 0.5 : 0.3,
            hoverinfo: 'skip' as const,
          } as any;
        })
      : [];

    // Add editable temporary region shape if in editing mode
    // Plotly shapes with editable: true can be dragged and resized by clicking and dragging
    const editingShape = editingRegion ? [{
      type: 'rect' as const,
      xref: 'x' as const,
      yref: 'paper' as const,
      x0: editingRegion.freq_start / 1e6,
      x1: editingRegion.freq_stop / 1e6,
      y0: 0,
      y1: 1,
      line: { width: 2, color: '#ffcc00' },
      fillcolor: 'rgba(255, 200, 0, 0.2)',
      opacity: 0.4,
      hoverinfo: 'skip' as const,
      editable: true,
      layer: 'above' as const,
    } as any] : [];

    // Create activity region shapes if activity regions are enabled and available
    const activityRegionShapes = showActivityRegions && activityRegions && activityRegions.regions.length > 0
      ? activityRegions.regions.map(region => ({
          type: 'rect' as const,
          xref: 'x' as const,
          yref: 'paper' as const,
          x0: region.start_hz / 1e6,
          x1: region.stop_hz / 1e6,
          y0: 0,
          y1: 1,
          line: { width: 0 },
          fillcolor: 'rgba(255, 100, 100, 0.2)',  // Light red
          opacity: 0.3,
          hoverinfo: 'skip' as const,
          layer: 'below' as const,  // Behind other shapes
        } as any))
      : [];

    const shapes = [...assignmentShapes, ...manualRegionShapes, ...activityRegionShapes, ...editingShape];

    // Create label annotations with less strict de-cluttering
    const annotations: any[] = [];
    if (showLabels && showOverlays && filteredOverlays && filteredOverlays.length > 0 && metadata) {
      const startHz = metadata.start_hz;
      const stopHz = metadata.stop_hz;
      
      if (startHz !== null && startHz !== undefined && stopHz !== null && stopHz !== undefined) {
        const totalRangeMHz = (stopHz - startHz) / 1e6;
        
        // Less strict bandwidth threshold: 0.1% of total range (instead of 1%)
        const minBandwidthMHz = totalRangeMHz * 0.001;
        const labelsToShow = filteredOverlays.filter(overlay => {
          const bandwidthMHz = (overlay.freq_stop_hz - overlay.freq_start_hz) / 1e6;
          return bandwidthMHz >= minBandwidthMHz;
        });
        
        // Less strict collision detection: 0.2 MHz minimum spacing (instead of 0.5 MHz)
        const sortedLabels = labelsToShow.sort((a, b) => 
          (a.freq_start_hz + a.freq_stop_hz) / 2 - (b.freq_start_hz + b.freq_stop_hz) / 2
        );
        const visibleLabels: AssignmentOverlay[] = [];
        let lastX = -Infinity;
        const minLabelSpacingMHz = 0.2; // Less strict: 0.2 MHz instead of 0.5 MHz
        
        for (const label of sortedLabels) {
          const centerX = (label.freq_start_hz + label.freq_stop_hz) / 2 / 1e6;
          if (centerX - lastX >= minLabelSpacingMHz) {
            visibleLabels.push(label);
            lastX = centerX;
          }
        }
        
        // Create annotations for visible labels
        annotations.push(...visibleLabels.map((overlay) => ({
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
    }

    // Create manual region label annotations
    if (showManualRegionLabels && showManualRegions && manualRegions && manualRegions.length > 0 && metadata) {
      const startHz = metadata.start_hz;
      const stopHz = metadata.stop_hz;
      
      if (startHz !== null && startHz !== undefined && stopHz !== null && stopHz !== undefined) {
        const totalRangeMHz = (stopHz - startHz) / 1e6;
        const minBandwidthMHz = totalRangeMHz * 0.001;
        
        const labelsToShow = manualRegions.filter(region => {
          const bandwidthMHz = (region.freq_stop_hz - region.freq_start_hz) / 1e6;
          return bandwidthMHz >= minBandwidthMHz;
        });
        
        const sortedLabels = labelsToShow.sort((a, b) => 
          (a.freq_start_hz + a.freq_stop_hz) / 2 - (b.freq_start_hz + b.freq_stop_hz) / 2
        );
        const visibleLabels: ManualRegion[] = [];
        let lastX = -Infinity;
        const minLabelSpacingMHz = 0.2;
        
        for (const label of sortedLabels) {
          const centerX = (label.freq_start_hz + label.freq_stop_hz) / 2 / 1e6;
          if (centerX - lastX >= minLabelSpacingMHz) {
            visibleLabels.push(label);
            lastX = centerX;
          }
        }
        
        // Create annotations for visible manual region labels
        annotations.push(...visibleLabels.map((region) => ({
          x: (region.freq_start_hz + region.freq_stop_hz) / 2 / 1e6,
          y: 0.5,
          text: region.label || 'Unlabeled',
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
    }

    return {
      title: `Band ${bandId}${bandLabel ? ` (${bandLabel})` : ''} — Power Statistics`,
      dragmode: addRegionMode ? 'select' : 'zoom',
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
      annotations: [
        ...annotations,
        ...(showActivityRegions && activityRegions ? [{
          x: 0.02,
          y: 0.98,
          text: `Activity regions: threshold ${(activityRegions.threshold * 100).toFixed(1)}%`,
          showarrow: false,
          xref: 'paper',
          yref: 'paper',
          font: { color: '#f7f7f7', size: 10 },
          bgcolor: 'rgba(0,0,0,0.7)',
          bordercolor: 'rgba(255,100,100,0.5)',
          borderwidth: 1,
          borderpad: 4,
        }] : []),
      ],
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
  }, [holdsData, band_id, zoomRange, showOverlays, filteredOverlays, showLabels, highlightedIndex, showManualRegions, manualRegions, showManualRegionLabels, highlightedManualRegionIndex, addRegionMode, editingRegion, showSignalActivity, showActivityRegions, activityRegions]);

  // Handle box selection for manual region creation
  const handlePlotSelected = useCallback((eventData: any) => {
    if (!addRegionMode || !eventData?.range) return;

    const xRange = eventData.range.x;
    if (xRange && xRange.length === 2) {
      const startMHz = Math.min(xRange[0], xRange[1]);
      const stopMHz = Math.max(xRange[0], xRange[1]);
      const startHz = startMHz * 1e6;
      const stopHz = stopMHz * 1e6;

      // Create editable region
      setEditingRegion({ freq_start: startHz, freq_stop: stopHz, shapeIndex: 0 });
      setAddRegionMode(false);
    }
  }, [addRegionMode]);

  // Handle relayout events to update editing region when shape is moved/resized
  const handleRelayout = useCallback((eventData: any) => {
    // Handle zoom/pan first
    if (eventData['xaxis.range[0]'] && eventData['xaxis.range[1]']) {
      setZoomRange([eventData['xaxis.range[0]'], eventData['xaxis.range[1]']]);
    } else if (eventData['xaxis.autorange']) {
      setZoomRange(undefined);
    }

    // Handle shape editing if we're in editing mode
    // Plotly sends shape updates as 'shapes[0].x0', 'shapes[0].x1', etc.
    if (editingRegion) {
      const shapeKeys = Object.keys(eventData).filter(key => key.startsWith('shapes['));
      if (shapeKeys.length > 0) {
        // Find the editing shape (it's the last one)
        const allShapes = showOverlays && filteredOverlays ? filteredOverlays.length : 0;
        const manualShapes = showManualRegions && manualRegions ? manualRegions.length : 0;
        const editingShapeIndex = allShapes + manualShapes;
        
        const x0Key = `shapes[${editingShapeIndex}].x0`;
        const x1Key = `shapes[${editingShapeIndex}].x1`;
        
        if (eventData[x0Key] !== undefined && eventData[x1Key] !== undefined) {
          const startHz = Math.min(eventData[x0Key], eventData[x1Key]) * 1e6;
          const stopHz = Math.max(eventData[x0Key], eventData[x1Key]) * 1e6;
          setEditingRegion(prev => prev ? { ...prev, freq_start: startHz, freq_stop: stopHz } : null);
        }
      }
    }
  }, [editingRegion, showOverlays, filteredOverlays, showManualRegions, manualRegions]);

  // Handle creating a manual region
  const handleCreateRegion = useCallback(async () => {
    if (!pendingRegion || !holdsData) return;

    const metadata = holdsData.metadata;
    const parts = decodedSurveyId.split(':');
    const site = parts.length === 4 ? parts[1] : metadata.site;

    if (!site) {
      console.error('Cannot create region: site not found');
      return;
    }

    try {
      await createManualRegion({
        site,
        freq_start_hz: Math.round(pendingRegion.freq_start),
        freq_stop_hz: Math.round(pendingRegion.freq_stop),
        label: manualRegionLabel.trim() || undefined,
      });

      // Reload manual regions
      const startHz = metadata.start_hz;
      const stopHz = metadata.stop_hz;
      if (startHz !== null && startHz !== undefined && stopHz !== null && stopHz !== undefined) {
        const data = await getManualRegions(site, Math.round(startHz), Math.round(stopHz));
        setManualRegions(data);
      }

      // Reset state
      setShowLabelDialog(false);
      setPendingRegion(null);
      setManualRegionLabel('');
      setEditingRegion(null);
      setAddRegionMode(false);
    } catch (err: any) {
      console.error('Failed to create manual region:', err);
      alert(`Failed to create manual region: ${err?.message || 'Unknown error'}`);
    }
  }, [pendingRegion, holdsData, decodedSurveyId, manualRegionLabel]);

  // Handle finalizing the editing region (clicking "Done")
  const handleDoneEditing = useCallback(() => {
    if (!editingRegion) return;
    
    setPendingRegion({ freq_start: editingRegion.freq_start, freq_stop: editingRegion.freq_stop });
    setEditingRegion(null);
    setShowLabelDialog(true);
  }, [editingRegion]);

  // Handle canceling region creation
  const handleCancelRegion = useCallback(() => {
    setShowLabelDialog(false);
    setPendingRegion(null);
    setManualRegionLabel('');
    setEditingRegion(null);
    setAddRegionMode(false);
  }, []);

  // Handle deleting a manual region
  const handleDeleteRegion = useCallback(async (regionId: string) => {
    if (!holdsData) return;

    try {
      await deleteManualRegion(regionId);

      // Reload manual regions
      const metadata = holdsData.metadata;
      const parts = decodedSurveyId.split(':');
      const site = parts.length === 4 ? parts[1] : metadata.site;
      const startHz = metadata.start_hz;
      const stopHz = metadata.stop_hz;

      if (site && startHz !== null && startHz !== undefined && stopHz !== null && stopHz !== undefined) {
        const data = await getManualRegions(site, Math.round(startHz), Math.round(stopHz));
        setManualRegions(data);
      }
    } catch (err: any) {
      console.error('Failed to delete manual region:', err);
      alert(`Failed to delete manual region: ${err?.message || 'Unknown error'}`);
    }
  }, [holdsData, decodedSurveyId]);


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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              type="checkbox"
              id="show-manual-regions"
              checked={showManualRegions}
              onChange={(e) => setShowManualRegions(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="show-manual-regions" style={{ color: '#f7f7f7', cursor: 'pointer' }}>
              Show Manual Regions
            </label>
            {manualRegionsLoading && <span style={{ color: '#888', fontSize: '0.9rem' }}>(loading...)</span>}
            {showManualRegions && !editingRegion && (
              <button
                onClick={() => {
                  setAddRegionMode(true);
                  setEditingRegion(null);
                }}
                disabled={addRegionMode}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: addRegionMode ? '#1a1d29' : '#2a2d39',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.25rem',
                  color: addRegionMode ? '#666' : '#f7f7f7',
                  fontSize: '0.9rem',
                  cursor: addRegionMode ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  marginLeft: '0.5rem',
                }}
              >
                {addRegionMode ? 'Selection Mode Active' : '+ Add Region'}
              </button>
            )}
          </div>
          {showManualRegions && manualRegions && manualRegions.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1.5rem' }}>
              <input
                type="checkbox"
                id="show-manual-region-labels"
                checked={showManualRegionLabels}
                onChange={(e) => setShowManualRegionLabels(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="show-manual-region-labels" style={{ color: '#f7f7f7', cursor: 'pointer' }}>
                Show manual region labels
              </label>
            </div>
          )}
          {showManualRegions && addRegionMode && (
            <div style={{ marginLeft: '1.5rem', color: '#ffcc00', fontSize: '0.9rem' }}>
              Selection mode active: Click and drag on the chart to select a region
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              id="show-signal-activity"
              checked={showSignalActivity}
              onChange={(e) => setShowSignalActivity(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="show-signal-activity" style={{ color: '#f7f7f7', cursor: 'pointer' }}>
              Signal activity
            </label>
            {signalActivityLoading && <span style={{ color: '#888', fontSize: '0.9rem' }}>(loading...)</span>}
            {signalActivityError && (
              <span style={{ color: '#ff6b6b', fontSize: '0.9rem' }}>
                Error: {signalActivityError}
              </span>
            )}
          </div>
          {showSignalActivity && signalActivityData && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1.5rem' }}>
                <input
                  type="checkbox"
                  id="show-activity-regions"
                  checked={showActivityRegions}
                  onChange={(e) => setShowActivityRegions(e.target.checked)}
                  disabled={!showSignalActivity}
                  style={{ cursor: showSignalActivity ? 'pointer' : 'not-allowed' }}
                />
                <label 
                  htmlFor="show-activity-regions" 
                  style={{ 
                    color: showSignalActivity ? '#f7f7f7' : '#666', 
                    cursor: showSignalActivity ? 'pointer' : 'not-allowed' 
                  }}
                >
                  Show activity regions
                </label>
              </div>
              {showActivityRegions && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1.5rem', flexWrap: 'wrap' }}>
                  <label 
                    htmlFor="activity-threshold" 
                    style={{ color: '#f7f7f7', fontSize: '0.9rem', minWidth: '100px' }}
                  >
                    Threshold: {(activityThreshold * 100).toFixed(1)}%
                  </label>
                  <input
                    type="range"
                    id="activity-threshold"
                    min="0"
                    max="0.5"
                    step="0.01"
                    value={activityThreshold}
                    onChange={(e) => setActivityThreshold(parseFloat(e.target.value))}
                    disabled={!showActivityRegions}
                    style={{ 
                      flex: '1', 
                      minWidth: '200px',
                      cursor: showActivityRegions ? 'pointer' : 'not-allowed',
                      opacity: showActivityRegions ? 1 : 0.5,
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
        {traces.length > 0 && (
          <div style={{ position: 'relative' }}>
            <Plot
              data={traces}
              layout={layout}
              style={{ width: '100%', height: '600px', display: 'block' }}
              useResizeHandler
              config={{ 
                displaylogo: false, 
                responsive: true,
                editable: editingRegion !== null, // Enable editing when in editing mode
              }}
              onRelayout={handleRelayout}
              onSelected={handlePlotSelected}
            />
            {editingRegion && (
              <div
                style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  zIndex: 1000,
                  background: '#1a1d29',
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  border: '2px solid #ffcc00',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  minWidth: '300px',
                }}
              >
                <div style={{ marginBottom: '1rem', color: '#f7f7f7', fontWeight: 'bold' }}>
                  Adjust Region
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', color: '#f7f7f7', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      Start (MHz):
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      value={(editingRegion.freq_start / 1e6).toFixed(3)}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        if (!isNaN(value) && value >= 0) {
                          const newStartHz = value * 1e6;
                          if (newStartHz < editingRegion.freq_stop) {
                            setEditingRegion({ ...editingRegion, freq_start: newStartHz });
                          }
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '0.4rem',
                        background: '#0c0d10',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '0.25rem',
                        color: '#f7f7f7',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: '#f7f7f7', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      Stop (MHz):
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      value={(editingRegion.freq_stop / 1e6).toFixed(3)}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        if (!isNaN(value) && value >= 0) {
                          const newStopHz = value * 1e6;
                          if (newStopHz > editingRegion.freq_start) {
                            setEditingRegion({ ...editingRegion, freq_stop: newStopHz });
                          }
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '0.4rem',
                        background: '#0c0d10',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '0.25rem',
                        color: '#f7f7f7',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => {
                      setEditingRegion(null);
                      setAddRegionMode(false);
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      background: '#dc3545',
                      border: 'none',
                      borderRadius: '0.25rem',
                      color: '#fff',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDoneEditing}
                    style={{
                      padding: '0.5rem 1rem',
                      background: '#4ecdc4',
                      border: 'none',
                      borderRadius: '0.25rem',
                      color: '#0c0d10',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Overlay Records Panel */}
      {showOverlays && overlays && overlays.length > 0 && (
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

          {filteredOverlays.length > 0 ? (
            <>
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
            </>
          ) : (
            <p style={{ color: '#888', marginTop: '1rem', fontStyle: 'italic' }}>
              No assignments match the filter "{filterText}"
            </p>
          )}
        </section>
      )}

      {/* Manual Regions Panel */}
      {showManualRegions && (
        <section style={{ margin: '2rem 0', padding: '1rem', background: '#0f1320', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ color: '#f7f7f7', fontSize: '1.25rem', margin: 0 }}>Manual Regions</h2>
            <button
              onClick={() => {
                setAddRegionMode(true);
                setRegionSelectionStart(null);
              }}
              disabled={addRegionMode}
              style={{
                padding: '0.5rem 1rem',
                background: addRegionMode ? '#1a1d29' : '#2a2d39',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '0.25rem',
                color: addRegionMode ? '#666' : '#f7f7f7',
                fontSize: '0.9rem',
                cursor: addRegionMode ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
              }}
            >
              {addRegionMode ? 'Selection Mode Active' : 'Add Manual Region'}
            </button>
          </div>

          {manualRegions && manualRegions.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#f7f7f7', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Label</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Center Frequency (MHz)</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Bandwidth (MHz)</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualRegions.map((region, idx) => {
                      const isHighlighted = highlightedManualRegionIndex === idx;
                      // Calculate center frequency and bandwidth from the range
                      const centerHz = (region.freq_start_hz + region.freq_stop_hz) / 2;
                      const bandwidthHz = region.freq_stop_hz - region.freq_start_hz;
                      const centerMHz = centerHz / 1e6;
                      const bandwidthMHz = bandwidthHz / 1e6;
                      return (
                        <tr
                          key={region.id}
                          onMouseEnter={() => setHighlightedManualRegionIndex(idx)}
                          onMouseLeave={() => setHighlightedManualRegionIndex(null)}
                          onClick={() => setHighlightedManualRegionIndex(highlightedManualRegionIndex === idx ? null : idx)}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            cursor: 'pointer',
                            backgroundColor: isHighlighted ? 'rgba(255, 204, 0, 0.2)' : 'transparent',
                            transition: 'background-color 0.15s ease',
                          }}
                        >
                          <td style={{ padding: '0.75rem' }}>{region.label || 'Unlabeled'}</td>
                          <td style={{ padding: '0.75rem' }}>{centerMHz.toFixed(3)}</td>
                          <td style={{ padding: '0.75rem' }}>{bandwidthMHz.toFixed(3)}</td>
                        <td style={{ padding: '0.75rem' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete region "${region.label || 'Unlabeled'}"?`)) {
                                handleDeleteRegion(region.id);
                              }
                            }}
                            style={{
                              padding: '0.25rem 0.5rem',
                              background: '#dc3545',
                              border: 'none',
                              borderRadius: '0.25rem',
                              color: '#fff',
                              fontSize: '0.85rem',
                              cursor: 'pointer',
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: '#888', marginTop: '1rem', fontStyle: 'italic' }}>
              No manual regions yet. Click "Add Manual Region" to create one.
            </p>
          )}
        </section>
      )}

      {/* Label Dialog */}
      {showLabelDialog && pendingRegion && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCancelRegion();
            }
          }}
        >
          <div
            style={{
              background: '#1a1d29',
              padding: '2rem',
              borderRadius: '0.75rem',
              border: '1px solid rgba(255,255,255,0.1)',
              minWidth: '400px',
              maxWidth: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ color: '#f7f7f7', marginBottom: '1rem', fontSize: '1.25rem' }}>Add Manual Region</h3>
            <p style={{ color: '#888', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Frequency range: {(pendingRegion.freq_start / 1e6).toFixed(3)} - {(pendingRegion.freq_stop / 1e6).toFixed(3)} MHz
            </p>
            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="region-label" style={{ display: 'block', color: '#f7f7f7', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Label (optional):
              </label>
              <input
                id="region-label"
                type="text"
                value={manualRegionLabel}
                onChange={(e) => setManualRegionLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateRegion();
                  } else if (e.key === 'Escape') {
                    handleCancelRegion();
                  }
                }}
                placeholder="Enter label..."
                autoFocus
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: '#0c0d10',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.25rem',
                  color: '#f7f7f7',
                  fontSize: '0.9rem',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancelRegion}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#2a2d39',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.25rem',
                  color: '#f7f7f7',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRegion}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#4ecdc4',
                  border: 'none',
                  borderRadius: '0.25rem',
                  color: '#0c0d10',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
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

