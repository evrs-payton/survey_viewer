import { useEffect, useMemo, useRef, useState } from 'react';

import { getWaterfallTile, getWaterfallTileData } from '../lib/api';

export interface WaterfallProps {
  surveyId: string;
  bandId: string;
  f0?: number;
  f1?: number;
  t0?: number;
  t1?: number;
  maxw?: number;
  maxt?: number;
  startHz?: number | null;
  stopHz?: number | null;
  baseUnixTime?: number;
  vmin?: number;
  vmax?: number;
  downsample?: 'mean' | 'max';
  onBoundsChange?: (
    bounds: { f0: number; f1: number; t0: number; t1: number },
    source: 'user'
  ) => void;
}

interface TileState {
  url: string;
  freqStart: number;
  freqEnd: number;
  timeStart: number;
  timeEnd: number;
  baseUnixTime?: number;
}

interface IntensityMeta {
  time_start?: number;
  time_end?: number;
  freq_start?: number;
  freq_end?: number;
  tile_width?: number;
  tile_height?: number;
  display_min_dbm?: number;
  display_max_dbm?: number;
  intensity_bits?: number;
  base_unix_time?: number;
}

interface IntensityData {
  intensity: Array<Array<number | null>>;
  meta: IntensityMeta;
}

export function Waterfall({
  surveyId,
  bandId,
  f0,
  f1,
  t0,
  t1,
  maxw = 1600,
  maxt = 600, // Fixed height - matches FIXED_HEIGHT_PX
  startHz,
  stopHz,
  baseUnixTime: propBaseUnixTime,
  vmin,
  vmax,
  downsample,
  onBoundsChange
}: WaterfallProps) {
  const [tile, setTile] = useState<TileState | null>(null);
  const [intensityData, setIntensityData] = useState<IntensityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ freq: number; time: number; dbm: number | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { blob, headers } = await getWaterfallTile(surveyId, bandId, {
          f0,
          f1,
          t0,
          t1,
          maxw,
          maxt,
          fmt: 'png',
          vmin,
          vmax,
          downsample,
          // Don't pass level_id - let backend automatically select based on zoom level
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        // Backend returns Hz; align with summary (also Hz)
        const freqStart = Number(headers.get('X-Freq-Start') ?? f0 ?? 0);
        const freqEnd = Number(headers.get('X-Freq-End') ?? f1 ?? freqStart + 1);
        const timeStart = Number(headers.get('X-Time-Start') ?? t0 ?? 0);
        const timeEnd = Number(headers.get('X-Time-End') ?? t1 ?? timeStart + 1);
        const baseUnixTime = headers.get('X-Base-Unix-Time') ? Number(headers.get('X-Base-Unix-Time')) : propBaseUnixTime;
        setTile((current) => {
          if (current) {
            URL.revokeObjectURL(current.url);
          }
          return {
            url: objectUrl as string,
            freqStart,
            freqEnd,
            timeStart,
            timeEnd,
            baseUnixTime
          };
        });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load waterfall', err);
        setTile((current) => {
          if (current) {
            URL.revokeObjectURL(current.url);
          }
          return null;
        });
        setError('Unable to load waterfall image.');
        setLoading(false);
      }
    })();

    (async () => {
      try {
        const data = await getWaterfallTileData(surveyId, bandId, {
          f0,
          f1,
          t0,
          t1,
          maxw,
          maxt,
          downsample,
        });
        if (cancelled) return;
        setIntensityData(data);
      } catch (err) {
        if (cancelled) return;
        console.warn('Failed to load waterfall intensity data', err);
        setIntensityData(null);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [surveyId, bandId, f0, f1, t0, t1, maxw, maxt, vmin, vmax, downsample]);

  // Track container width to compute integer scaling height and avoid subpixel gaps
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setContainerWidth(Math.max(0, Math.floor(e.contentRect.width)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fixed height for waterfall
  const FIXED_HEIGHT_PX = 600;
  const displayHeightPx = FIXED_HEIGHT_PX;

  function formatTimeMinutesHours(seconds: number): string {
    const abs = Math.abs(seconds);
    if (abs >= 3600) {
      return `${(seconds / 3600).toFixed(2)} hr`;
    }
    return `${(seconds / 60).toFixed(2)} min`;
  }

  function formatDateTime(seconds: number, baseUnixTime?: number): string {
    if (baseUnixTime !== undefined && baseUnixTime > 0) {
      // Convert relative time to absolute Unix timestamp
      const unixTime = baseUnixTime + seconds;
      const date = new Date(unixTime * 1000);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    }
    // Fallback to relative time format
    return formatTimeMinutesHours(seconds);
  }

  function formatFrequencyAdaptive(hz: number): string {
    const abs = Math.abs(hz);
    if (abs >= 1_000_000_000) return `${(hz / 1_000_000_000).toFixed(2)} GHz`;
    if (abs >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)} MHz`;
    if (abs >= 1_000) return `${(hz / 1_000).toFixed(2)} kHz`;
    return `${hz.toFixed(2)} Hz`;
  }

  const axisText = useMemo(() => {
    if (!tile) return null;
    const freq = `${formatFrequencyAdaptive(tile.freqStart)} → ${formatFrequencyAdaptive(tile.freqEnd)}`;
    const time = tile.baseUnixTime !== undefined
      ? `${formatDateTime(tile.timeStart, tile.baseUnixTime)} → ${formatDateTime(tile.timeEnd, tile.baseUnixTime)}`
      : `${formatTimeMinutesHours(tile.timeStart)} → ${formatTimeMinutesHours(tile.timeEnd)}`;
    return { freq, time };
  }, [tile]);

  // Generate y-axis labels with date/time
  const yAxisLabels = useMemo(() => {
    if (!tile || !displayHeightPx) return [];
    const numLabels = 5; // Number of labels to show
    const labels: Array<{ y: number; text: string }> = [];
    for (let i = 0; i < numLabels; i++) {
      const ratio = i / (numLabels - 1);
      const timeValue = tile.timeStart + ratio * (tile.timeEnd - tile.timeStart);
      const yPos = ratio * displayHeightPx;
      const labelText = tile.baseUnixTime !== undefined
        ? formatDateTime(timeValue, tile.baseUnixTime)
        : formatTimeMinutesHours(timeValue);
      labels.push({ y: yPos, text: labelText });
    }
    return labels;
  }, [tile, displayHeightPx]);

  const selectionRect = useMemo(() => {
    if (!dragStart || !dragCurrent) return null;
    const x0 = Math.min(dragStart.x, dragCurrent.x);
    const x1 = Math.max(dragStart.x, dragCurrent.x);
    const y0 = Math.min(dragStart.y, dragCurrent.y);
    const y1 = Math.max(dragStart.y, dragCurrent.y);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [dragStart, dragCurrent]);

  function getLocalPoint(event: { clientX: number; clientY: number }) {
    const el = imageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    return { x, y, width: rect.width, height: rect.height };
  }

  function toBoundsFromPixels(
    start: { x: number; y: number },
    end: { x: number; y: number },
    width: number,
    height: number
  ) {
    if (!tile) return null;
    const x0 = Math.min(start.x, end.x) / Math.max(1, width);
    const x1 = Math.max(start.x, end.x) / Math.max(1, width);
    const y0 = Math.min(start.y, end.y) / Math.max(1, height);
    const y1 = Math.max(start.y, end.y) / Math.max(1, height);
    const fStart = tile.freqStart + x0 * (tile.freqEnd - tile.freqStart);
    const fEnd = tile.freqStart + x1 * (tile.freqEnd - tile.freqStart);
    const tStart = tile.timeStart + y0 * (tile.timeEnd - tile.timeStart);
    const tEnd = tile.timeStart + y1 * (tile.timeEnd - tile.timeStart);
    return { f0: fStart, f1: fEnd, t0: tStart, t1: tEnd };
  }

  function updateHoverInfo(event: { clientX: number; clientY: number }) {
    const point = getLocalPoint(event);
    if (!point || !tile) {
      setHoverInfo(null);
      return;
    }
    const xRatio = point.x / Math.max(1, point.width);
    const yRatio = point.y / Math.max(1, point.height);
    const freq = tile.freqStart + xRatio * (tile.freqEnd - tile.freqStart);
    const time = tile.timeStart + yRatio * (tile.timeEnd - tile.timeStart);

    let dbm: number | null = null;
    if (intensityData?.intensity?.length) {
      const rows = intensityData.intensity.length;
      const cols = intensityData.intensity[0]?.length ?? 0;
      if (rows > 0 && cols > 0) {
        const row = Math.min(rows - 1, Math.max(0, Math.floor(yRatio * rows)));
        const col = Math.min(cols - 1, Math.max(0, Math.floor(xRatio * cols)));
        const value = intensityData.intensity[row]?.[col];
        const displayMin = intensityData.meta.display_min_dbm;
        const displayMax = intensityData.meta.display_max_dbm;
        const intensityBits = intensityData.meta.intensity_bits ?? 16;
        const maxIntensity = intensityBits === 8 ? 255 : 65535;
        if (
          typeof value === 'number' &&
          Number.isFinite(value) &&
          displayMin !== undefined &&
          displayMax !== undefined &&
          displayMax > displayMin
        ) {
          dbm = displayMin + (value / maxIntensity) * (displayMax - displayMin);
        }
      }
    }

    setHoverInfo({ freq, time, dbm });
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>
          Double-click to reset zoom
        </div>
        {hoverInfo && (
          <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)' }}>
            {formatFrequencyAdaptive(hoverInfo.freq)} ·{' '}
            {formatDateTime(
              hoverInfo.time,
              tile?.baseUnixTime ?? intensityData?.meta.base_unix_time
            )}{' '}
            · {hoverInfo.dbm !== null ? `${hoverInfo.dbm.toFixed(1)} dBm` : 'No data'}
          </div>
        )}
        {tile && (f0 !== undefined || f1 !== undefined || t0 !== undefined || t1 !== undefined) && onBoundsChange && (
          <button
            onClick={() => {
              onBoundsChange({
                f0: undefined,
                f1: undefined,
                t0: undefined,
                t1: undefined,
              }, 'user');
            }}
            style={{
              padding: '0.4rem 0.75rem',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '0.25rem',
              color: '#f7f7f7',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontWeight: '500',
            }}
            title="Reset zoom to full range"
          >
            Reset Zoom
          </button>
        )}
      </div>
      <div ref={containerRef} style={{ position: 'relative', height: `${displayHeightPx}px`, width: '100%', paddingLeft: '64px', paddingRight: '32px' }}>
        {/* Y-axis labels with date/time */}
        {tile && yAxisLabels.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 60,
              height: `${displayHeightPx}px`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              paddingTop: '0.25rem',
              paddingBottom: '0.25rem',
              pointerEvents: 'none',
              zIndex: 10
            }}
          >
            {yAxisLabels.map((label, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: '0.7rem',
                  color: 'rgba(255, 255, 255, 0.8)',
                  textAlign: 'right',
                  paddingRight: '0.5rem',
                  lineHeight: '1.2',
                  position: 'absolute',
                  top: idx === 0 ? '0' : idx === yAxisLabels.length - 1 ? 'auto' : `${(idx / (yAxisLabels.length - 1)) * 100}%`,
                  bottom: idx === yAxisLabels.length - 1 ? '0' : 'auto',
                  transform: idx === 0 || idx === yAxisLabels.length - 1 ? 'none' : 'translateY(-50%)',
                }}
              >
                {label.text}
              </div>
            ))}
          </div>
        )}
        {tile && !loading && !error ? (
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: `${displayHeightPx}px`,
              background: 'rgba(26,30,43,0.6)',
              borderRadius: '0.5rem',
              overflow: 'hidden'
            }}
            onMouseDown={(event) => {
              if (!tile || event.button !== 0) return;
              const local = getLocalPoint(event);
              if (!local) return;
              setDragStart({ x: local.x, y: local.y });
              setDragCurrent({ x: local.x, y: local.y });
            }}
            onMouseMove={(event) => {
              updateHoverInfo(event);
              if (!dragStart) return;
              const local = getLocalPoint(event);
              if (!local) return;
              setDragCurrent({ x: local.x, y: local.y });
            }}
            onMouseUp={(event) => {
              if (!dragStart || !dragCurrent) return;
              const local = getLocalPoint(event);
              if (!local) return;
              const bounds = toBoundsFromPixels(dragStart, dragCurrent, local.width, local.height);
              setDragStart(null);
              setDragCurrent(null);
              if (!bounds) return;
              if (Math.abs(bounds.f1 - bounds.f0) < 1 || Math.abs(bounds.t1 - bounds.t0) < 1) {
                return;
              }
              onBoundsChange?.(bounds, 'user');
            }}
            onMouseLeave={() => {
              setDragStart(null);
              setDragCurrent(null);
              setHoverInfo(null);
            }}
            onDoubleClick={(event) => {
              // Reset zoom on double-click
              if (tile && onBoundsChange) {
                onBoundsChange({
                  f0: undefined,
                  f1: undefined,
                  t0: undefined,
                  t1: undefined,
                }, 'user');
              }
            }}
          >
            <img
              ref={imageRef}
              src={tile.url}
              alt="Waterfall heatmap"
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                imageRendering: 'pixelated',
                WebkitTransform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
                borderRadius: '0.5rem'
              }}
              onLoad={(e) => setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              draggable={false}
            />
            {selectionRect ? (
              <div
                style={{
                  position: 'absolute',
                  left: selectionRect.x,
                  top: selectionRect.y,
                  width: selectionRect.w,
                  height: selectionRect.h,
                  border: '2px solid rgba(0, 255, 255, 0.8)',
                  background: 'rgba(0, 255, 255, 0.15)',
                  pointerEvents: 'none',
                }}
              />
            ) : null}
            {loading ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(12, 13, 16, 0.45)',
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '0.9rem',
                }}
              >
                Loading…
              </div>
            ) : null}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: `${displayHeightPx}px`,
              borderRadius: '0.5rem',
              background: 'rgba(26,30,43,0.6)',
              border: '1px dashed rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.6)'
            }}
          >
            {loading ? 'Loading waterfall…' : error ?? 'No waterfall available.'}
          </div>
        )}
        {tile ? (
          <div
            style={{
              position: 'absolute',
              right: 16, // 32px padding + 16px offset
              top: 16,
              width: 12,
              height: 160,
              background:
                'linear-gradient(180deg, rgb(255,0,0) 0%, rgb(255,165,0) 20%, rgb(255,255,0) 40%, rgb(0,255,0) 60%, rgb(0,0,255) 80%, rgb(0,0,0) 100%)',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.3)'
            }}
          />
        ) : null}
      </div>
      {axisText ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.85rem', opacity: 0.85 }}>
          <span><strong>Frequency:</strong> {axisText.freq}</span>
          <span><strong>Time:</strong> {axisText.time}</span>
        </div>
      ) : null}
    </div>
  );
}

export default Waterfall;
