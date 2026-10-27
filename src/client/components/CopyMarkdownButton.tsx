import { useEffect, useRef, useState } from "react";
import type { MapFile } from "../../shared/schema.js";
import { mapToMarkdown } from "../markdownExport";

export function CopyMarkdownButton({ map }: { map: MapFile }) {
  const [feedback, setFeedback] = useState<{ error: boolean } | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    setFeedback(null);
    return () => {
      latest.current++;
    };
  }, [map.id]);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  async function copy() {
    const request = ++latest.current;
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(mapToMarkdown(map));
      if (latest.current === request) setFeedback({ error: false });
    } catch {
      if (latest.current === request) setFeedback({ error: true });
    }
  }
  return (
    <>
      <button
        className="copy-markdown"
        aria-label="Copy as Markdown"
        title="Copy as Markdown"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => void copy()}
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
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
        </svg>
        <span className="desktop-label">Copy as Markdown</span>
      </button>
      {feedback && (
        <div
          className={`clipboard-toast${feedback.error ? " clipboard-error" : ""}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.error
            ? "Could not copy to clipboard"
            : "Copied to clipboard"}
        </div>
      )}
    </>
  );
}
