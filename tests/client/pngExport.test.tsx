import { expect, it } from "vitest";
import {
  expandedPngMap,
  pngGraph,
  includeInPng,
  downloadMapPng,
} from "../../src/client/pngExport";
import { allNodes } from "../../src/shared/tree";
import { fixture } from "../fixtures";
import { exportFilename } from "../../src/client/download";
import type { MapFile } from "../../src/shared/schema";

function nested(): MapFile {
  const map = fixture();
  map.root.style = {
    connectorColor: "#cc2277",
    connectorStyle: "dotted",
    connectorWidth: 8,
  };
  map.root.children = [
    {
      id: "12345678-1234-4234-8234-123456789014",
      text: "Right",
      collapsed: true,
      style: {
        backgroundColor: "#663399",
        textColor: "#ffffff",
        borderColor: "#113355",
        connectorStyle: "dashed",
      },
      children: [
        {
          id: "12345678-1234-4234-8234-123456789015",
          text: "Hidden 🌿",
          collapsed: true,
          children: [],
        },
      ],
    },
    {
      id: "12345678-1234-4234-8234-123456789016",
      text: "Left",
      collapsed: true,
      children: [],
    },
  ];
  return map;
}
const sizesFor = (map: MapFile) =>
  new Map(
    allNodes(map.root).map((node) => [
      node.id,
      {
        width: node === map.root ? 220 : 160,
        height: node === map.root ? 80 : 54,
      },
    ]),
  );
it("expands a validated independent copy, retaining all labels, styles, IDs and metadata", () => {
  const map = nested(),
    before = structuredClone(map),
    copy = expandedPngMap(map);
  expect(copy).not.toBe(map);
  expect(allNodes(copy.root).every((node) => !node.collapsed)).toBe(true);
  expect(copy.root.children[0].style).toEqual(map.root.children[0].style);
  expect(allNodes(copy.root).map((node) => [node.id, node.text])).toEqual(
    allNodes(map.root).map((node) => [node.id, node.text]),
  );
  copy.root.children[0].text = "Only the export copy changes";
  expect(map).toEqual(before);
});
it("lays out the full bilateral tree with source-node connector styles and logical depths", () => {
  const map = expandedPngMap(nested()),
    graph = pngGraph(map, sizesFor(map));
  expect(graph.nodes).toHaveLength(4);
  expect(graph.edges).toHaveLength(3);
  const right = graph.nodes.find((node) => node.data.node.text === "Right")!,
    left = graph.nodes.find((node) => node.data.node.text === "Left")!,
    leaf = graph.nodes.find((node) => node.data.node.text === "Hidden 🌿")!;
  expect(right.position.x).toBeGreaterThan(0);
  expect(left.position.x).toBeLessThan(0);
  expect(right.data).toMatchObject({ left: false, depth: 1 });
  expect(left.data).toMatchObject({ left: true, depth: 1 });
  expect(leaf.data.depth).toBe(2);
  expect(
    graph.edges
      .filter((edge) => edge.source === map.root.id)
      .map((edge) => edge.sourceHandle),
  ).toEqual(["right", "left"]);
  expect(graph.edges[0].data?.style).toEqual(map.root.style);
  expect(graph.edges.find((edge) => edge.target === leaf.id)).toMatchObject({
    sourceHandle: "out",
    targetHandle: "in",
    data: { style: map.root.children[0].style },
  });
  expect(
    graph.nodes.every(
      (node) =>
        !node.selected &&
        !node.draggable &&
        !node.selectable &&
        !node.focusable,
    ),
  ).toBe(true);
});
it("includes every measured node in bounds with 32px padding regardless of screen size or editor zoom", () => {
  const map = expandedPngMap(nested()),
    graph = pngGraph(map, sizesFor(map));
  expect(graph.viewport.zoom).toBe(1);
  for (const node of graph.nodes) {
    const x = node.position.x + graph.viewport.x,
      y = node.position.y + graph.viewport.y;
    expect(x).toBeGreaterThanOrEqual(32);
    expect(y).toBeGreaterThanOrEqual(32);
    expect(x + node.width!).toBeLessThanOrEqual(graph.width - 32);
    expect(y + node.height!).toBeLessThanOrEqual(graph.height - 32);
  }
});
it("exports a root-only map with its actual measured size", () => {
  const map = fixture(),
    graph = pngGraph(map, sizesFor(map));
  expect(graph).toMatchObject({
    width: 284,
    height: 144,
    edges: [],
    viewport: { x: 32, y: 32, zoom: 1 },
  });
});
it.each([0, -1, NaN])(
  "rejects invalid node dimensions %s instead of downloading a partial image",
  (size) => {
    const map = fixture();
    expect(() =>
      pngGraph(map, new Map([[map.root.id, { width: size, height: 54 }]])),
    ).toThrow();
  },
);
it("rejects missing measurements and maps exceeding full-resolution canvas bounds", () => {
  const map = expandedPngMap(nested());
  expect(() => pngGraph(map, new Map())).toThrow("measure");
  expect(() =>
    pngGraph(
      map,
      new Map(
        allNodes(map.root).map((node) => [
          node.id,
          { width: 20000, height: 54 },
        ]),
      ),
    ),
  ).toThrow("too large");
});
it.each([
  "react-flow__handle",
  "react-flow__panel",
  "react-flow__edge-interaction",
  "react-flow__aria-live",
])("filters %s from the captured image", (className) => {
  const element = document.createElement("div");
  element.className = className;
  expect(includeInPng(element)).toBe(false);
});
it("keeps node labels, icon text, SVG connectors and static styling", () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.classList.add("react-flow__edge-path");
  expect(includeInPng(svg as unknown as HTMLElement)).toBe(true);
  expect(
    includeInPng(document.createTextNode("🌿") as unknown as HTMLElement),
  ).toBe(true);
  expect(exportFilename("../Map / 🌿", "png")).toBe("_Map _ 🌿.png");
});
it("rejects invalid data and pre-cancelled exports before mounting or downloading anything", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    downloadMapPng(fixture(), controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    downloadMapPng({ ...fixture(), title: "" }, new AbortController().signal),
  ).rejects.toThrow();
  expect(document.querySelector(".png-export-host")).toBeNull();
});
it("cleans up measurement failures without mounting an incomplete export", async () => {
  await expect(
    downloadMapPng(fixture(), new AbortController().signal),
  ).rejects.toThrow("measure");
  expect(document.querySelector(".png-export-host")).toBeNull();
});
