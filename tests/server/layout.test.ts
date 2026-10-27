import { expect, it } from "vitest";
import fc from "fast-check";
import {
  computeLayout,
  DEFAULT_SIZE,
  clampZoom,
} from "../../src/client/layout.js";
import { allNodes } from "../../src/shared/tree.js";
import { fixture, mapArb } from "../fixtures.js";
import type { MapNode } from "../../src/shared/schema.js";
// Feature: maplora, Properties 15 and 16: bilateral balance and non-overlap
it("balances root branches and separates all measured bounding boxes by at least 8px", () => {
  fc.assert(
    fc.property(
      mapArb,
      fc.array(
        fc.record({
          width: fc.integer({ min: 60, max: 400 }),
          height: fc.integer({ min: 20, max: 240 }),
        }),
        { minLength: 1, maxLength: 80 },
      ),
      (map, dimensions) => {
        const sizes = new Map(
          allNodes(map.root).map((n, i) => [
            n.id,
            dimensions[i % dimensions.length],
          ]),
        );
        const positions = computeLayout(map, sizes),
          visible = allNodes(map.root, true);
        const left = map.root.children.filter(
          (n) => positions.get(n.id)!.x < 0,
        ).length;
        expect(
          Math.abs(left - (map.root.children.length - left)),
        ).toBeLessThanOrEqual(1);
        expect(positions.size).toBe(visible.length);
        for (let i = 0; i < visible.length; i++)
          for (let j = i + 1; j < visible.length; j++) {
            const a = positions.get(visible[i].id)!,
              b = positions.get(visible[j].id)!,
              sa = sizes.get(visible[i].id)!,
              sb = sizes.get(visible[j].id)!;
            expect(
              a.x + sa.width + 7.99 <= b.x ||
                b.x + sb.width + 7.99 <= a.x ||
                a.y + sa.height + 7.99 <= b.y ||
                b.y + sb.height + 7.99 <= a.y,
            ).toBe(true);
          }
      },
    ),
    { numRuns: 100 },
  );
});
it.each([0, 1, 2, 3, 4, 5])("lays out %i top-level children", (count) => {
  const map = fixture();
  map.root.children = Array.from({ length: count }, (_, i) => ({
    ...map.root,
    id: `child-${i}`,
    children: [],
  }));
  expect(computeLayout(map, new Map()).size).toBe(count + 1);
});
it("handles collapsed branches and a deep unbalanced tree", () => {
  const map = fixture();
  let node: MapNode = map.root;
  for (let i = 0; i < 120; i++) {
    const child = {
      id: `deep-${i}`,
      text: "Long branch",
      collapsed: false,
      children: [],
    };
    node.children.push(child);
    node = child;
  }
  expect(computeLayout(map, new Map()).size).toBe(121);
  map.root.children[0].collapsed = true;
  expect(computeLayout(map, new Map()).size).toBe(2);
});
it("computes 500-node layout within the 100ms update budget", () => {
  const map = fixture();
  for (let i = 0; i < 499; i++)
    map.root.children.push({ ...map.root, id: `perf-${i}`, children: [] });
  const start = performance.now();
  expect(computeLayout(map, new Map()).size).toBe(500);
  expect(performance.now() - start).toBeLessThan(100);
});
it("clamps all zoom adjustments to supported bounds", () => {
  fc.assert(
    fc.property(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      (value) => {
        expect(clampZoom(value)).toBeGreaterThanOrEqual(0.1);
        expect(clampZoom(value)).toBeLessThanOrEqual(2);
      },
    ),
    { numRuns: 100 },
  );
});
