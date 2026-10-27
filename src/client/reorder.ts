import type { MapFile } from "../shared/schema.js";
import { allNodes, branchMoveError, findParent } from "../shared/tree.js";
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
  // Only sibling slots are considered by the reorder gesture.
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

export type BranchDropTarget =
  | ({ kind: "reorder" } & SiblingDropTarget)
  | { kind: "move"; parentId: string }
  | { kind: "invalid"; nodeId: string; message: string };

/** Node centres move branches; sibling edges retain the reorder gesture. */
export function branchDropTarget(
  map: MapFile,
  id: string,
  point: Point,
  positions: Map<string, Point>,
  sizes: Map<string, Size>,
): BranchDropTarget | null {
  const parent = findParent(map.root, id);
  if (!parent) return null;
  for (const node of allNodes(map.root, true)) {
    const position = positions.get(node.id);
    if (!position) continue;
    const size = sizes.get(node.id) ?? DEFAULT_SIZE;
    if (
      point.x < position.x ||
      point.x > position.x + size.width ||
      point.y < position.y ||
      point.y > position.y + size.height
    )
      continue;
    const ratio = (point.y - position.y) / size.height;
    if (
      parent.children.some((sibling) => sibling.id === node.id) &&
      node.id !== id &&
      (ratio < 0.25 || ratio > 0.75)
    ) {
      const target = siblingDropTarget(map, id, point, positions, sizes);
      return target && { kind: "reorder", ...target };
    }
    const error = branchMoveError(map.root, id, node.id);
    return error
      ? { kind: "invalid", nodeId: node.id, message: error }
      : { kind: "move", parentId: node.id };
  }
  const target = siblingDropTarget(map, id, point, positions, sizes);
  return target && { kind: "reorder", ...target };
}
