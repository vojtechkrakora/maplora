import type { MapFile, MapNode } from "../shared/schema.js";

export function mapToMarkdown(map: MapFile): string {
  const lines = [`# ${map.root.text}`];
  const stack: { node: MapNode; depth: number }[] = [];
  for (let i = map.root.children.length - 1; i >= 0; i--)
    stack.push({ node: map.root.children[i], depth: 1 });
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    lines.push(`${"  ".repeat(depth - 1)}- ${node.text}`);
    for (let i = node.children.length - 1; i >= 0; i--)
      stack.push({ node: node.children[i], depth: depth + 1 });
  }
  return lines.join("\n");
}
