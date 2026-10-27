import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import {
  assertDataDir,
  MapFileStore,
  validateAndMigrate,
} from "../../src/server/MapFileStore.js";
import { MapFileSchema } from "../../src/shared/schema.js";
import { fixture, mapArb } from "../fixtures.js";
let dir: string, store: MapFileStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "maplora-"));
  await assertDataDir(dir);
  store = new MapFileStore(dir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});
describe("schema", () => {
  // Feature: maplora, Property 17: Map File serialization round trip
  it("round trips generated trees without data loss", () =>
    fc.assert(
      fc.property(mapArb, (m) => {
        expect(MapFileSchema.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
      }),
      { numRuns: 100 },
    ));
  it("validates versions and reports invalid fields", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      validateAndMigrate({ ...fixture(), schemaVersion: 2 }),
    ).toThrow("supported maximum 1");
    expect(() =>
      validateAndMigrate({ ...fixture(), schemaVersion: 0 }),
    ).toThrow("too old");
    expect(validateAndMigrate(fixture())).toEqual(fixture());
    expect(() => validateAndMigrate({ ...fixture(), title: "" })).toThrow(
      "title",
    );
    expect(() =>
      MapFileSchema.parse({
        ...fixture(),
        root: { ...fixture().root, children: [fixture().root] },
      }),
    ).toThrow("Duplicate node");
    log.mockRestore();
  });
});
it("lists zero, one and multiple maps, sorts timestamps, and retains corrupt entries", async () => {
  expect(await store.listMaps()).toEqual([]);
  const first = await store.createMap("First");
  expect(await store.listMaps()).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await store.createMap("Second");
  await fs.writeFile(path.join(dir, "broken.json"), "{");
  const result = await store.listMaps();
  expect(result.map((m) => m.id)).toEqual([second.id, first.id, "broken"]);
  expect(result[2]).toEqual({
    id: "broken",
    title: "broken.json",
    error: true,
  });
});
// Feature: maplora, Properties 18 and 19: revision increments and stale rejection
it("increments revisions and rejects stale writes without changing bytes", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (n) => {
      let map = await store.createMap("Revision");
      const original = structuredClone(map);
      for (let i = 1; i <= n; i++)
        map = await store.writeMap({ ...map, title: `Revision ${i}` });
      expect(map.revision).toBe(n + 1);
      const file = path.join(dir, `${map.id}.json`),
        before = await fs.readFile(file, "utf8");
      await expect(store.writeMap(original)).rejects.toMatchObject({
        status: 409,
      });
      expect(await fs.readFile(file, "utf8")).toBe(before);
    }),
    { numRuns: 100 },
  );
});
it("serializes concurrent writes with their revision check and recovers after rejection", async () => {
  const map = await store.createMap("Race");
  const results = await Promise.allSettled([
    store.writeMap({ ...map, title: "A" }),
    store.writeMap({ ...map, title: "B" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await store.renameMap(map.id, "Recovered")).toMatchObject({
    revision: 3,
    title: "Recovered",
  });
});
it("cleans failed temporary writes and leaves the original intact", async () => {
  const map = await store.createMap("Safe");
  const before = await fs.readFile(path.join(dir, `${map.id}.json`), "utf8");
  vi.spyOn(fs, "rename").mockRejectedValueOnce(
    new Error("simulated disk failure"),
  );
  await expect(store.writeMap(map)).rejects.toThrow("simulated");
  expect(await fs.readdir(dir)).toEqual(
    expect.arrayContaining(["_trash", `${map.id}.json`]),
  );
  expect((await fs.readdir(dir)).some((n) => n.includes(".tmp."))).toBe(false);
  expect(await fs.readFile(path.join(dir, `${map.id}.json`), "utf8")).toBe(
    before,
  );
});
it("reports cleanup failure explicitly", async () => {
  const map = await store.createMap("Safe");
  vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("failure"));
  vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("cleanup failure"));
  await expect(store.writeMap(map)).rejects.toMatchObject({
    code: "CLEANUP_FAILED",
  });
});
it("cleans up a failed duplicate write and preserves the source", async () => {
  const source = await store.createMap("Keep original");
  const before = await fs.readFile(path.join(dir, `${source.id}.json`), "utf8");
  vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("disk full"));
  await expect(store.duplicateMap(source.id)).rejects.toThrow("disk full");
  expect((await fs.readdir(dir)).sort()).toEqual(["_trash", `${source.id}.json`].sort());
  expect(await fs.readFile(path.join(dir, `${source.id}.json`), "utf8")).toBe(before);
  expect(await store.duplicateMap(source.id)).toMatchObject({ title: "Keep original (Copy)", revision: 1 });
});
it("trashes, restores without data loss, and permanently empties only trash JSON files", async () => {
  const map = await store.createMap("Keep me");
  await store.trashMap(map.id);
  expect(await store.listMaps()).toEqual([]);
  await expect(store.readMap(map.id)).rejects.toMatchObject({ status: 410 });
  expect(await store.listTrash()).toHaveLength(1);
  await store.restoreMap(map.id);
  expect(await store.readMap(map.id)).toEqual(map);
  await store.trashMap(map.id);
  await fs.writeFile(path.join(dir, "_trash", "keep.txt"), "keep");
  await store.emptyTrash();
  expect(await store.listTrash()).toEqual([]);
  expect(await fs.readdir(path.join(dir, "_trash"))).toEqual(["keep.txt"]);
});
it("rejects traversal IDs and unavailable data directories", async () => {
  await expect(store.readMap("../../etc/passwd")).rejects.toThrow();
  await expect(assertDataDir(path.join(dir, "missing"))).rejects.toThrow(
    "unavailable",
  );
  await expect(store.readMap(fixture().id)).rejects.toMatchObject({
    status: 404,
  });
});
it("lists 500 map files within the one-second metadata budget", async () => {
  const { randomUUID } = await import("node:crypto");
  await Promise.all(
    Array.from({ length: 500 }, async (_, i) => {
      const m = { ...fixture(), id: randomUUID(), title: `Map ${i}` };
      await fs.writeFile(path.join(dir, `${m.id}.json`), JSON.stringify(m));
    }),
  );
  const start = performance.now();
  const result = await store.listMaps();
  expect(result).toHaveLength(500);
  expect(performance.now() - start).toBeLessThan(1000);
});
it("logs and rejects unsupported versions and field errors when reading a file", async () => {
  const map = fixture(),
    file = path.join(dir, `${map.id}.json`);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const version of [0, 2]) {
    await fs.writeFile(
      file,
      JSON.stringify({ ...map, schemaVersion: version }),
    );
    await expect(store.readMap(map.id)).rejects.toMatchObject({
      code: "UNSUPPORTED_VERSION",
    });
  }
  expect(log).toHaveBeenCalledWith(
    "Map validation failed:",
    expect.stringContaining("supported maximum"),
  );
  await fs.writeFile(
    file,
    JSON.stringify({ ...map, root: { ...map.root, text: "" } }),
  );
  await expect(store.readMap(map.id)).rejects.toThrow("text");
});
it("refuses server startup when DATA_DIR does not exist", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await expect(
    promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "src/server/index.ts"],
      { env: { ...process.env, DATA_DIR: path.join(dir, "missing") } },
    ),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("FATAL:"),
  });
});
