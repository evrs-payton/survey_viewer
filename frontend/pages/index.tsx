import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { BandMeta } from '../lib/api';
import { getBands } from '../lib/api';

export default function IndexPage() {
  const [bands, setBands] = useState<BandMeta[]>([]);

  useEffect(() => {
    getBands()
      .then(setBands)
      .catch((error) => {
        console.error('Failed to load bands', error);
      });
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">RF Spectrum Explorer</p>
          <h1>Band Directory</h1>
          <p className="muted">Select a band to review composite traces, analyze waterfalls, and annotate notable activity.</p>
        </div>
        <div className="controls" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Link href="/feature" className="button">
            Legacy
          </Link>
          <Link href="/surveys" className="button">
            RF Proc
          </Link>
        </div>
      </header>
      <section className="band-grid">
        {bands.map((band) => {
          const entries = Object.entries(band.meta ?? {}).slice(0, 4);
          return (
            <article key={band.id} className="band-card">
              <div className="band-card__heading">
                <h2>{band.id}</h2>
                <span className="badge">Active</span>
              </div>
              {entries.length === 0 ? (
                <p className="muted band-card__empty">No metadata provided for this band.</p>
              ) : (
                <dl className="band-card__meta">
                  {entries.map(([key, value]) => (
                    <div key={key} className="meta-row">
                      <dt>{key}</dt>
                      <dd>{formatMeta(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <Link href={`/bands/${band.id}`} className="button-link">
                Open Band View
              </Link>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function formatMeta(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GHz`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MHz`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)} kHz`;
    return value.toString();
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
