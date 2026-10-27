import { useEffect, useState } from "react";
import type { MapFile } from "../../shared/schema.js";
import { downloadMapJson } from "../jsonTransfer";

export function ExportJsonButton({ map }: { map: MapFile }) {
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [map.id]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(false), 3000);
    return () => window.clearTimeout(timer);
  }, [error]);
  return (
    <>
      <button
        className="export-json"
        aria-label="Export JSON"
        title="Export JSON"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          setError(false);
          try {
            downloadMapJson(map);
          } catch {
            setError(true);
          }
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
        </svg>
        <span className="desktop-label">Export JSON</span>
      </button>
      {error && (
        <div className="export-error-toast" role="alert">
          Could not export JSON. Please try again.
        </div>
      )}
    </>
  );
}
