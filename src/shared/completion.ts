import type { MapNode } from "./schema.js";

export interface CompletionState {
  effective: boolean;
  descendants: number;
  completedDescendants: number;
  percentage?: number;
}

// Two linear passes, including collapsed descendants. Old branch flags still
// cover their subtree; mutations materialize these before changing a child.
export function branchCompletion(root: MapNode): Map<string, CompletionState> {
  const result = new Map<string, CompletionState>();
  const order: { node: MapNode; covered: boolean }[] = [];
  const stack = [{ node: root, covered: false }];
  while (stack.length) {
    const { node, covered } = stack.pop()!;
    const done = covered || !!node.completed;
    order.push({ node, covered: done });
    for (const child of node.children)
      stack.push({ node: child, covered: done });
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const { node, covered } = order[i];
    let descendants = 0,
      completedDescendants = 0;
    for (const child of node.children) {
      const state = result.get(child.id)!;
      descendants += 1 + state.descendants;
      completedDescendants +=
        Number(state.effective) + state.completedDescendants;
    }
    const effective =
      covered || (descendants > 0 && descendants === completedDescendants);
    const percentage =
      descendants > 0 && completedDescendants > 0
        ? Math.round((completedDescendants * 100) / descendants)
        : undefined;
    result.set(node.id, {
      effective,
      descendants,
      completedDescendants,
      percentage: percentage === 100 ? undefined : percentage,
    });
  }
  return result;
}

// Mutate only an owned clone, never the live map or clipboard snapshot. This
// preserves old completed branches when an individual child is reopened/added.
export function materializeCompletion(root: MapNode): void {
  const states = branchCompletion(root);
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (states.get(node.id)!.effective) node.completed = true;
    else delete node.completed;
    stack.push(...node.children);
  }
}

// Internal flags cannot keep a branch complete after a child was reopened.
export function reconcileCompletion(root: MapNode): void {
  const order: MapNode[] = [],
    stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    order.push(node);
    stack.push(...node.children);
  }
  const done = new Map<string, boolean>();
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i];
    const effective = node.children.length
      ? node.children.every((child) => done.get(child.id))
      : !!node.completed;
    if (!effective) delete node.completed;
    done.set(node.id, effective);
  }
}
