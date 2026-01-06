import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  listAssignmentSites,
  listAssignmentsForSite,
  uploadAssignmentsFile,
  deleteAssignment,
  type AssignmentRecord,
} from '../lib/api';

type LoadStatus = 'idle' | 'loading' | 'error' | 'ready';

export default function AssignmentsPage() {
  const [sites, setSites] = useState<string[]>([]);
  const [sitesStatus, setSitesStatus] = useState<LoadStatus>('idle');
  const [sitesError, setSitesError] = useState<string | null>(null);

  const [selectedSite, setSelectedSite] = useState<string>('');

  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [assignmentsStatus, setAssignmentsStatus] = useState<LoadStatus>('idle');
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);

  const [uploadSite, setUploadSite] = useState<string>('');
  const [uploadFileState, setUploadFileState] = useState<File | null>(null);
  const [uploadSourceName, setUploadSourceName] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<LoadStatus>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [deleteStatusById, setDeleteStatusById] = useState<Record<number, LoadStatus>>({});
  const [deleteErrorById, setDeleteErrorById] = useState<Record<number, string>>({});

  // Load sites on mount
  useEffect(() => {
    setSitesStatus('loading');
    setSitesError(null);
    listAssignmentSites()
      .then((data) => {
        setSites(data);
        if (data.length > 0 && !selectedSite) {
          setSelectedSite(data[0]);
          setUploadSite(data[0]);
        }
        setSitesStatus('ready');
      })
      .catch((err) => {
        const message = err?.message || 'Unknown error';
        console.error('Failed to load assignment sites', err);
        setSitesError(`Failed to load assignment sites: ${message}`);
        setSitesStatus('error');
      });
  }, []);

  // Whenever selectedSite changes, sync uploadSite default
  useEffect(() => {
    if (selectedSite && !uploadSite) {
      setUploadSite(selectedSite);
    }
  }, [selectedSite, uploadSite]);

  // Load assignments when selectedSite changes
  useEffect(() => {
    if (!selectedSite) {
      setAssignments([]);
      setAssignmentsError(null);
      setAssignmentsStatus('idle');
      return;
    }

    setAssignmentsStatus('loading');
    setAssignmentsError(null);
    listAssignmentsForSite(selectedSite)
      .then((data) => {
        setAssignments(data);
        setAssignmentsStatus('ready');
      })
      .catch((err) => {
        const message = err?.message || 'Unknown error';
        console.error('Failed to load assignments for site', selectedSite, err);
        setAssignmentsError(`Failed to load assignments for ${selectedSite}: ${message}`);
        setAssignmentsStatus('error');
        setAssignments([]);
      });
  }, [selectedSite]);

  const refreshSitesAndMaybeSelect = async (preferredSite?: string) => {
    setSitesStatus('loading');
    setSitesError(null);
    try {
      const data = await listAssignmentSites();
      setSites(data);
      const targetSite =
        preferredSite && data.includes(preferredSite)
          ? preferredSite
          : data.length > 0
          ? data[0]
          : '';
      setSelectedSite(targetSite);
    } catch (err: any) {
      const message = err?.message || 'Unknown error';
      console.error('Failed to refresh assignment sites', err);
      setSitesError(`Failed to refresh assignment sites: ${message}`);
      setSitesStatus('error');
      return;
    }
    setSitesStatus('ready');
  };

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadSite.trim()) {
      setUploadError('Site is required');
      return;
    }
    if (!uploadFileState) {
      setUploadError('Please choose a file to upload');
      return;
    }

    setUploadStatus('loading');
    setUploadError(null);
    try {
      await uploadAssignmentsFile(uploadSite.trim(), uploadFileState, uploadSourceName.trim() || undefined);
      setUploadStatus('ready');
      // After upload, refresh sites and assignments. This also ensures new sites appear.
      await refreshSitesAndMaybeSelect(uploadSite.trim());
      // Also refresh assignments list explicitly in case selectedSite did not change.
      if (uploadSite.trim() === selectedSite) {
        const data = await listAssignmentsForSite(uploadSite.trim());
        setAssignments(data);
        setAssignmentsStatus('ready');
      }
      // Clear file but leave site and source name for convenience
      setUploadFileState(null);
    } catch (err: any) {
      const message = err?.message || 'Unknown error';
      console.error('Failed to upload assignments file', err);
      setUploadError(`Failed to upload assignments: ${message}`);
      setUploadStatus('error');
    }
  };

  const handleDelete = async (assignmentId: number) => {
    // Simple confirm to avoid accidental deletes
    const confirmed = window.confirm('Delete this assignment? This cannot be undone.');
    if (!confirmed) {
      return;
    }

    setDeleteStatusById((prev) => ({ ...prev, [assignmentId]: 'loading' }));
    setDeleteErrorById((prev) => ({ ...prev, [assignmentId]: '' }));
    try {
      await deleteAssignment(assignmentId);
      // Remove from local list
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      setDeleteStatusById((prev) => ({ ...prev, [assignmentId]: 'ready' }));
    } catch (err: any) {
      const message = err?.message || 'Unknown error';
      console.error('Failed to delete assignment', assignmentId, err);
      setDeleteStatusById((prev) => ({ ...prev, [assignmentId]: 'error' }));
      setDeleteErrorById((prev) => ({ ...prev, [assignmentId]: message }));
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">RF Spectrum Explorer</p>
          <h1>Spectrum assignments</h1>
          <p className="muted">
            Upload and manage assignment overlays (SFAF or JSON) by site.
          </p>
        </div>
        <div className="controls">
          <Link href="/" className="button">
            Home
          </Link>
        </div>
      </header>

      <section style={{ display: 'flex', gap: '1.5rem', padding: '1rem 0' }}>
        {/* Sites sidebar */}
        <aside
          style={{
            width: '260px',
            borderRight: '1px solid #eee',
            paddingRight: '1rem',
          }}
        >
          <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Sites</h2>

          {sitesError && (
            <p className="muted" style={{ color: '#c00', marginBottom: '0.5rem' }}>
              {sitesError}
            </p>
          )}

          {sitesStatus === 'loading' && <p className="muted">Loading sites...</p>}
          {sitesStatus === 'ready' && sites.length === 0 && (
            <p className="muted">No sites have assignments yet. Upload to create one.</p>
          )}

          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              maxHeight: '400px',
              overflowY: 'auto',
            }}
          >
            {sites.map((site) => (
              <li key={site}>
                <button
                  type="button"
                  onClick={() => setSelectedSite(site)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.4rem 0.5rem',
                    marginBottom: '0.1rem',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: site === selectedSite ? '#eef3ff' : 'transparent',
                    cursor: 'pointer',
                    fontWeight: site === selectedSite ? 600 : 400,
                  }}
                >
                  {site}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main panel */}
        <section style={{ flex: 1, minWidth: 0 }}>
          {/* Upload panel */}
          <section
            style={{
              marginBottom: '1.5rem',
              padding: '1rem',
              borderRadius: '6px',
              border: '1px solid #eee',
            }}
          >
            <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Upload assignments</h2>
            <p className="muted" style={{ marginBottom: '0.75rem' }}>
              Enter a site name (existing or new) and upload an SFAF or JSON file. New sites
              will appear in the sidebar after upload.
            </p>

            {uploadError && (
              <p className="muted" style={{ color: '#c00', marginBottom: '0.5rem' }}>
                {uploadError}
              </p>
            )}

            <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <label style={{ flex: '1 1 160px' }}>
                  <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Site
                  </span>
                  <input
                    type="text"
                    value={uploadSite}
                    onChange={(e) => setUploadSite(e.target.value)}
                    placeholder="e.g. MKAB"
                    style={{ width: '100%', padding: '0.4rem 0.5rem' }}
                  />
                </label>

                <label style={{ flex: '1 1 160px' }}>
                  <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Source name (optional)
                  </span>
                  <input
                    type="text"
                    value={uploadSourceName}
                    onChange={(e) => setUploadSourceName(e.target.value)}
                    placeholder="Defaults to SFAF/JSON"
                    style={{ width: '100%', padding: '0.4rem 0.5rem' }}
                  />
                </label>

                <label style={{ flex: '2 1 220px' }}>
                  <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
                    File
                  </span>
                  <input
                    type="file"
                    accept=".sfaf,.json,.txt,.txt.gz"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setUploadFileState(file);
                    }}
                    style={{ width: '100%' }}
                  />
                </label>
              </div>

              <div>
                <button
                  type="submit"
                  className="button"
                  disabled={uploadStatus === 'loading'}
                >
                  {uploadStatus === 'loading' ? 'Uploading…' : 'Upload assignments'}
                </button>
              </div>
            </form>
          </section>

          {/* Assignments list */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '1rem' }}>
                Assignments for{' '}
                <span style={{ fontWeight: 600 }}>
                  {selectedSite || '(no site selected)'}
                </span>
              </h2>
              {assignmentsStatus === 'loading' && <span className="muted">Loading…</span>}
            </div>

            {assignmentsError && (
              <p className="muted" style={{ color: '#c00', marginBottom: '0.5rem' }}>
                {assignmentsError}
              </p>
            )}

            {selectedSite && assignmentsStatus === 'ready' && assignments.length === 0 && !assignmentsError && (
              <p className="muted">No assignments for this site yet.</p>
            )}

            {selectedSite && assignments.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.9rem',
                  }}
                >
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #eee' }}>Serial</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #eee' }}>Source</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #eee' }}>Freq start (Hz)</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #eee' }}>Freq stop (Hz)</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #eee' }}>Center (Hz)</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #eee' }}>Bandwidth (Hz)</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #eee' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a) => {
                      const deleteStatus = deleteStatusById[a.id] ?? 'idle';
                      const deleteError = deleteErrorById[a.id];
                      return (
                        <tr key={a.id}>
                          <td style={{ padding: '0.4rem', borderBottom: '1px solid #f2f2f2' }}>
                            {a.assignment_serial}
                          </td>
                          <td style={{ padding: '0.4rem', borderBottom: '1px solid #f2f2f2' }}>
                            {a.source_name}
                          </td>
                          <td style={{ padding: '0.4rem', borderBottom: '1px solid #f2f2f2' }}>
                            {a.freq_start_hz.toLocaleString()}
                          </td>
                          <td style={{ padding: '0.4rem', borderBottom: '1px solid #f2f2f2' }}>
                            {a.freq_stop_hz.toLocaleString()}
                          </td>
                          <td style={{ padding: '0.4rem', borderBottom: '1px solid #f2f2f2' }}>
                            {a.center_frequency_hz.toLocaleString()}
                          </td>
                          <td style={{ padding: '0.4rem', borderBottom: '1px solid #f2f2f2' }}>
                            {a.bandwidth_hz.toLocaleString()}
                          </td>
                          <td style={{ padding: '0.4rem', borderBottom: '1px solid #f2f2f2' }}>
                            <button
                              type="button"
                              className="button-link"
                              onClick={() => handleDelete(a.id)}
                              disabled={deleteStatus === 'loading'}
                            >
                              {deleteStatus === 'loading' ? 'Deleting…' : 'Delete'}
                            </button>
                            {deleteError && (
                              <div style={{ color: '#c00', fontSize: '0.8rem' }}>
                                {deleteError}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}

