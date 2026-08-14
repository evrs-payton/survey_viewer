import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const callbackUrl = (router.query.callbackUrl as string) ?? '/';

  useEffect(() => {
    if (session) router.replace(callbackUrl);
  }, [session, callbackUrl, router]);

  if (status === 'loading') return null;

  return (
    <>
      <style>{`
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
        @keyframes wave3 {
          0%,100% { transform: translateY(6px); }
          50%     { transform: translateY(-6px); }
        }
        @keyframes scanY {
          0%   { transform: translateY(-30vh); opacity: 0; }
          10%  { opacity: 0.6; }
          90%  { opacity: 0.6; }
          100% { transform: translateY(80vh); opacity: 0; }
        }
        @keyframes pulse {
          0%,100% { opacity: 0.85; transform: scale(1); }
          50%     { opacity: 1; transform: scale(1.25); }
        }
        .login-btn:hover {
          transform: translateY(-1px) !important;
          filter: brightness(1.08);
          box-shadow: 0 18px 40px rgba(124,92,255,0.45), inset 0 1px 0 rgba(255,255,255,0.5) !important;
        }
        .login-btn:active { transform: translateY(0) !important; }
        .contact-link { color: #4cc9f0; text-decoration: none; border-bottom: 1px dashed rgba(76,201,240,0.5); }
        .contact-link:hover { color: #fff; border-bottom-color: #fff; }
        @media (prefers-reduced-motion: reduce) {
          .mesh1,.mesh2,.wave1,.wave2,.wave3,.scan,.dot { animation: none !important; }
        }
      `}</style>

      <div style={{
        position: 'relative',
        minHeight: '100vh',
        background: '#050b18',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 20px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        WebkitFontSmoothing: 'antialiased',
        overflowX: 'hidden',
        color: '#e6edf7',
      }}>

        {/* Animated gradient mesh layer 1 */}
        <div className="mesh1" style={{
          position: 'fixed', inset: '-20%', pointerEvents: 'none', zIndex: 0,
          filter: 'blur(60px)', opacity: 0.7,
          background: 'radial-gradient(40% 35% at 20% 30%, rgba(76,201,240,0.45), transparent 60%), radial-gradient(30% 30% at 80% 20%, rgba(124,92,255,0.35), transparent 60%), radial-gradient(35% 35% at 70% 80%, rgba(255,100,170,0.25), transparent 60%)',
          animation: 'drift 24s ease-in-out infinite alternate',
        }} />

        {/* Animated gradient mesh layer 2 */}
        <div className="mesh2" style={{
          position: 'fixed', inset: '-20%', pointerEvents: 'none', zIndex: 0,
          filter: 'blur(60px)', opacity: 0.7,
          background: 'radial-gradient(35% 30% at 30% 80%, rgba(0,200,150,0.25), transparent 60%), radial-gradient(30% 25% at 90% 60%, rgba(76,201,240,0.30), transparent 60%)',
          animation: 'drift2 32s ease-in-out infinite alternate',
          mixBlendMode: 'screen' as const,
        }} />

        {/* Grid + wave SVG */}
        <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.45 }}>
          <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="none">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(124,201,240,0.12)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="1600" height="900" fill="url(#grid)" />
            <g>
              <path className="wave1" d="M0,520 C160,460 320,580 480,520 C640,460 800,580 960,520 C1120,460 1280,580 1440,520 C1520,490 1560,510 1600,520"
                fill="none" stroke="#4cc9f0" strokeWidth="1.25" strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 6px #4cc9f0)', animation: 'wave1 9s ease-in-out infinite', opacity: 0.85 }} />
              <path className="wave2" d="M0,560 C200,500 360,620 540,560 C720,500 900,620 1080,560 C1260,500 1440,620 1600,560"
                fill="none" stroke="#7c5cff" strokeWidth="1.25" strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 6px #7c5cff)', animation: 'wave2 13s ease-in-out infinite', opacity: 0.7 }} />
              <path className="wave3" d="M0,600 C220,560 380,640 600,600 C820,560 1020,640 1240,600 C1420,570 1540,610 1600,600"
                fill="none" stroke="rgba(255,100,170,0.85)" strokeWidth="1.25" strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 6px rgba(255,100,170,0.85))', animation: 'wave3 17s ease-in-out infinite', opacity: 0.45 }} />
            </g>
          </svg>
        </div>

        {/* Scanline */}
        <div className="scan" style={{
          position: 'fixed', left: '-20%', right: '-20%', top: '30%', height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(76,201,240,0.7), transparent)',
          filter: 'blur(1px)', animation: 'scanY 11s linear infinite',
          zIndex: 0, pointerEvents: 'none', opacity: 0.6,
        }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '720px' }}>
        {/* EVRS Logo above card */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img src="/evrs-logo.png" alt="EVRS" style={{ maxHeight: '220px', maxWidth: '520px', width: '90%', objectFit: 'contain' }} />
        </div>

        {/* Card */}
        <main style={{
          position: 'relative',
          width: '100%',
          padding: '44px 40px 40px',
          background: 'rgba(10,21,48,0.55)',
          border: '1px solid rgba(124,92,255,0.25)',
          borderRadius: '18px',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}>

          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px', color: '#93a4bd', fontSize: '13px', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            <span className="dot" style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: '#4cc9f0', boxShadow: '0 0 12px #4cc9f0',
              animation: 'pulse 2.4s ease-in-out infinite', flexShrink: 0,
            }} />
            <span>EVRS &middot; Spectrum Operations</span>
          </div>

          {/* Title */}
          <h1 style={{
            margin: '0 0 14px', fontSize: 'clamp(28px,4vw,40px)', lineHeight: 1.15, letterSpacing: '-0.01em',
            background: 'linear-gradient(120deg, #ffffff 0%, #b9e4ff 60%, #cbb8ff 100%)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          }}>
            EVRS Lab Tools
          </h1>

          <p style={{ margin: '0 0 14px', color: '#e6edf7', fontSize: '16px', lineHeight: 1.65 }}>
            This website provides authorized users with access to EVRS tools,
            documentation, and system resources for electromagnetic spectrum
            monitoring operations.
          </p>

          {/* Warning chip */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            margin: '6px 0 22px', padding: '6px 12px', borderRadius: '999px',
            background: 'rgba(255,181,71,0.12)', border: '1px solid rgba(255,181,71,0.45)',
            color: '#ffb547', fontSize: '12.5px', letterSpacing: '0.12em',
            textTransform: 'uppercase', fontWeight: 600,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 L3 6 v6 c0 5 4 9 9 10 5-1 9-5 9-10 V6 z" />
              <path d="M9 12 l2 2 l4-4" />
            </svg>
            Authorized Access Only
          </div>

          <p style={{ margin: '0 0 14px', color: '#93a4bd', fontSize: '14.5px', lineHeight: 1.65 }}>
            All activity on this system is logged. Use of this system constitutes
            consent to monitoring. Unauthorized access is prohibited.
          </p>

          {/* Sign in button */}
          <div style={{ marginTop: '26px' }}>
            <button
              className="login-btn"
              onClick={() => signIn('authentik', { callbackUrl })}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '10px',
                padding: '14px 22px',
                background: 'linear-gradient(135deg, #4cc9f0, #7c5cff)',
                color: '#0a1530', fontWeight: 700, fontSize: '15px',
                letterSpacing: '0.02em', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '12px', cursor: 'pointer',
                boxShadow: '0 12px 30px rgba(76,201,240,0.35), inset 0 1px 0 rgba(255,255,255,0.4)',
                transition: 'transform 120ms ease, box-shadow 200ms ease, filter 200ms ease',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="9" rx="2" />
                <path d="M8 11 V7 a4 4 0 0 1 8 0 v4" />
              </svg>
              Authorized User Login
            </button>
          </div>

          {/* Contact */}
          <div style={{
            marginTop: '28px', paddingTop: '18px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            color: '#93a4bd', fontSize: '13.5px',
          }}>
            For support, contact:{' '}
            <a className="contact-link" href="mailto:usafea6.evrs.support@us.af.mil">
              usafea6.evrs.support@us.af.mil
            </a>
          </div>
        </main>
        </div>{/* end logo+card wrapper */}
      </div>
    </>
  );
}
