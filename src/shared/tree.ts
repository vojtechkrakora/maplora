import type { MapNode } from "./schema.js";
export function allNodes(root: MapNode, visibleOnly = false): MapNode[] {
  const result: MapNode[] = [],
    stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    result.push(n);
    if (!visibleOnly || !n.collapsed || n === root)
      stack.push(...[...n.children].reverse());
  }
  return result;
}
export function findNode(root: MapNode, id: string) {
  return allNodes(root).find((n) => n.id === id);
}
export function findParent(root: MapNode, id: string) {
  return allNodes(root).find((n) => n.children.some((c) => c.id === id));
}
