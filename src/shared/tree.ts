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
export function branchMoveError(
  root: MapNode,
  id: string,
  newParentId: string,
): string | null {
  const node = findNode(root, id);
  if (!node) return "The node no longer exists.";
  if (node === root) return "The root node cannot be moved.";
  if (id === newParentId) return "A branch cannot be moved into itself.";
  if (!findNode(root, newParentId)) return "The new parent no longer exists.";
  if (findParent(root, id)?.id === newParentId)
    return "This node is already under that parent.";
  if (findNode(node, newParentId))
    return "A branch cannot be moved into one of its descendants.";
  return null;
}
