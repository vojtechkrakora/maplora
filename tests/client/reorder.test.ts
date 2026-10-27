import { expect, it } from "vitest";
import { siblingDropTarget } from "../../src/client/reorder";
import { fixture } from "../fixtures";

function setup() {
  const map = fixture();
  map.root.children = ["a", "b", "c", "d"].map((id) => ({
    id,
    text: id,
    children: [],
    collapsed: false,
  }));
  map.root.children[0].children = [
    { id: "descendant", text: "Nested", children: [], collapsed: false },
  ];
  const positions = new Map([
    [map.root.id, { x: 0, y: 0 }],
    ["a", { x: 220, y: 0 }],
    ["b", { x: -220, y: 0 }],
    ["c", { x: 220, y: 110 }],
    ["d", { x: -220, y: 110 }],
    ["descendant", { x: 440, y: 0 }],
  ]);
  const target = (x: number, y: number, id = "a") =>
    siblingDropTarget(map, id, { x, y }, positions, new Map());
  return { map, positions, target };
}
it("finds insertion slots on both sides of a bilateral root", () => {
  const { target } = setup();
  expect(target(230, 112)).toEqual({
    siblingId: "c",
    placement: "before",
    index: 1,
  });
  expect(target(230, 160)).toEqual({
    siblingId: "c",
    placement: "after",
    index: 2,
  });
  expect(target(-200, 160)).toEqual({
    siblingId: "d",
    placement: "after",
    index: 3,
  });
  expect(target(-200, 10, "d")).toEqual({
    siblingId: "b",
    placement: "before",
    index: 1,
  });
});
it("rejects empty canvas, parent, descendants, root dragging, and unchanged order", () => {
  const { map, target } = setup();
  expect(target(1000, 1000)).toBeNull();
  expect(target(20, 20)).toBeNull();
  expect(target(450, 20)).toBeNull();
  expect(target(-200, 10)).toBeNull();
  expect(target(230, 112, map.root.id)).toBeNull();
});
it("uses measured boxes and excludes hidden siblings", () => {
  const { map, positions } = setup();
  const sizes = new Map([["c", { width: 300, height: 100 }]]);
  expect(
    siblingDropTarget(map, "a", { x: 510, y: 195 }, positions, sizes),
  ).toEqual({ siblingId: "c", placement: "after", index: 2 });
  positions.delete("c");
  expect(
    siblingDropTarget(map, "a", { x: 230, y: 140 }, positions, sizes),
  ).toBeNull();
});
