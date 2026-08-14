import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { signOut, useSession } from 'next-auth/react';

import { listSurveys, listSurveyBands, type SurveyInfo, type SurveyBandInfo } from '../lib/api';

type Status = 'idle' | 'loading' | 'error' | 'ready';

function formatMonthYear(year: number, month: number): string {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[month - 1]} ${year}`;
}

function formatSurveyLabel(survey: SurveyInfo): string {
  const site = survey.site || '';
  if (survey.year !== undefined && survey.month !== undefined) {
    return `${site} · ${formatMonthYear(survey.year, survey.month)}`;
  }
  const parts = survey.survey_id.split(':');
  if (parts.length === 4) return `${parts[1]} · ${parts[0]} · ${parts[3]}`;
  return survey.survey_id;
}

function formatFreq(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(1)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
  return `${hz} Hz`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function SurveysPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [surveys, setSurveys] = useState<SurveyInfo[]>([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string>('');
  const [bands, setBands] = useState<SurveyBandInfo[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [bandsError, setBandsError] = useState<string | null>(null);

  useEffect(() => {
    setStatus('loading');
    listSurveys()
      .then((data) => {
        setSurveys(data);
        if (data.length > 0) setSelectedSurveyId(data[0].survey_id);
        setStatus('ready');
      })
      .catch((err) => {
        setError(err?.message || 'Failed to load surveys');
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    if (!selectedSurveyId) { setBands([]); return; }
    setStatus('loading');
    setBandsError(null);
    listSurveyBands(selectedSurveyId)
      .then((data) => { setBands(data); setStatus('ready'); })
      .catch((err) => {
        setBandsError(err?.message || 'Failed to load bands');
        setStatus('error');
        setBands([]);
      });
  }, [selectedSurveyId]);

  const selectedSurvey = surveys.find(s => s.survey_id === selectedSurveyId);

  return (
    <div style={{
      minHeight: '100vh',
      position: 'relative',
      background: '#050b18',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      color: '#f3f6ff',
      overflowX: 'hidden',
    }}>
      {/* Animated gradient mesh */}
      <div style={{
        position: 'fixed', inset: '-20%', pointerEvents: 'none', zIndex: 0,
        filter: 'blur(60px)', opacity: 0.7,
        background: 'radial-gradient(40% 35% at 20% 30%, rgba(76,201,240,0.45), transparent 60%), radial-gradient(30% 30% at 80% 20%, rgba(124,92,255,0.35), transparent 60%), radial-gradient(35% 35% at 70% 80%, rgba(255,100,170,0.25), transparent 60%)',
        animation: 'drift 24s ease-in-out infinite alternate',
      }} />
      <div style={{
        position: 'fixed', inset: '-20%', pointerEvents: 'none', zIndex: 0,
        filter: 'blur(60px)', opacity: 0.7,
        background: 'radial-gradient(35% 30% at 30% 80%, rgba(0,200,150,0.25), transparent 60%), radial-gradient(30% 25% at 90% 60%, rgba(76,201,240,0.30), transparent 60%)',
        animation: 'drift2 32s ease-in-out infinite alternate',
        mixBlendMode: 'screen' as const,
      }} />
      {/* Grid + wave SVG */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.3 }}>
        <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(124,201,240,0.12)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="1600" height="900" fill="url(#grid)" />
          <g>
            <path d="M0,520 C160,460 320,580 480,520 C640,460 800,580 960,520 C1120,460 1280,580 1440,520 C1520,490 1560,510 1600,520"
              fill="none" stroke="#4cc9f0" strokeWidth="1.25" strokeLinecap="round"
              style={{ filter: 'drop-shadow(0 0 6px #4cc9f0)', animation: 'wave1 9s ease-in-out infinite', opacity: 0.6 }} />
            <path d="M0,560 C200,500 360,620 540,560 C720,500 900,620 1080,560 C1260,500 1440,620 1600,560"
              fill="none" stroke="#7c5cff" strokeWidth="1.25" strokeLinecap="round"
              style={{ filter: 'drop-shadow(0 0 6px #7c5cff)', animation: 'wave2 13s ease-in-out infinite', opacity: 0.5 }} />
          </g>
        </svg>
      </div>
      {/* Top nav bar */}
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        isolation: 'isolate',
        background: 'rgba(6, 8, 14, 0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '0.875rem clamp(1.25rem, 3vw, 3rem)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'rgba(200,215,240,0.5)', fontSize: '0.85rem' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
            Home
          </Link>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
          <span style={{ fontSize: '0.85rem', color: '#f3f6ff', fontWeight: 600 }}>Surveys</span>
        </div>

        {/* Survey selector + sign out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'rgba(200,215,240,0.45)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Survey</span>
          <select
            value={selectedSurveyId}
            onChange={(e) => setSelectedSurveyId(e.target.value)}
            disabled={status === 'loading' || surveys.length === 0}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '0.5rem',
              color: '#f3f6ff',
              fontSize: '0.875rem',
              padding: '0.45rem 2rem 0.45rem 0.75rem',
              cursor: 'pointer',
              outline: 'none',
              minWidth: '220px',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23aaa' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.6rem center',
            }}
          >
            {surveys.length === 0 ? (
              <option value="">{status === 'loading' ? 'Loading…' : 'No surveys'}</option>
            ) : (
              surveys.map((s) => (
                <option key={s.survey_id} value={s.survey_id}>{formatSurveyLabel(s)}</option>
              ))
            )}
          </select>
          {session && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', paddingLeft: '0.75rem', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontSize: '0.75rem', color: 'rgba(200,215,240,0.4)' }}>
                {session.user?.email ?? session.user?.name}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                style={{
                  padding: '0.3rem 0.75rem',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(200,215,240,0.7)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </nav>

      <main style={{ position: 'relative', zIndex: 1, padding: 'clamp(1.5rem, 3vw, 2.5rem) clamp(1.25rem, 3vw, 3rem)', maxWidth: '1400px', margin: '0 auto' }}>

        {/* Page header */}
        <div style={{ marginBottom: '2rem' }}>
          <p style={{ margin: '0 0 0.3rem', fontSize: '0.7rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#4ecdc4', opacity: 0.8 }}>
            RF Spectrum Explorer
          </p>
          <h1 style={{ margin: '0 0 0.5rem', fontSize: 'clamp(1.6rem, 2.5vw, 2.2rem)', fontWeight: 700, letterSpacing: '-0.02em' }}>
            {selectedSurvey ? (selectedSurvey.site || selectedSurvey.survey_id.split(':')[1] || 'Survey') : 'Surveys'}
          </h1>
          {selectedSurvey && (
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              {selectedSurvey.mission_type && <MetaPill label="Mission" value={selectedSurvey.mission_type} />}
              {selectedSurvey.sensor && <MetaPill label="Sensor" value={selectedSurvey.sensor} />}
              {selectedSurvey.year !== undefined && selectedSurvey.month !== undefined && (
                <MetaPill label="Period" value={formatMonthYear(selectedSurvey.year, selectedSurvey.month)} />
              )}
              {bands.length > 0 && <MetaPill label="Bands" value={String(bands.length)} accent="#4ecdc4" />}
            </div>
          )}
        </div>

        {/* Error states */}
        {error && <ErrorBanner message={error} />}
        {bandsError && <ErrorBanner message={bandsError} />}

        {/* Loading skeleton */}
        {status === 'loading' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.25rem' }}>
            {[1,2,3,4,5,6].map(i => (
              <div key={i} style={{
                height: '180px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '1rem',
                border: '1px solid rgba(255,255,255,0.05)',
                animation: 'pulse 1.6s ease-in-out infinite',
              }} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {status === 'ready' && bands.length === 0 && selectedSurveyId && !bandsError && (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'rgba(200,215,240,0.4)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ marginBottom: '1rem', opacity: 0.4 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <p style={{ margin: 0, fontSize: '1rem' }}>No bands found for this survey.</p>
          </div>
        )}

        {/* Band grid */}
        {status === 'ready' && bands.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '1.25rem',
          }}>
            {bands.map((band) => (
              <BandCard
                key={`${band.survey_id}-${band.band_id}`}
                band={band}
                onClick={() => {
                  const url = `${router.basePath}/survey-band/${encodeURIComponent(band.survey_id)}/${encodeURIComponent(band.band_id)}`;
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
              />
            ))}
          </div>
        )}
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes drift {
          0%   { transform: translate3d(0,0,0) scale(1); }
          50%  { transform: translate3d(2%,-3%,0) scale(1.05); }
          100% { transform: translate3d(-2%,3%,0) scale(1.02); }
        }
        @keyframes drift2 {
          0%   { transform: translate3d(0,0,0) scale(1.02); }
          50%  { transform: translate3d(-2%,3%,0) scale(1); }
          100% { transform: translate3d(2%,-3%,0) scale(1.05); }
        }
        @keyframes wave1 {
          0%,100% { transform: translateY(8px); }
          50%     { transform: translateY(-8px); }
        }
        @keyframes wave2 {
          0%,100% { transform: translateY(-8px); }
          50%     { transform: translateY(8px); }
        }
        select option { background: #0a1530; color: #f3f6ff; }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

function MetaPill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
      <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(155,171,207,0.7)' }}>{label}</span>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: accent || '#f3f6ff' }}>{value}</span>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      marginBottom: '1.5rem',
      padding: '0.875rem 1.25rem',
      background: 'rgba(255, 80, 100, 0.08)',
      border: '1px solid rgba(255, 80, 100, 0.25)',
      borderRadius: '0.75rem',
      color: '#ff8096',
      fontSize: '0.9rem',
    }}>
      {message}
    </div>
  );
}

function BandCard({ band, onClick }: { band: SurveyBandInfo; onClick: () => void }) {
  const startHz = band.axis?.start_hz;
  const stopHz = band.axis?.stop_hz;
  const hasBw = startHz !== undefined && stopHz !== undefined;
  const bwHz = hasBw ? stopHz! - startHz! : 0;

  return (
    <div
      onClick={onClick}
      style={{
        background: 'rgba(13, 18, 32, 0.8)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: '1rem',
        padding: '1.35rem',
        cursor: 'pointer',
        transition: 'border-color 0.18s ease, transform 0.15s ease, box-shadow 0.18s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = 'rgba(78,205,196,0.4)';
        el.style.transform = 'translateY(-2px)';
        el.style.boxShadow = '0 14px 36px rgba(0,0,0,0.5), 0 0 0 1px rgba(78,205,196,0.2)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = 'rgba(255,255,255,0.07)';
        el.style.transform = '';
        el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f3f6ff', lineHeight: 1.3 }}>
          {band.band_label ?? `Band ${band.band_id}`}
        </h2>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(78,205,196,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </div>

      {/* Freq range */}
      {hasBw && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'rgba(155,171,207,0.8)', fontFamily: 'monospace' }}>{formatFreq(startHz!)}</span>
            <span style={{ fontSize: '0.78rem', color: '#4ecdc4', fontWeight: 600, fontFamily: 'monospace' }}>{formatFreq(bwHz)}</span>
            <span style={{ fontSize: '0.78rem', color: 'rgba(155,171,207,0.8)', fontFamily: 'monospace' }}>{formatFreq(stopHz!)}</span>
          </div>
          <div style={{ height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, #4ecdc4, #7ae1ff)', borderRadius: '2px' }} />
          </div>
        </div>
      )}

      {/* Meta */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
        {band.axis?.n_freqs !== undefined && (
          <MiniStat label="Freq bins" value={band.axis.n_freqs.toLocaleString()} />
        )}
        {band.capture_duration_sec_active !== undefined && (
          <MiniStat label="Duration" value={formatDuration(band.capture_duration_sec_active)} />
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.16em', color: 'rgba(155,171,207,0.6)', marginBottom: '0.15rem' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f3f6ff' }}>{value}</div>
    </div>
  );
}
