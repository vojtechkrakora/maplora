import { useEffect, useRef, useState, type ReactNode } from "react";
import { TitleSchema } from "../../shared/schema.js";
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          if (e.key === "Tab") {
            const elements = Array.from(
              ref.current!.querySelectorAll<HTMLElement>(
                "input:not(:disabled),button:not(:disabled),a[href]",
              ),
            );
            const first = elements[0],
              last = elements[elements.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            }
            if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
export function TitleDialog({
  initial = "",
  mode,
  onClose,
  onSubmit,
}: {
  initial?: string;
  mode: "Create" | "Rename";
  onClose(): void;
  onSubmit(title: string): Promise<void>;
}) {
  const [title, setTitle] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={mode === "Create" ? "A new place to think" : "Rename mind map"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!TitleSchema.safeParse(title).success) {
            setError("Enter a title of 1–100 characters.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await onSubmit(title);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label htmlFor="map-title">Map title</label>
        <input
          id="map-title"
          placeholder="What’s on your mind?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby={error ? "title-error" : undefined}
        />
        <div className="field-hint">{title.length}/100 characters</div>
        {error && (
          <p className="error-text" id="title-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : `${mode} map`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
