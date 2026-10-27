import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import type { MapSummary } from "../../shared/schema.js";
import { Brand } from "../components/Brand";
export function TrashPage() {
  const [maps, setMaps] = useState<MapSummary[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => {
    setLoading(true);
    setError("");
    api
      .fetchTrash()
      .then(setMaps)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  return (
    <div className="library">
      <header className="app-header">
        <Brand />
        <Link to="/" className="quiet-link">
          ← All mind maps
        </Link>
      </header>
      <main className="library-main">
        <div className="eyebrow">A SECOND CHANCE FOR IDEAS</div>
        <div className="page-heading">
          <div>
            <h1>Trash.</h1>
            <p className="subtitle">
              Your maps stay here until you’re ready to let go.
            </p>
          </div>
          <button
            className="danger"
            disabled={!maps.length || busy}
            onClick={async () => {
              if (
                !window.confirm(
                  "Permanently delete every map in Trash? This cannot be undone.",
                )
              )
                return;
              setBusy(true);
              try {
                await api.emptyTrash();
                setMaps([]);
                setNotice("Trash emptied.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Empty Trash
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={load}>Retry</button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {loading ? (
          <p role="status">Loading trash…</p>
        ) : !maps.length ? (
          <div className="empty-state">
            <h2>A clean slate.</h2>
            <p>Your trash is empty.</p>
            <Link to="/">Back to your maps</Link>
          </div>
        ) : (
          <div className="trash-list">
            {maps.map((map) => (
              <article className="trash-row" key={map.id}>
                <div>
                  <h2>{map.title}</h2>
                  {map.updatedAt && (
                    <time>{new Date(map.updatedAt).toLocaleString()}</time>
                  )}
                  {map.error && (
                    <span className="error-text">File could not be read</span>
                  )}
                </div>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(`Restore “${map.title}” to your maps?`))
                      return;
                    setBusy(true);
                    try {
                      await api.restoreMap(map.id);
                      setMaps(maps.filter((m) => m.id !== map.id));
                      setNotice(`“${map.title}” restored.`);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Restore
                </button>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
