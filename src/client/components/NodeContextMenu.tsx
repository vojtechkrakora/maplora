import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MapNode, NodeStyle } from "../../shared/schema.js";
import {
  connectorAppearance,
  defaultNodeBackground,
  nodeAppearance,
} from "../nodeStyle";
import { useEditorStore } from "../stores/editorStore";
import { useThemeStore } from "../stores/themeStore";

function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value?: string;
  fallback: string;
  onChange(value: string | undefined): void;
}) {
  const swatch = useRef<HTMLSpanElement>(null);
  const theme = useThemeStore((state) => state.theme);
  const [color, setColor] = useState("#000000");
  useLayoutEffect(() => {
    // Resolve stored CSS colors and theme variables for the native color input.
    const rgb = getComputedStyle(swatch.current!).color.match(
      /^rgba?\((\d+),\s*(\d+),\s*(\d+)/,
    );
    if (rgb)
      setColor(
        "#" +
          rgb
            .slice(1, 4)
            .map((part) => Number(part).toString(16).padStart(2, "0"))
            .join(""),
      );
  }, [value, fallback, theme]);
  return (
    <div className="style-color-field">
      <label>
        <span>{label}</span>
        <input
          type="color"
          value={color}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <span
        className="style-color-value"
        ref={swatch}
        style={{ color: value ?? fallback }}
      >
        <span>{value ?? "Theme default"}</span>
      </span>
      <button
        type="button"
        aria-label={`Reset ${label.toLowerCase()}`}
        disabled={value === undefined}
        onClick={() => onChange(undefined)}
      >
        Reset
      </button>
    </div>
  );
}

export function NodeContextMenu({
  node,
  root,
  depth,
  onClose,
}: {
  node: MapNode;
  root: boolean;
  depth: number;
  onClose(): void;
}) {
  const updateNodeStyle = useEditorStore((state) => state.updateNodeStyle);
  const lineStyleId = useId();
  const [patch, setPatch] = useState<Partial<NodeStyle>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const style = { ...node.style, ...patch };
  const change = (value: Partial<NodeStyle>) =>
    setPatch((previous) => ({ ...previous, ...value }));
  const changed = (Object.keys(patch) as (keyof NodeStyle)[]).some(
    (key) => patch[key] !== node.style?.[key],
  );
  return (
    <aside
      className="node-options"
      aria-label="Node options"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          if (!busy) onClose();
        }
      }}
    >
      <header className="node-options-heading">
        <h2>Node options</h2>
        <button
          aria-label="Close node options"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <form
        className="node-style-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !changed) return;
          setBusy(true);
          setError("");
          try {
            const saved = await updateNodeStyle(node.id, patch);
            if (!mounted.current) return;
            if (saved) onClose();
            else setError("Style could not be saved. Try again.");
          } catch (failure) {
            if (mounted.current) setError((failure as Error).message);
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        <p className="subtitle style-node-name">{node.text}</p>
        <fieldset disabled={busy}>
          <legend>Node colors</legend>
          <ColorField
            label="Background color"
            value={style.backgroundColor}
            fallback={defaultNodeBackground(depth)}
            onChange={(backgroundColor) => change({ backgroundColor })}
          />
          <ColorField
            label="Text color"
            value={style.textColor}
            fallback="var(--text)"
            onChange={(textColor) => change({ textColor })}
          />
          <h3 className="connector-heading">Connectors</h3>
          <p className="field-hint">
            Applies to lines from this node to its children.
          </p>
          <ColorField
            label="Connector color"
            value={style.connectorColor}
            fallback="var(--edge)"
            onChange={(connectorColor) => change({ connectorColor })}
          />
          <div className="style-line-field">
            <label htmlFor={lineStyleId}>Line style</label>
            <select
              id={lineStyleId}
              value={style.connectorStyle ?? ""}
              onChange={(event) =>
                change({
                  connectorStyle: (event.target.value ||
                    undefined) as NodeStyle["connectorStyle"],
                })
              }
            >
              <option value="">Theme default (solid)</option>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>
          <div className="style-width-field">
            <label>
              Line thickness{" "}
              <span>
                {style.connectorWidth ?? 2}px
                {style.connectorWidth === undefined ? " · Theme default" : ""}
              </span>
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                value={style.connectorWidth ?? 2}
                onChange={(event) =>
                  change({ connectorWidth: Number(event.target.value) })
                }
              />
            </label>
            <button
              type="button"
              aria-label="Reset line thickness"
              disabled={style.connectorWidth === undefined}
              onClick={() => change({ connectorWidth: undefined })}
            >
              Reset
            </button>
          </div>
          <div className="style-preview" aria-label="Style preview">
            <div
              className={`mind-node ${root ? "root-node" : ""}`}
              style={nodeAppearance(style, depth)}
            >
              Your idea
            </div>
            <svg width="80" height="30" aria-hidden="true">
              <path d="M 0 15 L 80 15" style={connectorAppearance(style)} />
            </svg>
          </div>
          <button
            type="button"
            onClick={() =>
              change({
                backgroundColor: undefined,
                textColor: undefined,
                borderColor: undefined,
                connectorColor: undefined,
                connectorStyle: undefined,
                connectorWidth: undefined,
              })
            }
          >
            Restore theme defaults
          </button>
        </fieldset>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !changed}>
            {busy ? "Saving…" : "Apply style"}
          </button>
        </div>
      </form>
    </aside>
  );
}
