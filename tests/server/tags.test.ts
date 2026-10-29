import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  MapFileSchema,
  TagSchema,
  TagsSchema,
  type MapFile,
} from "../../src/shared/schema.js";
import { MapFileStore, assertDataDir } from "../../src/server/MapFileStore.js";
import { createApp } from "../../src/server/app.js";
import { createEditorStore } from "../../src/client/stores/editorStore.js";
import { ApiError } from "../../src/client/api.js";
import { fixture } from "../fixtures.js";
let dir: string, store: MapFileStore, server: Server, base: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "maplora-tags-"));
  await assertDataDir(dir);
  store = new MapFileStore(dir);
  await new Promise<void>((resolve) => {
    server = serve(
      { fetch: createApp(store).fetch, port: 0, hostname: "127.0.0.1" },
      (info) => {
        base = `http://127.0.0.1:${info.port}`;
        resolve();
      },
    ) as Server;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await fs.rm(dir, { recursive: true, force: true });
});
const request = (route: string, method = "GET", body?: unknown) =>
  fetch(base + "/api" + route, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const bytes = (id: string) => fs.readFile(path.join(dir, `${id}.json`), "utf8");
it.each(["", "   ", "\t\n", "two,tags", "x".repeat(33), null, 1])(
  "rejects invalid tag %j in files and the shared schema",
  (tag) => {
    expect(TagSchema.safeParse(tag).success).toBe(false);
    expect(MapFileSchema.safeParse({ ...fixture(), tags: [tag] }).success).toBe(
      false,
    );
  },
);
it("accepts ordered tags, whitespace within a tag, Unicode and exact length/count limits", () => {
  const tags = [
    "Plan",
    "two words",
    " žluťoučký 🌿 ",
    "x".repeat(32),
    ...Array.from({ length: 16 }, (_, i) => `Tag ${i}`),
  ];
  expect(TagsSchema.parse(tags)).toEqual(tags);
  expect(MapFileSchema.parse({ ...fixture(), tags }).tags).toEqual(tags);
  expect(TagsSchema.safeParse([...tags, "Too many"]).success).toBe(false);
  expect(TagsSchema.safeParse(null).success).toBe(false);
});
it("defaults missing legacy tags without rewriting active or trashed files", async () => {
  const { tags: _tags, ...legacy } = fixture();
  const original = JSON.stringify(legacy, null, 2);
  await fs.writeFile(path.join(dir, `${legacy.id}.json`), original);
  const before = await fs.stat(path.join(dir, `${legacy.id}.json`));
  expect((await store.readMap(legacy.id)).tags).toEqual([]);
  expect(await store.listMaps()).toEqual([
    {
      id: legacy.id,
      title: legacy.title,
      tags: [],
      updatedAt: legacy.updatedAt,
    },
  ]);
  expect(await bytes(legacy.id)).toBe(original);
  expect((await fs.stat(path.join(dir, `${legacy.id}.json`))).mtimeMs).toBe(
    before.mtimeMs,
  );
  await store.trashMap(legacy.id);
  expect((await store.listTrash())[0].tags).toEqual([]);
  expect(
    await fs.readFile(path.join(dir, "_trash", `${legacy.id}.json`), "utf8"),
  ).toBe(original);
});
it("creates empty tags and atomically adds, removes and clears them through live HTTP", async () => {
  const response = await request("/maps", "POST", { title: "Tagged map" });
  const summary = await response.json();
  expect(summary.tags).toEqual([]);
  let map = await store.readMap(summary.id);
  const initial = structuredClone(map);
  for (const tags of [
    ["work", "Research", "two words"],
    ["Research", "two words"],
    [],
  ]) {
    const saved = await request(`/maps/${map.id}/tags`, "PATCH", { tags });
    expect(saved.status).toBe(200);
    const result = await saved.json();
    expect(result).toMatchObject({ id: map.id, title: map.title, tags });
    const disk = JSON.parse(await bytes(map.id));
    expect(disk).toEqual({
      ...initial,
      tags,
      revision: map.revision + 1,
      updatedAt: result.updatedAt,
    });
    expect((await (await request("/maps")).json())[0]).toEqual(result);
    map = disk;
  }
  expect((await fs.readdir(dir)).some((name) => name.includes(".tmp."))).toBe(
    false,
  );
});
it("rejects missing/invalid payloads and routes without touching the saved file", async () => {
  const map = await store.createMap("Safe");
  const before = await bytes(map.id);
  for (const body of [
    {},
    { tags: null },
    { tags: "tag" },
    { tags: ["bad,tag"] },
    { tags: [" "] },
    { tags: ["x".repeat(33)] },
    { tags: Array(21).fill("tag") },
    { tags: [], title: "extra" },
  ]) {
    expect((await request(`/maps/${map.id}/tags`, "PATCH", body)).status).toBe(
      400,
    );
    expect(await bytes(map.id)).toBe(before);
  }
  expect(
    (await request("/maps/../../escape/tags", "PATCH", { tags: [] })).status,
  ).toBe(404);
  expect(
    (await request(`/maps/${randomUUID()}/tags`, "PATCH", { tags: [] })).status,
  ).toBe(404);
  expect(
    (await request("/maps/invalid/tags", "PATCH", { tags: [] })).status,
  ).toBe(400);
  await store.trashMap(map.id);
  expect(
    (await request(`/maps/${map.id}/tags`, "PATCH", { tags: [] })).status,
  ).toBe(410);
});
it("keeps tags and title during concurrent metadata changes and rejects stale full-map saves", async () => {
  const map = await store.createMap("Before");
  const responses = await Promise.all([
    request(`/maps/${map.id}/tags`, "PATCH", { tags: ["work"] }),
    request(`/maps/${map.id}/title`, "PATCH", { title: "After" }),
  ]);
  expect(responses.every((r) => r.ok)).toBe(true);
  expect(await store.readMap(map.id)).toMatchObject({
    title: "After",
    tags: ["work"],
    revision: 3,
    root: map.root,
  });
  const before = await bytes(map.id);
  expect((await request(`/maps/${map.id}`, "PUT", map)).status).toBe(409);
  expect(await bytes(map.id)).toBe(before);
});
it("leaves bytes and revision intact on failed writes and supports retry", async () => {
  const map = await store.createMap("Failure");
  const before = await bytes(map.id);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("Disk full"));
  expect(
    (await request(`/maps/${map.id}/tags`, "PATCH", { tags: ["retry"] }))
      .status,
  ).toBe(500);
  expect(await bytes(map.id)).toBe(before);
  expect((await fs.readdir(dir)).some((name) => name.includes(".tmp."))).toBe(
    false,
  );
  expect(
    (await request(`/maps/${map.id}/tags`, "PATCH", { tags: ["retry"] }))
      .status,
  ).toBe(200);
  expect(await store.readMap(map.id)).toMatchObject({
    tags: ["retry"],
    revision: 2,
  });
  log.mockRestore();
});
it("preserves tag order through duplication, import, trash and restoration", async () => {
  let map = await store.createMap("Portable");
  map = await store.updateTags(map.id, ["z", "A", "two words"]);
  const duplicate = await store.duplicateMap(map.id);
  expect(duplicate.tags).toEqual(map.tags);
  const imported = await store.importMap(map);
  expect(imported.tags).toEqual(map.tags);
  await store.trashMap(map.id);
  expect((await store.listTrash())[0].tags).toEqual(map.tags);
  await store.restoreMap(map.id);
  expect(await store.readMap(map.id)).toEqual(map);
});
it("retains externally updated tags through node saves, conflict recovery and undo/redo", async () => {
  const map = await store.createMap("Editor");
  async function result(response: Response): Promise<MapFile> {
    const body = await response.json();
    if (!response.ok)
      throw new ApiError(response.status, body.code, body.error);
    return body;
  }
  const editor = createEditorStore({
    fetchMap: async (id) => result(await request(`/maps/${id}`)),
    saveMap: async (input) =>
      result(await request(`/maps/${input.id}`, "PUT", input)),
  });
  await editor.getState().loadMap(map.id);
  await store.updateTags(map.id, ["keep"]);
  expect(await editor.getState().editNodeText(map.root.id, "Edited")).toBe(
    true,
  );
  expect((await store.readMap(map.id)).tags).toEqual(["keep"]);
  await store.updateTags(map.id, ["keep", "new"]);
  expect(await editor.getState().undo()).toBe(true);
  expect(await store.readMap(map.id)).toMatchObject({
    tags: ["keep", "new"],
    root: map.root,
  });
  expect(await editor.getState().redo()).toBe(true);
  expect(await store.readMap(map.id)).toMatchObject({
    tags: ["keep", "new"],
    root: { text: "Edited" },
  });
});
