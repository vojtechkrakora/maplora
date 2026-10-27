import {
  BaseEdge,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { NodeStyle } from "../../shared/schema.js";
import { connectorAppearance } from "../nodeStyle";

export function MindMapEdge(props: EdgeProps<Edge<{ style?: NodeStyle }>>) {
  const [path] = getBezierPath(props);
  return (
    <BaseEdge
      id={props.id}
      path={path}
      style={connectorAppearance(props.data?.style)}
    />
  );
}
