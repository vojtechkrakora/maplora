import type { CSSProperties } from "react";
import type { NodeStyle } from "../shared/schema.js";

export function nodeAppearance(style?: NodeStyle): CSSProperties {
  return {
    backgroundColor: style?.backgroundColor,
    color: style?.textColor,
    borderColor: style?.borderColor,
  };
}

export function connectorAppearance(style?: NodeStyle): CSSProperties {
  const width = style?.connectorWidth ?? 2;
  return {
    stroke: style?.connectorColor ?? "var(--edge)",
    strokeWidth: width,
    strokeDasharray:
      style?.connectorStyle === "dashed"
        ? `${width * 4} ${width * 2}`
        : style?.connectorStyle === "dotted"
          ? `0 ${width * 3}`
          : undefined,
    strokeLinecap: style?.connectorStyle === "dotted" ? "round" : "butt",
  };
}
