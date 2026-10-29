import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MAX_TAGS, TagSchema, type MapSummary } from "../../shared/schema.js";
import { useMapListStore } from "../stores/mapListStore";
import { tagColor } from "../tagColor";
import { Dialog } from "./Dialog";

function tagStyle(tag: string) {
  const { background, foreground } = tagColor(tag);
  return { backgroundColor: background, color: foreground };
}

export function MapTags({ map }: { map: MapSummary }) {
  const [open, setOpen] = useState(false);
  const tags = map.tags ?? [];
  return (
    <>
      {tags.length > 0 && (
        <ul className="map-tags" aria-label={`Tags for ${map.title}`}>
          {tags.slice(0, 5).map((tag, index) => (
            <li className="tag-chip" style={tagStyle(tag)} key={index}>
              {tag}
            </li>
          ))}
          {tags.length > 5 && (
            <li
              className="tag-chip tag-count"
              aria-label={`${tags.length - 5} more tags`}
            >
              +{tags.length - 5}
            </li>
          )}
        </ul>
      )}
      <button
        className="manage-tags"
        disabled={map.error}
        aria-label={`Manage tags for ${map.title}`}
        onClick={() => setOpen(true)}
      >
        Tags
      </button>
      {open &&
        createPortal(
          <TagDialog map={map} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}

function TagDialog({ map, onClose }: { map: MapSummary; onClose(): void }) {
  const s = useMapListStore();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!busy) field.current?.focus();
  }, [busy]);
  const tags = map.tags ?? [];
  const suggestions = s
    .allTags()
    .filter(
      (tag) =>
        !tags.includes(tag) && tag.toLowerCase().includes(input.toLowerCase()),
    );
  async function save(next: string[], adding = false) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await s.updateTags(map.id, next);
      if (adding) setInput("");
    } catch (e) {
      setError(`Tags could not be saved: ${(e as Error).message}`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Tags for ${map.title}`}
      onClose={() => {
        if (!saving.current) onClose();
      }}
    >
      <p className="subtitle">
        Add tags to organize this map. Changes save automatically.
      </p>
      <form
        className="tag-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (saving.current) return;
          const parsed = TagSchema.safeParse(input);
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          if (tags.length >= MAX_TAGS) {
            setError("A map can have at most 20 tags.");
            return;
          }
          if (tags.includes(input)) {
            setError("This tag is already assigned.");
            return;
          }
          void save([...tags, input], true);
        }}
      >
        <label htmlFor={id}>New tag</label>
        <div className="tag-input-row">
          <input
            ref={field}
            id={id}
            list={`${id}-suggestions`}
            autoComplete="off"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError("");
            }}
            disabled={busy}
            aria-invalid={!!error}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          />
          <datalist id={`${id}-suggestions`}>
            {suggestions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <button className="primary" disabled={busy}>
            Add tag
          </button>
        </div>
        <p className="field-hint" id={`${id}-hint`}>
          1–32 characters, no commas. {tags.length}/20 tags.
        </p>
        {error && (
          <p className="error-text" id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
      </form>
      {tags.length > 0 ? (
        <ul className="tag-editor-list" aria-label="Assigned tags">
          {tags.map((tag, index) => (
            <li className="tag-chip" style={tagStyle(tag)} key={index}>
              <span>{tag}</span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove tag ${tag}`}
                onClick={() => void save(tags.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tag-empty">No tags assigned.</p>
      )}
      <div className="dialog-actions">
        <span role="status">{busy ? "Saving tags…" : ""}</span>
        <button onClick={onClose} disabled={busy}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

export function TagFilter() {
  const s = useMapListStore();
  const tags = s.allTags();
  // Keep an active tag removable even when its last map is deleted or retagged.
  const choices = [
    ...tags,
    ...s.activeTags.filter((tag) => !tags.includes(tag)),
  ];
  return (
    <details className="tag-filter">
      <summary>
        Filter by tags
        {s.activeTags.length > 0 && (
          <span className="count">{s.activeTags.length}</span>
        )}
      </summary>
      <div className="tag-filter-panel">
        <fieldset>
          <legend>Match all selected tags</legend>
          {choices.length ? (
            <div className="tag-filter-choices">
              {choices.map((tag) => (
                <label
                  className={s.activeTags.includes(tag) ? "active" : ""}
                  style={tagStyle(tag)}
                  key={tag}
                >
                  <input
                    type="checkbox"
                    checked={s.activeTags.includes(tag)}
                    onChange={(event) =>
                      s.setActiveTags(
                        event.target.checked
                          ? [...s.activeTags, tag]
                          : s.activeTags.filter((active) => active !== tag),
                      )
                    }
                  />
                  <span>{tag}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="tag-empty">No tags yet. Add tags from a map card.</p>
          )}
        </fieldset>
        <button
          type="button"
          disabled={!s.activeTags.length}
          onClick={() => s.setActiveTags([])}
        >
          Clear all tags
        </button>
      </div>
    </details>
  );
}
