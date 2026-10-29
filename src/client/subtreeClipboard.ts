import { MapNodeSchema, UUIDSchema, type MapNode } from "../shared/schema.js";
import { allNodes } from "../shared/tree.js";
import { newNodeId } from "./id";

export function snapshotSubtree(root: MapNode): MapNode {
  const copy = MapNodeSchema.parse(root);
  const ids = allNodes(copy).map((node) => node.id.toLowerCase());
  if (new Set(ids).size !== ids.length)
    throw new Error("The subtree contains duplicate node IDs.");
  return copy;
}

export function encodeSubtree(root: MapNode): string {
  return JSON.stringify({
    type: "maplora/subtree",
    version: 1,
    root: snapshotSubtree(root),
  });
}

export type SubtreePayload =
  | { kind: "unrelated" }
  | { kind: "invalid"; message: string }
  | { kind: "subtree"; root: MapNode };

export function decodeSubtree(text: string): SubtreePayload {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return /["']type["']\s*:\s*["']maplora\/subtree["']/.test(text)
      ? { kind: "invalid", message: "The Maplora subtree JSON is malformed." }
      : { kind: "unrelated" };
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    value.type !== "maplora/subtree"
  )
    return { kind: "unrelated" };
  if (!("version" in value) || value.version !== 1)
    return {
      kind: "invalid",
      message: "This Maplora subtree version is unsupported.",
    };
  try {
    if (
      Object.keys(value).some(
        (key) => !["type", "version", "root"].includes(key),
      ) ||
      !("root" in value)
    )
      throw new Error("Invalid envelope");
    return { kind: "subtree", root: snapshotSubtree(value.root as MapNode) };
  } catch {
    return {
      kind: "invalid",
      message: "The Maplora subtree contains invalid nodes or duplicate IDs.",
    };
  }
}

// Materialize once, before queuing: retries and redo retain these same IDs.
export function remapSubtree(
  root: MapNode,
  destination: MapNode,
  allocate: () => string = newNodeId,
): MapNode {
  const copy = snapshotSubtree(root);
  const reserved = new Set(
    [...allNodes(root), ...allNodes(destination)].map((node) =>
      node.id.toLowerCase(),
    ),
  );
  for (const node of allNodes(copy)) {
    let id: string | undefined;
    for (let attempts = 0; attempts < 100; attempts++) {
      const candidate = UUIDSchema.parse(allocate());
      if (!reserved.has(candidate.toLowerCase())) {
        id = candidate;
        break;
      }
    }
    if (!id)
      throw new Error(
        "Could not allocate a unique node ID. Try pasting again.",
      );
    node.id = id;
    reserved.add(id.toLowerCase());
  }
  return copy;
}

export function sameSubtree(a: MapNode, b: MapNode): boolean {
  const canonical = (node: MapNode): unknown => ({
    id: node.id,
    text: node.text,
    collapsed: node.collapsed,
    ...(node.style
      ? { style: Object.fromEntries(Object.entries(node.style).sort()) }
      : {}),
    children: node.children.map(canonical),
  });
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
