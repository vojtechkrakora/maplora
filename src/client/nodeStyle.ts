import type { CSSProperties } from "react";
import type { NodeStyle } from "../shared/schema.js";

export function defaultNodeBackground(depth: number): string {
  return depth === 0
    ? "var(--node-bg-root)"
    : `var(--node-bg-depth-${depth % 6})`;
}

export function nodeAppearance(
  style?: NodeStyle,
  depth = 0,
  completed = false,
): CSSProperties {
  return {
    backgroundColor: style?.backgroundColor ?? defaultNodeBackground(depth),
    color:
      style?.textColor ??
      (completed && !style?.backgroundColor
        ? "var(--completed-text)"
        : undefined),
    borderColor: style?.borderColor,
  };
}

export function connectorAppearance(
  style?: NodeStyle,
  completed = false,
): CSSProperties {
  const width = style?.connectorWidth ?? 2;
  return {
    stroke: style?.connectorColor ?? "var(--edge)",
    strokeWidth: width,
    ...(completed ? { opacity: 0.65 } : {}),
    strokeDasharray:
      style?.connectorStyle === "dashed"
        ? `${width * 4} ${width * 2}`
        : style?.connectorStyle === "dotted"
          ? `0 ${width * 3}`
          : undefined,
    strokeLinecap: style?.connectorStyle === "dotted" ? "round" : "butt",
  };
}
