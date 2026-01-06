import Link from 'next/link';

export default function IndexPage() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">RF Spectrum Explorer</p>
          <h1>Surveys</h1>
          <p className="muted">Browse surveys and bands from rfproc data.</p>
        </div>
        <div className="controls">
          <Link href="/surveys" className="button">
            View Surveys
          </Link>
        </div>
      </header>

      <section style={{ padding: '1.5rem 0', borderTop: '1px solid #eee', marginTop: '1.5rem' }}>
        <div className="app-header" style={{ padding: 0 }}>
          <div>
            <h2>Spectrum assignments</h2>
            <p className="muted">
              Manage assignment overlays imported from SFAF or JSON files by site.
            </p>
          </div>
          <div className="controls">
            <Link href="/assignments" className="button">
              Manage assignments
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
