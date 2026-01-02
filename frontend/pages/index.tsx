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
    </main>
  );
}
