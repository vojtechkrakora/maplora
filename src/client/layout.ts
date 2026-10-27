import { flextree } from "d3-flextree";
import type { MapFile, MapNode } from "../shared/schema.js";
export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export const DEFAULT_SIZE: Size = { width: 160, height: 54 };
export function computeLayout(
  map: MapFile,
  sizes: Map<string, Size>,
): Map<string, Point> {
  const positions = new Map<string, Point>([[map.root.id, { x: 0, y: 0 }]]);
  const size = (node: MapNode) => sizes.get(node.id) ?? DEFAULT_SIZE;
  const rootSize = size(map.root);
  for (const side of [1, -1]) {
    const children = map.root.children.filter(
      (_, i) => (i % 2 === 0 ? 1 : -1) === side,
    );
    if (!children.length) continue;
    const layout = flextree<MapNode>({
      children: (n) => (n === virtualRoot || !n.collapsed ? n.children : []),
      // Rotate the layout: d3's x is our vertical axis; y is the horizontal axis.
      // Collapsed labels keep their measured box; only descendants are excluded.
      nodeSize: (n) => [size(n.data).height + 16, size(n.data).width + 64],
      spacing: 16,
    });
    const virtualRoot: MapNode = { ...map.root, children };
    const tree = layout(layout.hierarchy(virtualRoot));
    for (const node of tree.descendants()) {
      if (node.depth === 0) continue;
      const s = size(node.data);
      positions.set(node.data.id, {
        x: side === 1 ? node.y : rootSize.width - node.y - s.width,
        y: node.x - tree.x + (rootSize.height - s.height) / 2,
      });
    }
  }
  return positions;
}
export const clampZoom = (zoom: number) => Math.max(0.1, Math.min(2, zoom));
