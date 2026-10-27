import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMapListStore, type SortOrder } from "../stores/mapListStore";
import { Brand, MapGlyph } from "../components/Brand";
import { TitleDialog } from "../components/Dialog";
import { ThemeToggle } from "../components/ThemeToggle";
import type { MapSummary } from "../../shared/schema.js";

function MapListControls() {
  const searchQuery = useMapListStore((s) => s.searchQuery);
  const setSearchQuery = useMapListStore((s) => s.setSearchQuery);
  const sortOrder = useMapListStore((s) => s.sortOrder);
  const setSortOrder = useMapListStore((s) => s.setSortOrder);
  const [input, setInput] = useState(searchQuery);
  useEffect(() => setInput(searchQuery), [searchQuery]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(input), 50);
    return () => window.clearTimeout(timer);
  }, [input, setSearchQuery]);
  return (
    <div className="library-controls">
      <label className="library-search">
        Search maps
        <input
          type="search"
          placeholder="Find a mind map…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </label>
      <label>
        Sort maps
        <select
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as SortOrder)}
        >
          <option value="updatedAt_desc">Last edited (descending)</option>
          <option value="updatedAt_asc">Last edited (ascending)</option>
          <option value="title_asc">Title (A → Z)</option>
          <option value="title_desc">Title (Z → A)</option>
        </select>
      </label>
    </div>
  );
}
export function MapListPage() {
  const s = useMapListStore(),
    navigate = useNavigate(),
    location = useLocation();
  const [dialog, setDialog] = useState<"create" | MapSummary | null>(null),
    [error, setError] = useState<string | null>(location.state?.error ?? null),
    [duplicating, setDuplicating] = useState<Set<string>>(() => new Set());
  const maps = useMemo(
    () => s.filteredAndSortedMaps(),
    [s.maps, s.searchQuery, s.sortOrder, s.filteredAndSortedMaps],
  );
  useEffect(() => {
    void s.fetchMaps();
  }, [s.fetchMaps]);
  return (
    <div className="library">
      <header className="app-header">
        <Brand />
        <nav>
          <span className="local-badge">
            <i />
            Your private workspace
          </span>
          <ThemeToggle />
          <Link to="/trash" className="quiet-link">
            Trash <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>
      <main className="library-main">
        <div className="eyebrow">A LITTLE ROOM TO THINK</div>
        <div className="page-heading">
          <div>
            <h1>Your mind, mapped.</h1>
            <p className="subtitle">Give your ideas space to grow.</p>
          </div>
          <button className="primary" onClick={() => setDialog("create")}>
            <span aria-hidden="true">＋</span> New mind map
          </button>
        </div>
        {(error || s.error) && (
          <div className="error-banner" role="alert">
            {error || s.error}
            <button
              onClick={() => {
                setError(null);
                void s.fetchMaps();
              }}
            >
              Retry
            </button>
          </div>
        )}
        <MapListControls />
        <div className="section-label">
          <span>
            YOUR MAPS <span className="count">{s.maps.length}</span>
          </span>
          <span role="status">
            {s.searchQuery ? `${maps.length} matching maps` : ""}
          </span>
        </div>
        {s.loading ? (
          <div className="empty-state" role="status">
            Gathering your ideas…
          </div>
        ) : s.searchQuery && !maps.length ? (
          <div className="empty-state">
            <h2>No results for “{s.searchQuery}”</h2>
            <p>Try another title or clear your search to see all maps.</p>
            <button onClick={() => s.setSearchQuery("")}>Clear search</button>
          </div>
        ) : !s.maps.length ? (
          <div className="empty-state">
            <div className="empty-glyph">
              <MapGlyph />
            </div>
            <h2>Every idea starts somewhere.</h2>
            <p>Create a mind map and see where your thoughts take you.</p>
            <button className="primary" onClick={() => setDialog("create")}>
              Create your first mind map
            </button>
          </div>
        ) : (
          <div className="map-grid">
            {maps.map((map) => (
              <article
                className={`map-card ${map.error ? "corrupt" : ""}`}
                key={map.id}
              >
                <Link className="map-open" to={`/maps/${map.id}`}>
                  <div className="map-thumbnail">
                    <MapGlyph />
                  </div>
                  <div className="map-info">
                    <h2>{map.title}</h2>
                    {map.updatedAt && (
                      <time dateTime={map.updatedAt}>
                        {new Date(map.updatedAt).toLocaleString()}
                      </time>
                    )}
                    {map.error && (
                      <span className="error-text">
                        ⚠ File could not be read
                      </span>
                    )}
                  </div>
                </Link>
                <div className="card-actions">
                  <button
                    disabled={map.error}
                    aria-label={`Rename ${map.title}`}
                    onClick={() => setDialog(map)}
                  >
                    Rename
                  </button>
                  <button
                    disabled={map.error || duplicating.has(map.id)}
                    aria-label={`Duplicate ${map.title}`}
                    onClick={async () => {
                      setDuplicating((ids) => new Set(ids).add(map.id));
                      setError(null);
                      try {
                        await s.duplicateMap(map.id);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setDuplicating((ids) => {
                          const next = new Set(ids);
                          next.delete(map.id);
                          return next;
                        });
                      }
                    }}
                  >
                    {duplicating.has(map.id) ? "Duplicating…" : "Duplicate"}
                  </button>
                  <button
                    aria-label={`Delete ${map.title}`}
                    onClick={async () => {
                      if (
                        window.confirm(
                          `Move “${map.title}” to Trash? You can restore it later.`,
                        )
                      )
                        try {
                          await s.deleteMap(map.id);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                    }}
                  >
                    Trash
                  </button>
                </div>
              </article>
            ))}
            <button
              className="new-map-card"
              onClick={() => setDialog("create")}
            >
              <span aria-hidden="true">＋</span>Make room for another idea
            </button>
          </div>
        )}
      </main>
      <footer className="library-footer">
        <span>Made for wandering minds.</span>
        <span>Stored on your server. Always yours.</span>
      </footer>
      {dialog && (
        <TitleDialog
          mode={dialog === "create" ? "Create" : "Rename"}
          initial={dialog === "create" ? "" : dialog.title}
          onClose={() => setDialog(null)}
          onSubmit={async (title) => {
            if (dialog === "create")
              navigate(`/maps/${await s.createMap(title)}`);
            else await s.renameMap(dialog.id, title);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
