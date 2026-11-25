import type { MapNode } from "./schema.js";

export interface CompletionState {
  effective: boolean;
  ancestor?: MapNode;
}

// One traversal, including hidden descendants. No derived state is persisted.
export function branchCompletion(root: MapNode): Map<string, CompletionState> {
  const result = new Map<string, CompletionState>();
  const stack: { node: MapNode; ancestor?: MapNode }[] = [{ node: root }];
  while (stack.length) {
    const { node, ancestor } = stack.pop()!;
    result.set(node.id, {
      effective: !!(node.completed || ancestor),
      ancestor,
    });
    for (const child of node.children)
      stack.push({ node: child, ancestor: node.completed ? node : ancestor });
  }
  return result;
}
