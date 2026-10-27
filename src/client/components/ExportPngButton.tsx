import { useEffect, useRef, useState } from "react";
import type { MapFile } from "../../shared/schema.js";

export function ExportPngButton({ map }: { map: MapFile }) {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setBusy(false);
    setError("");
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [map.id]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);
  return (
    <>
      <button
        className="export-png"
        aria-label="Export PNG"
        title="Export PNG"
        disabled={busy}
        onPointerDown={(event) => event.preventDefault()}
        onClick={async () => {
          if (active.current) return;
          const controller = new AbortController();
          active.current = controller;
          setBusy(true);
          setError("");
          try {
            const { downloadMapPng } = await import("../pngExport");
            await downloadMapPng(map, controller.signal);
          } catch (failure) {
            if (!controller.signal.aborted)
              setError(
                `Could not export PNG. ${(failure as Error).message || "Please try again."}`,
              );
          } finally {
            if (active.current === controller) {
              active.current = null;
              setBusy(false);
            }
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
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8" cy="8" r="1.5" />
          <path d="m3 17 5-5 4 4 4-6 5 7" />
        </svg>
        <span className="desktop-label">
          {busy ? "Exporting…" : "Export PNG"}
        </span>
      </button>
      {busy && (
        <div className="export-progress-toast" role="status">
          Preparing PNG…
        </div>
      )}
      {error && (
        <div className="export-error-toast" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
