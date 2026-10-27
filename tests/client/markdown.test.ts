import { expect, it } from "vitest";
import { mapToMarkdown } from "../../src/client/markdownExport";
import type { MapNode } from "../../src/shared/schema.js";
import { fixture } from "../fixtures";

function node(
  text: string,
  children: MapNode[] = [],
  collapsed = false,
): MapNode {
  return { id: text, text, children, collapsed };
}
it("exports only the root heading, using its label rather than the map title", () => {
  const map = fixture();
  map.title = "Different title";
  expect(mapToMarkdown(map)).toBe("# Garden of ideas");
});
it("exports one level of children in their stored sibling order", () => {
  const map = fixture();
  map.root = node("root", [node("c"), node("a"), node("b")]);
  expect(mapToMarkdown(map)).toBe("# root\n- c\n- a\n- b");
});
it("exports nested branches depth-first with two spaces per additional level", () => {
  const map = fixture();
  map.root = node("Project X", [
    node("Frontend", [node("React"), node("TypeScript")]),
    node("Backend", [node("Node.js"), node("Hono")]),
  ]);
  expect(mapToMarkdown(map)).toBe(
    "# Project X\n- Frontend\n  - React\n  - TypeScript\n- Backend\n  - Node.js\n  - Hono",
  );
});
it("indents all five descendant levels correctly", () => {
  const map = fixture();
  map.root = node("root", [
    node("1", [node("2", [node("3", [node("4", [node("5")])])])]),
  ]);
  expect(mapToMarkdown(map)).toBe(
    "# root\n- 1\n  - 2\n    - 3\n      - 4\n        - 5",
  );
});
it("includes all descendants of collapsed branches without changing map data", () => {
  const map = fixture();
  map.root = node("root", [
    node("closed", [node("nested", [node("hidden")], true)], true),
    node("last"),
  ]);
  const before = structuredClone(map);
  expect(mapToMarkdown(map)).toBe(
    "# root\n- closed\n  - nested\n    - hidden\n- last",
  );
  expect(map).toEqual(before);
});
it("preserves special characters, whitespace and Unicode verbatim without escaping", () => {
  const map = fixture();
  map.root = node("# Plan *bold*", [
    node("- list # heading"),
    node("[link](url) `code` \\"),
    node("  Příští nápad 🌱  "),
  ]);
  expect(mapToMarkdown(map)).toBe(
    "# # Plan *bold*\n- - list # heading\n- [link](url) `code` \\\n-   Příští nápad 🌱  ",
  );
});
