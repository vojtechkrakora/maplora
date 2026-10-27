import type { MapFile } from "../shared/schema.js";
import { allNodes, findParent } from "../shared/tree.js";
import { DEFAULT_SIZE, type Point, type Size } from "./layout";

export interface SiblingDropTarget {
  siblingId: string;
  placement: "before" | "after";
  index: number;
}

/** Hit-test the original layout; the dragged label never changes the tree. */
export function siblingDropTarget(
  map: MapFile,
  id: string,
  point: Point,
  positions: Map<string, Point>,
  sizes: Map<string, Size>,
): SiblingDropTarget | null {
  const parent = findParent(map.root, id);
  if (!parent) return null;
  const siblings = parent.children.filter((node) => node.id !== id);
  const box = (nodeId: string) => {
    const position = positions.get(nodeId);
    return position && { ...position, ...(sizes.get(nodeId) ?? DEFAULT_SIZE) };
  };
  const contains = (rect: Point & Size, padding = 0) =>
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.height + padding;
  const siblingIds = new Set(siblings.map((node) => node.id));
  // Reparenting is a later task: dropping on any other branch is invalid.
  for (const node of allNodes(map.root, true)) {
    const rect = box(node.id);
    if (node.id !== id && !siblingIds.has(node.id) && rect && contains(rect))
      return null;
  }
  let best: (SiblingDropTarget & { distance: number }) | null = null;
  for (const [index, node] of siblings.entries()) {
    const rect = box(node.id);
    if (!rect || !contains(rect, 24)) continue;
    const after = point.y >= rect.y + rect.height / 2;
    const targetIndex = index + (after ? 1 : 0);
    const distance = Math.hypot(
      point.x - Math.max(rect.x, Math.min(point.x, rect.x + rect.width)),
      point.y - (rect.y + (after ? rect.height : 0)),
    );
    if (!best || distance < best.distance)
      best = {
        siblingId: node.id,
        placement: after ? "after" : "before",
        index: targetIndex,
        distance,
      };
  }
  const target = best;
  if (
    !target ||
    target.index === parent.children.findIndex((node) => node.id === id)
  )
    return null;
  return {
    siblingId: target.siblingId,
    placement: target.placement,
    index: target.index,
  };
}
