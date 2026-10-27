import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useMapListStore,
  type SortOrder,
} from "../../src/client/stores/mapListStore";
import type { MapSummary } from "../../src/shared/schema.js";

const maps: MapSummary[] = [
  { id: "c", title: "zebra plan", updatedAt: "2026-01-02T00:00:00Z" },
  { id: "b", title: "Beta", updatedAt: "2026-01-03T00:00:00Z" },
  { id: "a", title: "Alpha plan", updatedAt: "2026-01-01T00:00:00Z" },
  { id: "bad", title: "broken.json", error: true },
];
beforeEach(() => {
  localStorage.clear();
  useMapListStore.setState({
    maps: structuredClone(maps),
    searchQuery: "",
    sortOrder: "updatedAt_desc",
  });
});
afterEach(() => vi.restoreAllMocks());
const results = () => useMapListStore.getState().filteredAndSortedMaps();
it("returns every map for an empty query without mutating the source array", () => {
  const source = useMapListStore.getState().maps;
  expect(results()).toHaveLength(maps.length);
  expect(results()).not.toBe(source);
  expect(source).toEqual(maps);
});
it("matches case-insensitive substrings including corrupt filename fallbacks", () => {
  const { setSearchQuery } = useMapListStore.getState();
  setSearchQuery("PLAN");
  expect(results().map((m) => m.id)).toEqual(["c", "a"]);
  setSearchQuery("ROKEN.J");
  expect(results()).toEqual([maps[3]]);
  setSearchQuery("missing");
  expect(results()).toEqual([]);
  setSearchQuery("");
  expect(results()).toHaveLength(4);
});
it.each<[SortOrder, string[]]>([
  ["updatedAt_desc", ["b", "c", "a", "bad"]],
  ["updatedAt_asc", ["a", "c", "b", "bad"]],
  ["title_asc", ["a", "b", "bad", "c"]],
  ["title_desc", ["c", "bad", "b", "a"]],
])("applies %s and persists the choice", (order, ids) => {
  useMapListStore.getState().setSortOrder(order);
  expect(results().map((m) => m.id)).toEqual(ids);
  expect(localStorage.getItem("maplora:sortOrder")).toBe(order);
});
it("filters before sorting and responds to in-memory list changes", () => {
  const { setSearchQuery, setSortOrder } = useMapListStore.getState();
  setSearchQuery("plan");
  setSortOrder("title_asc");
  expect(results().map((m) => m.id)).toEqual(["a", "c"]);
  useMapListStore.setState({
    maps: [...maps, { id: "new", title: "Middle PLAN" }],
  });
  expect(results().map((m) => m.id)).toEqual(["a", "new", "c"]);
});
it("orders equivalent timestamp instants together, leaves missing dates last and keeps ties stable", () => {
  useMapListStore.setState({
    maps: [
      { id: "invalid", title: "Invalid", updatedAt: "invalid" },
      { id: "first", title: "Same", updatedAt: "2026-01-01T01:00:00+01:00" },
      { id: "second", title: "same", updatedAt: "2026-01-01T00:00:00Z" },
      maps[3],
    ],
  });
  expect(results().map((m) => m.id)).toEqual([
    "first",
    "second",
    "invalid",
    "bad",
  ]);
  useMapListStore.getState().setSortOrder("updatedAt_asc");
  expect(results().map((m) => m.id)).toEqual([
    "first",
    "second",
    "invalid",
    "bad",
  ]);
});
it.each([
  "updatedAt_desc",
  "updatedAt_asc",
  "title_asc",
  "title_desc",
  null,
  "invalid",
  "TITLE_ASC",
  "",
])(
  "initializes from stored %s with default fallback for invalid values",
  async (saved) => {
    if (saved !== null) localStorage.setItem("maplora:sortOrder", saved);
    vi.resetModules();
    const { useMapListStore: fresh } =
      await import("../../src/client/stores/mapListStore");
    expect(fresh.getState().sortOrder).toBe(
      saved &&
        ["updatedAt_desc", "updatedAt_asc", "title_asc", "title_desc"].includes(
          saved,
        )
        ? saved
        : "updatedAt_desc",
    );
    expect(fresh.getState().searchQuery).toBe("");
  },
);
it("defaults safely when accessing localStorage throws", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  vi.resetModules();
  const { useMapListStore: fresh } =
    await import("../../src/client/stores/mapListStore");
  expect(fresh.getState().sortOrder).toBe("updatedAt_desc");
  expect(() => fresh.getState().setSortOrder("title_asc")).not.toThrow();
});
it("keeps sorting usable when a preference cannot be written", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  useMapListStore.getState().setSortOrder("title_desc");
  expect(results().map((m) => m.id)).toEqual(["c", "bad", "b", "a"]);
  expect(localStorage.getItem("maplora:sortOrder")).toBeNull();
});
