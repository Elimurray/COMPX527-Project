import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoundingBox, Report } from '@derf/shared';
import { listReports } from './lib/api';
import { currentUser, signOut, type AuthUser } from './lib/auth';
import { MapView } from './components/MapView';
import { AuthPanel } from './components/AuthPanel';
import { ReportForm } from './components/ReportForm';

/** How long after a submission to re-check for the stored report. */
const PIPELINE_SETTLE_MS = 2500;

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickedLocation, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const bounds = useRef<BoundingBox | null>(null);

  useEffect(() => {
    currentUser()
      .then(setUser)
      .finally(() => setCheckingSession(false));
  }, []);

  const refresh = useCallback(async () => {
    if (!bounds.current) return;
    try {
      setReports(await listReports(bounds.current));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reports');
    }
  }, []);

  const handleBounds = useCallback(
    (bbox: BoundingBox) => {
      bounds.current = bbox;
      void refresh();
    },
    [refresh],
  );

  const handlePick = useCallback((lat: number, lon: number) => {
    setPicked({ lat, lon });
    setPicking(false);
  }, []);

  /**
   * Submission returns 202 — accepted, not stored. The report travels through
   * SQS before it lands in DynamoDB, so re-reading immediately would usually
   * miss it. Say so plainly, then refresh once the pipeline has had a moment.
   */
  const handleSubmitted = useCallback(() => {
    setPicked(null);
    setNotice('Report accepted. It appears on the map once processed.');
    window.setTimeout(() => {
      void refresh();
      setNotice(null);
    }, PIPELINE_SETTLE_MS);
  }, [refresh]);

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <h1>Resource Finder</h1>
            <p>Community reports, live</p>
          </div>
        </div>
        <div className="session">
          {user ? (
            <>
              <span className="who">{user.email}</span>
              <button
                type="button"
                className="link"
                onClick={() => {
                  signOut();
                  setUser(null);
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <span className="hint">Viewing as guest</span>
          )}
        </div>
      </header>

      <main className="main">
        <MapView
          reports={reports}
          onBoundsChange={handleBounds}
          onPickLocation={handlePick}
          picking={picking}
        />

        <aside className="sidebar">
          <section className="panel summary">
            <h2>In view</h2>
            <p className="count">{reports.length}</p>
            <p className="hint">
              {reports.length === 0
                ? 'No reports in this area yet. Pan or zoom to search elsewhere.'
                : 'Select a marker for detail.'}
            </p>
            {error && <p className="error">{error}</p>}
          </section>

          {notice && <p className="notice">{notice}</p>}

          {checkingSession ? (
            <p className="hint">Checking session…</p>
          ) : user ? (
            <ReportForm
              location={pickedLocation}
              onStartPicking={() => setPicking(true)}
              onSubmitted={handleSubmitted}
            />
          ) : (
            <AuthPanel onSignedIn={setUser} />
          )}

          {picking && <p className="notice">Click the map to place your report.</p>}
        </aside>
      </main>
    </div>
  );
}
