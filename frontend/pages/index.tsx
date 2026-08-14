import { useEffect, useRef } from 'react';
import Link from 'next/link';

export default function IndexPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    type Peak = { x: number; amp: number; w: number; dx: number };
    type Trace = { y: number; opacity: number; noiseScale: number; seed: number; peaks: Peak[] };

    const traces: Trace[] = Array.from({ length: 7 }, (_, i) => ({
      y: 0.08 + (i / 6) * 0.84,
      opacity: 0.05 + (i % 3) * 0.025,
      noiseScale: 0.006 + (i % 2) * 0.004,
      seed: i * 73.1,
      peaks: Array.from({ length: 2 + (i % 3) }, (_, j) => ({
        x: 0.1 + j * 0.3 + (i * 0.13) % 0.6,
        amp: 0.032 + j * 0.018,
        w: 0.018 + (i % 3) * 0.012,
        dx: ((i + j) % 2 === 0 ? 1 : -1) * (0.00008 + j * 0.00004),
      })),
    }));

    let t = 0;

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const N = Math.ceil(W / 1.5);

      traces.forEach((trace) => {
        const baseY = H * trace.y;
        const scaleY = H * 0.12;

        ctx.beginPath();
        ctx.strokeStyle = `rgba(78, 205, 196, ${trace.opacity})`;
        ctx.lineWidth = 1;

        for (let i = 0; i <= N; i++) {
          const xn = i / N;
          const x = xn * W;

          let sig = 0.016
            + Math.sin(xn * 41.3 + trace.seed + t * 0.008) * trace.noiseScale
            + Math.sin(xn * 97.7 + trace.seed * 1.3 + t * 0.005) * trace.noiseScale * 0.5;

          for (const peak of trace.peaks) {
            const d = xn - peak.x;
            sig += peak.amp * Math.exp(-(d * d) / (2 * peak.w * peak.w));
          }

          sig += Math.sin(t * 0.012 + trace.seed) * 0.004;

          const y = baseY - sig * scaleY;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }

        ctx.stroke();

        for (const peak of trace.peaks) {
          peak.x += peak.dx;
          if (peak.x < -0.1) peak.x += 1.2;
          if (peak.x > 1.1) peak.x -= 1.2;
        }
      });

      t++;
      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      position: 'relative',
      background: 'radial-gradient(ellipse at 20% 10%, #1a2744 0%, #0b0f18 45%, #06070b 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 2rem 3.5rem',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        {/* Wordmark */}
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '0.75rem',
          }}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="17" stroke="#4ecdc4" strokeWidth="1.5" opacity="0.4"/>
              <circle cx="18" cy="18" r="11" stroke="#4ecdc4" strokeWidth="1.5" opacity="0.6"/>
              <circle cx="18" cy="18" r="5" fill="#4ecdc4" opacity="0.9"/>
              <line x1="1" y1="18" x2="7" y2="18" stroke="#4ecdc4" strokeWidth="1.5" opacity="0.5"/>
              <line x1="29" y1="18" x2="35" y2="18" stroke="#4ecdc4" strokeWidth="1.5" opacity="0.5"/>
            </svg>
            <span style={{
              fontSize: '0.7rem',
              letterSpacing: '0.35em',
              textTransform: 'uppercase',
              color: '#4ecdc4',
              opacity: 0.8,
            }}>RF Spectrum Explorer</span>
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'clamp(2.2rem, 4vw, 3.2rem)',
            fontWeight: 700,
            color: '#f3f6ff',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
          }}>
            Survey Viewer
          </h1>
          <p style={{
            marginTop: '0.75rem',
            color: 'rgba(200, 215, 240, 0.55)',
            fontSize: '1rem',
            maxWidth: '380px',
            lineHeight: 1.6,
          }}>
            Visualize and analyze RF spectrum data from EMOE surveys.
          </p>
        </div>

        {/* Nav cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.25rem',
          width: '100%',
          maxWidth: '660px',
        }}>
          <NavCard
            href="/surveys"
            icon={
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            }
            title="Surveys"
            description="Browse spectrum survey runs, select bands, and view signal candidates and waterfall data."
            cta="Open surveys"
            accent="#4ecdc4"
          />
          <NavCard
            href="/assignments"
            icon={
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
              </svg>
            }
            title="Assignments"
            description="Manage spectrum assignment overlays imported from SFAF or JSON files, organized by site."
            cta="Manage assignments"
            accent="#a78bfa"
          />
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '0.6rem 1.5rem',
        textAlign: 'center',
        fontSize: '0.68rem',
        letterSpacing: '0.06em',
        color: 'rgba(200, 215, 240, 0.28)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(6, 7, 11, 0.5)',
        backdropFilter: 'blur(8px)',
      }}>
        FOR OFFICIAL USE ONLY &mdash; This system is for authorized users only. All activity is monitored and recorded.
      </div>
    </div>
  );
}

function NavCard({
  href,
  icon,
  title,
  description,
  cta,
  accent,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  accent: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'rgba(15, 20, 35, 0.85)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '1.25rem',
        padding: '1.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        cursor: 'pointer',
        transition: 'border-color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease',
        boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
      }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = `${accent}55`;
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = `0 20px 50px rgba(0,0,0,0.55), 0 0 0 1px ${accent}33`;
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)';
          (e.currentTarget as HTMLDivElement).style.transform = '';
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 16px 40px rgba(0,0,0,0.45)';
        }}
      >
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '0.875rem',
          background: `${accent}18`,
          border: `1px solid ${accent}35`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: accent,
        }}>
          {icon}
        </div>
        <div>
          <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.15rem', fontWeight: 700, color: '#f3f6ff' }}>
            {title}
          </h2>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'rgba(200,215,240,0.55)', lineHeight: 1.55 }}>
            {description}
          </p>
        </div>
        <div style={{
          marginTop: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          fontSize: '0.85rem',
          fontWeight: 600,
          color: accent,
        }}>
          {cta}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </div>
      </div>
    </Link>
  );
}
