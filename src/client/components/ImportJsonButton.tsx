import { useEffect, useRef, useState } from "react";
import type { MapSummary } from "../../shared/schema.js";
import { useMapListStore } from "../stores/mapListStore";
import { readMapJson } from "../jsonTransfer";
import { Dialog } from "./Dialog";

export function ImportJsonButton({
  onImported,
}: {
  onImported(summary: MapSummary): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const loading = useMapListStore((state) => state.loading);
  const mounted = useRef(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Import JSON file"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || busy.current || loading) return;
          busy.current = true;
          setImporting(true);
          setError(null);
          setImported(null);
          try {
            const map = await readMapJson(file);
            if (!mounted.current) return;
            const summary = await useMapListStore.getState().importMap(map);
            if (mounted.current) {
              setImported(summary.title);
              onImported(summary);
            }
          } catch (failure) {
            if (mounted.current) setError((failure as Error).message);
          } finally {
            busy.current = false;
            if (mounted.current) setImporting(false);
          }
        }}
      />
      <div>
        <button
          disabled={importing || loading}
          onClick={() => input.current?.click()}
        >
          {importing ? "Importing…" : "Import JSON"}
        </button>
        {imported && (
          <p className="import-status" role="status">
            Imported “{imported}”.
          </p>
        )}
      </div>
      {error && (
        <Dialog title="Could not import map" onClose={() => setError(null)}>
          <p className="error-text" role="alert">
            {error}
          </p>
          <div className="dialog-actions">
            <button onClick={() => setError(null)}>Close</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
