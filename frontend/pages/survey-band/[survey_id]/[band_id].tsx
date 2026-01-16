import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Layout, PlotData } from 'plotly.js';

import { getAssignmentOverlays, getSurveyHolds, getManualRegions, createManualRegion, deleteManualRegion, getSignalActivity, getActivityRegions, getSignalCandidates, type AssignmentOverlay, type SurveyHoldsResponse, type ManualRegion, type SignalActivityResponse, type ActivityRegionsResponse, type SignalCandidate } from '../../../lib/api';
import Waterfall from '../../../components/Waterfall';

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
  const [waterfallBounds, setWaterfallBounds] = useState<{ f0?: number; f1?: number; t0?: number; t1?: number }>({});
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

  // Signal candidates state
  const [showSignalCandidates, setShowSignalCandidates] = useState<boolean>(false);
  const [showCandidateLabels, setShowCandidateLabels] = useState<boolean>(false);
  const [signalCandidates, setSignalCandidates] = useState<SignalCandidate[] | null>(null);
  const [signalCandidatesLoading, setSignalCandidatesLoading] = useState<boolean>(false);
  const [signalCandidatesError, setSignalCandidatesError] = useState<string | null>(null);
  const [highlightedCandidateIndex, setHighlightedCandidateIndex] = useState<number | null>(null);

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  
  // Waterfall display state
  const [showWaterfall, setShowWaterfall] = useState<boolean>(true);
  const [waterfallVmin, setWaterfallVmin] = useState<number | undefined>(undefined);
  const [waterfallVmax, setWaterfallVmax] = useState<number | undefined>(undefined);
  const [waterfallDownsample, setWaterfallDownsample] = useState<'mean' | 'max'>('mean');

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

  // Reset signal candidates when toggle is disabled or survey/band changes
  useEffect(() => {
    if (!showSignalCandidates || !holdsData) {
      setSignalCandidates(null);
      setSignalCandidatesLoading(false);
      setSignalCandidatesError(null);
    }
  }, [showSignalCandidates, holdsData, decodedSurveyId, decodedBandId]);

  // Fetch signal candidates when toggle is enabled
  useEffect(() => {
    if (!showSignalCandidates || !holdsData || signalCandidates !== null || signalCandidatesLoading) return;

    // Extract params from survey_id (format: mission_type:site:sensor:run_id)
    const parts = decodedSurveyId.split(':');
    if (parts.length !== 4) {
      setSignalCandidatesError('Invalid survey_id format');
      setSignalCandidatesLoading(false);
      return;
    }

    const [missionType, site, sensor, runId] = parts;

    setSignalCandidatesLoading(true);
    setSignalCandidatesError(null);
    getSignalCandidates(site, missionType, sensor, runId, decodedBandId)
      .then((data) => {
        setSignalCandidates(data);
        setSignalCandidatesLoading(false);
      })
      .catch((err: any) => {
        console.error('Failed to load signal candidates:', err);
        const errorMsg = err?.message ?? 'Failed to load signal candidates';
        setSignalCandidatesError(errorMsg);
        setSignalCandidatesLoading(false);
        setSignalCandidates([]);
      });
  }, [showSignalCandidates, holdsData, signalCandidates, signalCandidatesLoading, decodedSurveyId, decodedBandId]);

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

    // Add candidate center frequency markers if signal candidates are enabled
    if (showSignalCandidates && signalCandidates && signalCandidates.length > 0 && holdsData) {
      // Calculate y-axis range from holds data
      const allPowerValues = [...minHold, ...maxHold, ...avgHold].filter(v => !isNaN(v) && isFinite(v));
      const yMin = Math.min(...allPowerValues);
      const yMax = Math.max(...allPowerValues);
      
      signalCandidates.forEach((candidate, idx) => {
        const isHighlighted = highlightedCandidateIndex === idx;
        traces.push({
          x: [candidate.center_freq_hz / 1e6, candidate.center_freq_hz / 1e6],
          y: [yMin, yMax],
          type: 'scatter',
          mode: 'lines',
          line: { color: isHighlighted ? '#00ff00' : 'rgba(0, 255, 0, 0.6)', width: 1 },
          showlegend: false,
          hoverinfo: 'skip',
        } as PlotData);
      });
    }

    return traces;
  }, [holdsData, showSignalActivity, signalActivityData, showSignalCandidates, signalCandidates, highlightedCandidateIndex]);

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
            layer: 'above' as const,
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

    // Create candidate OBW spans if signal candidates are enabled and available
    const candidateShapes = showSignalCandidates && signalCandidates && signalCandidates.length > 0
      ? signalCandidates.map((candidate, idx) => {
          const isHighlighted = highlightedCandidateIndex === idx;
          return {
            type: 'rect' as const,
            xref: 'x' as const,
            yref: 'paper' as const,
            x0: candidate.f_low_99_hz / 1e6,  // Convert to MHz
            x1: candidate.f_high_99_hz / 1e6,
            y0: 0,
            y1: 1,
            line: { width: isHighlighted ? 2 : 0, color: isHighlighted ? '#00ff00' : 'rgba(0, 255, 0, 0.3)' },
            fillcolor: 'rgba(0, 255, 0, 0.2)',  // Light green
            opacity: isHighlighted ? 0.5 : 0.2,
            layer: 'below' as const,  // Below holds lines, above activity heat
            hoverinfo: 'skip' as const,
          } as any;
        })
      : [];

    // Layering order: activity regions (bottom) -> candidate spans -> manual regions -> assignments -> editing shape
    const shapes = [...activityRegionShapes, ...candidateShapes, ...manualRegionShapes, ...assignmentShapes, ...editingShape];

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

    // Create candidate label annotations
    if (showCandidateLabels && showSignalCandidates && signalCandidates && signalCandidates.length > 0 && metadata) {
      const startHz = metadata.start_hz;
      const stopHz = metadata.stop_hz;
      
      if (startHz !== null && startHz !== undefined && stopHz !== null && stopHz !== undefined) {
        signalCandidates.forEach((candidate) => {
          const centerMHz = candidate.center_freq_hz / 1e6;
          const obwHz = (candidate.f_high_99_hz - candidate.f_low_99_hz);
          const obwMHz = obwHz / 1e6;
          const presenceText = candidate.presence !== undefined
            ? `Presence: ${(candidate.presence * 100).toFixed(1)}%`
            : null;
          const tracesText = candidate.n_traces_hit !== undefined && candidate.n_traces_total !== undefined
            ? `Traces: ${candidate.n_traces_hit}/${candidate.n_traces_total}`
            : null;
          const extraLines = [presenceText, tracesText].filter(Boolean).join('<br>');
          
          // Calculate y position from power data range
          const allPowerValues = holdsData ? [...holdsData.min_hold, ...holdsData.max_hold, ...holdsData.avg_hold].filter(v => !isNaN(v) && isFinite(v)) : [];
          const yMax = allPowerValues.length > 0 ? Math.max(...allPowerValues) : 0;
          
          annotations.push({
            x: centerMHz,
            y: yMax * 0.95, // Position near top of chart
            text: `${centerMHz.toFixed(3)} MHz<br>BW: ${obwMHz.toFixed(3)} MHz${extraLines ? `<br>${extraLines}` : ''}`,
            showarrow: false,
            xref: 'x',
            yref: 'y',
            font: { color: '#f7f7f7', size: 10 },
            bgcolor: 'rgba(255, 255, 255, 0.8)',
            bordercolor: 'rgba(0, 255, 0, 0.5)',
            borderwidth: 1,
            borderpad: 2,
          });
        });
      }
    }

    // Format frequency range for title
    const freqRangeTitle = metadata && metadata.start_hz !== null && metadata.start_hz !== undefined && metadata.stop_hz !== null && metadata.stop_hz !== undefined
      ? `${formatFrequency(metadata.start_hz)} - ${formatFrequency(metadata.stop_hz)}`
      : 'Power Statistics';

    return {
      title: freqRangeTitle,
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
  }, [holdsData, band_id, zoomRange, showOverlays, filteredOverlays, showLabels, highlightedIndex, showManualRegions, manualRegions, showManualRegionLabels, highlightedManualRegionIndex, addRegionMode, editingRegion, showSignalActivity, showActivityRegions, activityRegions, showSignalCandidates, signalCandidates, showCandidateLabels, highlightedCandidateIndex]);

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
    if (eventData['xaxis.range[0]'] !== undefined && eventData['xaxis.range[1]'] !== undefined) {
      const x0 = Number(eventData['xaxis.range[0]']);
      const x1 = Number(eventData['xaxis.range[1]']);
      setZoomRange([x0, x1]);
      setWaterfallBounds((prev) => ({
        ...prev,
        f0: x0 * 1e6,
        f1: x1 * 1e6,
      }));
    } else if (eventData['xaxis.autorange']) {
      setZoomRange(undefined);
      setWaterfallBounds((prev) => ({
        ...prev,
        f0: undefined,
        f1: undefined,
      }));
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

  // Handle chart click to detect candidate span clicks
  const handlePlotClick = useCallback((eventData: any) => {
    if (!showSignalCandidates || !signalCandidates || signalCandidates.length === 0) return;
    
    // Get click coordinates from Plotly event
    if (eventData?.points && eventData.points.length > 0) {
      const point = eventData.points[0];
      const clickXMHz = point.x;
      
      // Find candidate that contains this x coordinate
      const clickedCandidateIndex = signalCandidates.findIndex(candidate => {
        const startMHz = candidate.f_low_99_hz / 1e6;
        const stopMHz = candidate.f_high_99_hz / 1e6;
        return clickXMHz >= startMHz && clickXMHz <= stopMHz;
      });
      
      if (clickedCandidateIndex !== -1) {
        setHighlightedCandidateIndex(clickedCandidateIndex);
        // Scroll table to that row if needed (table will auto-highlight via onMouseEnter)
      }
    }
  }, [showSignalCandidates, signalCandidates]);


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
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#0c0d10' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: sidebarCollapsed ? '50px' : '320px',
          minWidth: sidebarCollapsed ? '50px' : '280px',
          maxWidth: sidebarCollapsed ? '50px' : '380px',
          height: '100vh',
          position: 'sticky',
          top: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          background: '#0c0d10',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          transition: 'width 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Collapse Toggle */}
        <div style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              width: '100%',
              padding: '0.5rem',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '0.25rem',
              color: '#f7f7f7',
              cursor: 'pointer',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '▶' : '◀'}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: 1 }}>
            {/* Controls Section */}
            <section>
              <h2 style={{ color: '#f7f7f7', marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 'bold' }}>Controls</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="show-overlays"
                    checked={showOverlays}
                    onChange={(e) => setShowOverlays(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="show-overlays" style={{ color: '#f7f7f7', cursor: 'pointer', fontSize: '0.9rem' }}>
                    Show Assignment Overlays
                  </label>
                  {overlaysLoading && <span style={{ color: '#888', fontSize: '0.8rem' }}>(loading...)</span>}
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
                    <label htmlFor="show-labels" style={{ color: '#f7f7f7', cursor: 'pointer', fontSize: '0.85rem' }}>
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
                  <label htmlFor="show-manual-regions" style={{ color: '#f7f7f7', cursor: 'pointer', fontSize: '0.9rem' }}>
                    Show Manual Regions
                  </label>
                  {manualRegionsLoading && <span style={{ color: '#888', fontSize: '0.8rem' }}>(loading...)</span>}
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
                        fontSize: '0.85rem',
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
                    <label htmlFor="show-manual-region-labels" style={{ color: '#f7f7f7', cursor: 'pointer', fontSize: '0.85rem' }}>
                      Show manual region labels
                    </label>
                  </div>
                )}
                {showManualRegions && addRegionMode && (
                  <div style={{ marginLeft: '1.5rem', color: '#ffcc00', fontSize: '0.8rem' }}>
                    Selection mode active: Click and drag on the chart to select a region
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    type="checkbox"
                    id="show-signal-activity"
                    checked={showSignalActivity}
                    onChange={(e) => setShowSignalActivity(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="show-signal-activity" style={{ color: '#f7f7f7', cursor: 'pointer', fontSize: '0.9rem' }}>
                    Signal Activity
                  </label>
                  {signalActivityLoading && <span style={{ color: '#888', fontSize: '0.8rem' }}>(loading...)</span>}
                  {signalActivityError && (
                    <span style={{ color: '#ff6b6b', fontSize: '0.8rem' }}>
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
                          cursor: showSignalActivity ? 'pointer' : 'not-allowed',
                          fontSize: '0.85rem'
                        }}
                      >
                        Show activity regions
                      </label>
                    </div>
                    {showActivityRegions && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginLeft: '1.5rem' }}>
                        <label 
                          htmlFor="activity-threshold" 
                          style={{ color: '#f7f7f7', fontSize: '0.85rem' }}
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
                            width: '100%',
                            cursor: showActivityRegions ? 'pointer' : 'not-allowed',
                            opacity: showActivityRegions ? 1 : 0.5,
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    type="checkbox"
                    id="show-signal-candidates"
                    checked={showSignalCandidates}
                    onChange={(e) => setShowSignalCandidates(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="show-signal-candidates" style={{ color: '#f7f7f7', cursor: 'pointer', fontSize: '0.9rem' }}>
                    Signal Candidates
                  </label>
                  {signalCandidatesLoading && <span style={{ color: '#888', fontSize: '0.8rem' }}>(loading...)</span>}
                  {signalCandidatesError && (
                    <span style={{ color: '#ff6b6b', fontSize: '0.8rem' }}>
                      Error: {signalCandidatesError}
                    </span>
                  )}
                </div>
                {showSignalCandidates && signalCandidates && signalCandidates.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1.5rem' }}>
                    <input
                      type="checkbox"
                      id="show-candidate-labels"
                      checked={showCandidateLabels}
                      onChange={(e) => setShowCandidateLabels(e.target.checked)}
                      disabled={!showSignalCandidates}
                      style={{ cursor: showSignalCandidates ? 'pointer' : 'not-allowed' }}
                    />
                    <label 
                      htmlFor="show-candidate-labels" 
                      style={{ 
                        color: showSignalCandidates ? '#f7f7f7' : '#666', 
                        cursor: showSignalCandidates ? 'pointer' : 'not-allowed',
                        fontSize: '0.85rem'
                      }}
                    >
                      Show candidate labels
                    </label>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <input
                    type="checkbox"
                    id="show-waterfall"
                    checked={showWaterfall}
                    onChange={(e) => setShowWaterfall(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="show-waterfall" style={{ color: '#f7f7f7', cursor: 'pointer', fontSize: '0.9rem' }}>
                    Show Waterfall
                  </label>
                </div>
                {showWaterfall && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <label htmlFor="waterfall-downsample" style={{ color: '#f7f7f7', fontSize: '0.85rem' }}>
                        Downsample: {waterfallDownsample === 'max' ? 'Max (preserve peaks)' : 'Mean'}
                      </label>
                      <select
                        id="waterfall-downsample"
                        value={waterfallDownsample}
                        onChange={(e) => {
                          const value = e.target.value === 'max' ? 'max' : 'mean';
                          setWaterfallDownsample(value);
                        }}
                        style={{
                          padding: '0.4rem',
                          background: '#1a1d29',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '0.25rem',
                          color: '#f7f7f7',
                          fontSize: '0.85rem',
                        }}
                      >
                        <option value="mean">Mean (smooth)</option>
                        <option value="max">Max (preserve peaks)</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <label htmlFor="waterfall-vmin" style={{ color: '#f7f7f7', fontSize: '0.85rem' }}>
                        Color Scale Min: {waterfallVmin !== undefined ? waterfallVmin.toFixed(1) : 'Auto'}
                      </label>
                      <input
                        type="number"
                        id="waterfall-vmin"
                        step="0.1"
                        value={waterfallVmin ?? ''}
                        onChange={(e) => {
                          const value = e.target.value === '' ? undefined : parseFloat(e.target.value);
                          setWaterfallVmin(isNaN(value as number) ? undefined : value);
                        }}
                        placeholder="Auto"
                        style={{
                          padding: '0.4rem',
                          background: '#1a1d29',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '0.25rem',
                          color: '#f7f7f7',
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <label htmlFor="waterfall-vmax" style={{ color: '#f7f7f7', fontSize: '0.85rem' }}>
                        Color Scale Max: {waterfallVmax !== undefined ? waterfallVmax.toFixed(1) : 'Auto'}
                      </label>
                      <input
                        type="number"
                        id="waterfall-vmax"
                        step="0.1"
                        value={waterfallVmax ?? ''}
                        onChange={(e) => {
                          const value = e.target.value === '' ? undefined : parseFloat(e.target.value);
                          setWaterfallVmax(isNaN(value as number) ? undefined : value);
                        }}
                        placeholder="Auto"
                        style={{
                          padding: '0.4rem',
                          background: '#1a1d29',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '0.25rem',
                          color: '#f7f7f7',
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>
                    {(waterfallVmin !== undefined || waterfallVmax !== undefined) && (
                      <button
                        onClick={() => {
                          setWaterfallVmin(undefined);
                          setWaterfallVmax(undefined);
                        }}
                        style={{
                          padding: '0.4rem 0.75rem',
                          background: 'rgba(255,255,255,0.1)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '0.25rem',
                          color: '#f7f7f7',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          alignSelf: 'flex-start',
                        }}
                      >
                        Reset to Auto
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Band Information Section */}
            <section>
              <h2 style={{ color: '#f7f7f7', marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 'bold' }}>Band Information</h2>
              <dl style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', color: '#f7f7f7', fontSize: '0.9rem' }}>
                {startHz !== null && stopHz !== null && (
                  <div>
                    <dt style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: 'rgba(155, 171, 207, 0.9)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Frequency Range</dt>
                    <dd style={{ margin: 0 }}>{formatFrequency(startHz)} - {formatFrequency(stopHz)}</dd>
                  </div>
                )}
                {metadata.n_traces !== null && metadata.n_traces !== undefined && (
                  <div>
                    <dt style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: 'rgba(155, 171, 207, 0.9)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Traces</dt>
                    <dd style={{ margin: 0 }}>{metadata.n_traces.toLocaleString()}</dd>
                  </div>
                )}
                {metadata.step_hz !== null && metadata.step_hz !== undefined && (
                  <div>
                    <dt style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: 'rgba(155, 171, 207, 0.9)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Step Frequency</dt>
                    <dd style={{ margin: 0 }}>{formatFrequency(metadata.step_hz)}</dd>
                  </div>
                )}
                {metadata.n_freqs !== undefined && (
                  <div>
                    <dt style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: 'rgba(155, 171, 207, 0.9)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Frequency Bins</dt>
                    <dd style={{ margin: 0 }}>{metadata.n_freqs.toLocaleString()}</dd>
                  </div>
                )}
                {metadata.site && (
                  <div>
                    <dt style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: 'rgba(155, 171, 207, 0.9)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Site</dt>
                    <dd style={{ margin: 0 }}>{metadata.site}</dd>
                  </div>
                )}
                {metadata.sensor && (
                  <div>
                    <dt style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: 'rgba(155, 171, 207, 0.9)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Sensor</dt>
                    <dd style={{ margin: 0 }}>{metadata.sensor}</dd>
                  </div>
                )}
                {(() => {
                  // Try to extract date range from metadata or calculate from included_days if available
                  const includedDays = (metadata as any).included_days as string[] | undefined;
                  let dateRange: string | null = null;
                  
                  if (includedDays && Array.isArray(includedDays) && includedDays.length > 0) {
                    const sortedDays = [...includedDays].sort();
                    const startDate = sortedDays[0];
                    const endDate = sortedDays[sortedDays.length - 1];
                    if (startDate && endDate) {
                      // Format dates: YYYY-MM-DD to readable format
                      const formatDate = (dateStr: string) => {
                        try {
                          const date = new Date(dateStr + 'T00:00:00Z');
                          return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                        } catch {
                          return dateStr;
                        }
                      };
                      if (startDate === endDate) {
                        dateRange = formatDate(startDate);
                      } else {
                        dateRange = `${formatDate(startDate)} - ${formatDate(endDate)}`;
                      }
                    }
                  } else if ((metadata as any).date_start && (metadata as any).date_end) {
                    // Alternative date fields if available
                    const formatDate = (dateStr: string) => {
                      try {
                        const date = new Date(dateStr);
                        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                      } catch {
                        return dateStr;
                      }
                    };
                    dateRange = `${formatDate((metadata as any).date_start)} - ${formatDate((metadata as any).date_end)}`;
                  }
                  
                  return dateRange ? (
                    <div>
                      <dt style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: 'rgba(155, 171, 207, 0.9)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Date Range</dt>
                      <dd style={{ margin: 0, fontSize: '0.85rem' }}>{dateRange}</dd>
                    </div>
                  ) : null;
                })()}
              </dl>
            </section>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '2rem', gap: '2rem' }}>
        <section style={{ 
          marginBottom: showWaterfall ? 0 : '2rem',
          padding: '1rem',
          background: '#0f1320',
          borderRadius: '0.75rem',
          border: '1px solid rgba(255,255,255,0.08)'
        }}>
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
              onClick={handlePlotClick}
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
        
        {showWaterfall && (
          <>
            <div style={{ 
              height: '1px', 
              background: 'rgba(255,255,255,0.1)', 
              margin: '1rem 0',
              marginTop: traces.length > 0 ? '1rem' : '0'
            }} />
            <Waterfall
              surveyId={decodedSurveyId}
              bandId={decodedBandId}
              f0={waterfallBounds.f0 ?? (zoomRange ? zoomRange[0] * 1e6 : startHz ?? undefined)}
              f1={waterfallBounds.f1 ?? (zoomRange ? zoomRange[1] * 1e6 : stopHz ?? undefined)}
              t0={waterfallBounds.t0}
              t1={waterfallBounds.t1}
              startHz={startHz}
              stopHz={stopHz}
              baseUnixTime={(metadata as any).unix0 ?? (metadata as any).time_start_unix ?? undefined}
              vmin={waterfallVmin}
              vmax={waterfallVmax}
                downsample={waterfallDownsample}
              onBoundsChange={(bounds) => {
                // If bounds are undefined, reset to full range
                if (bounds.f0 === undefined && bounds.f1 === undefined && bounds.t0 === undefined && bounds.t1 === undefined) {
                  setWaterfallBounds({});
                  setZoomRange(undefined);
                } else {
                  setWaterfallBounds(bounds);
                  if (bounds.f0 !== undefined && bounds.f1 !== undefined) {
                    setZoomRange([bounds.f0 / 1e6, bounds.f1 / 1e6]);
                  }
                }
              }}
            />
          </>
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
                setEditingRegion(null);
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

      {/* Signal Candidates Panel */}
      {showSignalCandidates && (
        <section style={{ margin: '2rem 0', padding: '1rem', background: '#0f1320', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 style={{ color: '#f7f7f7', marginBottom: '1rem', fontSize: '1.25rem' }}>Signal Candidates</h2>
          
          {signalCandidatesLoading ? (
            <p style={{ color: '#888', marginTop: '1rem', fontStyle: 'italic' }}>Loading candidates...</p>
          ) : signalCandidatesError ? (
            <p style={{ color: '#ff6b6b', marginTop: '1rem' }}>Error: {signalCandidatesError}</p>
          ) : signalCandidates && signalCandidates.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', color: '#f7f7f7', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Center (MHz)</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>BW (MHz)</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Presence</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Traces Hit</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Activity Peak</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Activity Mean</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Peak dBm</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Start (MHz)</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Stop (MHz)</th>
                  </tr>
                </thead>
                <tbody>
                  {signalCandidates.map((candidate, idx) => {
                    const isHighlighted = highlightedCandidateIndex === idx;
                    const centerMHz = candidate.center_freq_hz / 1e6;
                    const obwHz = candidate.f_high_99_hz - candidate.f_low_99_hz;
                    const obwMHz = obwHz / 1e6;
                    const startMHz = candidate.f_low_99_hz / 1e6;
                    const stopMHz = candidate.f_high_99_hz / 1e6;
                    
                    return (
                      <tr
                        key={idx}
                        onMouseEnter={() => setHighlightedCandidateIndex(idx)}
                        onMouseLeave={() => setHighlightedCandidateIndex(null)}
                        onClick={() => {
                          setHighlightedCandidateIndex(highlightedCandidateIndex === idx ? null : idx);
                          // Zoom to OBW span with ~10% padding
                          const padding = obwMHz * 0.1;
                          setZoomRange([(startMHz - padding), (stopMHz + padding)]);
                        }}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          backgroundColor: isHighlighted ? 'rgba(0, 255, 0, 0.2)' : 'transparent',
                          transition: 'background-color 0.15s ease',
                        }}
                      >
                        <td style={{ padding: '0.75rem' }}>{centerMHz.toFixed(3)}</td>
                        <td style={{ padding: '0.75rem' }}>{obwMHz.toFixed(3)}</td>
                        <td style={{ padding: '0.75rem' }}>
                          {candidate.presence !== undefined ? `${(candidate.presence * 100).toFixed(1)}%` : 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {candidate.n_traces_hit !== undefined && candidate.n_traces_total !== undefined
                            ? `${candidate.n_traces_hit}/${candidate.n_traces_total}`
                            : 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {candidate.activity_peak !== undefined && candidate.activity_peak !== null
                            ? candidate.activity_peak.toFixed(3)
                            : 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {candidate.activity_mean !== undefined && candidate.activity_mean !== null
                            ? candidate.activity_mean.toFixed(3)
                            : 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {candidate.peak_dbm !== undefined && candidate.peak_dbm !== null ? candidate.peak_dbm.toFixed(1) : 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem' }}>{startMHz.toFixed(3)}</td>
                        <td style={{ padding: '0.75rem' }}>{stopMHz.toFixed(3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: '#888', marginTop: '1rem', fontStyle: 'italic' }}>
              No signal candidates found.
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

      </main>
    </div>
  );
}

