import { beforeEach, expect, it, vi } from "vitest";
import {
  addRecentMap,
  getRecentMaps,
  useRecentMapsStore,
} from "../../src/client/recentMapsStore";
import type { MapSummary } from "../../src/shared/schema";

const summary = (index: number): MapSummary => ({
  id: String(index),
  title: `Map ${index}`,
  tags: ["work"],
  updatedAt: "2026-10-29T00:00:00Z",
});
beforeEach(() => useRecentMapsStore.setState({ maps: [] }));

it("keeps the five most recently opened maps in reverse chronological order", () => {
  for (let index = 0; index < 6; index++) addRecentMap(summary(index));
  expect(getRecentMaps("other").map((map) => map.id)).toEqual([
    "5",
    "4",
    "3",
    "2",
    "1",
  ]);
  expect(getRecentMaps("5").map((map) => map.id)).toEqual(["4", "3", "2", "1"]);
  expect(useRecentMapsStore.getState().maps).toHaveLength(5);
});

it("moves a reopened map to the front, updates its title and never duplicates it", () => {
  [1, 2, 3].forEach((index) => addRecentMap(summary(index)));
  addRecentMap({ ...summary(1), title: "Renamed map" });
  expect(getRecentMaps("other").map((map) => map.id)).toEqual(["1", "3", "2"]);
  expect(getRecentMaps("other")[0].title).toBe("Renamed map");
});

it("copies summaries without mutating caller data or the stored ordering when filtering", () => {
  const original = summary(1);
  addRecentMap(original);
  original.title = "Changed outside the store";
  original.tags.push("new");
  const recent = getRecentMaps("other");
  expect(recent[0]).toEqual(summary(1));
  recent.reverse().pop();
  expect(getRecentMaps("other")).toHaveLength(1);
  expect(getRecentMaps("1")).toEqual([]);
});

it("removes deleted maps and refreshes metadata without changing opening order", () => {
  [1, 2, 3].forEach((index) => addRecentMap(summary(index)));
  useRecentMapsStore
    .getState()
    .reconcileMaps([
      { ...summary(1), title: "Updated title" },
      summary(3),
      { ...summary(2), error: true },
    ]);
  expect(getRecentMaps("other").map((map) => map.id)).toEqual(["3", "1"]);
  expect(getRecentMaps("3")[0].title).toBe("Updated title");
  useRecentMapsStore.getState().removeRecentMap("3");
  expect(getRecentMaps("other").map((map) => map.id)).toEqual(["1"]);
});

it("starts empty on module re-import and never reads or writes browser storage", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem");
  const write = vi.spyOn(Storage.prototype, "setItem");
  try {
    addRecentMap(summary(1));
    vi.resetModules();
    const fresh = await import("../../src/client/recentMapsStore");
    expect(fresh.getRecentMaps("other")).toEqual([]);
    fresh.addRecentMap(summary(2));
    expect(fresh.getRecentMaps("other")).toEqual([summary(2)]);
    expect(getRecentMaps("other")).toEqual([summary(1)]);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});
