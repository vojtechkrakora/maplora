import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serve } from "@hono/node-server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../../src/server/app.js";
import { assertDataDir, MapFileStore } from "../../src/server/MapFileStore.js";
import { MapFileSchema, type MapFile } from "../../src/shared/schema.js";
import { fixture } from "../fixtures.js";

let dir: string, base: string, server: Server, store: MapFileStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "maplora-import-"));
  await assertDataDir(dir);
  store = new MapFileStore(dir);
  await new Promise<void>((resolve) => {
    server = serve(
      { fetch: createApp(store).fetch, hostname: "127.0.0.1", port: 0 },
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
const post = (body: unknown) =>
  fetch(`${base}/api/maps/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function portable(): MapFile {
  const map = fixture();
  map.revision = 9;
  map.root.style = {
    backgroundColor: "#abcdef",
    textColor: "#123456",
    connectorColor: "#cc2277",
    connectorStyle: "dotted",
    connectorWidth: 8,
  };
  map.root.children = [
    {
      id: randomUUID(),
      text: "Collapsed branch",
      collapsed: true,
      children: [
        { id: randomUUID(), text: "Hidden 🌿", collapsed: false, children: [] },
      ],
    },
  ];
  return map;
}
it("imports valid v1 JSON with a new map ID, preserving every node and portable field", async () => {
  const input = portable(),
    original = structuredClone(input);
  const response = await post(input);
  expect(response.status).toBe(201);
  const summary = await response.json();
  expect(summary).toEqual({
    id: expect.any(String),
    title: input.title,
    tags: input.tags,
    updatedAt: input.updatedAt,
  });
  expect(summary.id).not.toBe(input.id);
  const imported = await store.readMap(summary.id);
  expect(MapFileSchema.parse(imported)).toEqual(imported);
  expect(imported).toEqual({ ...input, id: summary.id, revision: 1 });
  expect(input).toEqual(original);
  expect(
    JSON.parse(await fs.readFile(path.join(dir, `${summary.id}.json`), "utf8")),
  ).toEqual(imported);
  expect(await store.listMaps()).toEqual([summary]);
  expect((await fs.readdir(dir)).sort()).toEqual(
    [`${summary.id}.json`, "_trash"].sort(),
  );
});
it("replaces only conflicting node IDs across active and trashed maps, including case variants", async () => {
  const active = await store.createMap("Existing"),
    trashed = await store.createMap("Deleted");
  await store.trashMap(trashed.id);
  const activeBytes = await fs.readFile(
    path.join(dir, `${active.id}.json`),
    "utf8",
  );
  const trashBytes = await fs.readFile(
    path.join(dir, "_trash", `${trashed.id}.json`),
    "utf8",
  );
  const input = portable();
  input.root.id = active.root.id.toUpperCase();
  input.root.children[0].id = trashed.root.id;
  const response = await post(input);
  const summary = await response.json();
  const imported = await store.readMap(summary.id);
  expect(imported.root.id.toLowerCase()).not.toBe(active.root.id);
  expect(imported.root.children[0].id).not.toBe(trashed.root.id);
  expect(imported.root.children[0].children).toEqual(
    input.root.children[0].children,
  );
  expect(imported.root.style).toEqual(input.root.style);
  expect(imported.root.children[0].collapsed).toBe(true);
  expect(
    new Set([
      imported.root.id,
      imported.root.children[0].id,
      imported.root.children[0].children[0].id,
    ]).size,
  ).toBe(3);
  expect(await fs.readFile(path.join(dir, `${active.id}.json`), "utf8")).toBe(
    activeBytes,
  );
  expect(
    await fs.readFile(path.join(dir, "_trash", `${trashed.id}.json`), "utf8"),
  ).toBe(trashBytes);
});
it("serializes concurrent imports so their node IDs never collide", async () => {
  const input = portable();
  const summaries = await Promise.all(
    Array.from({ length: 5 }, async () => {
      const response = await post(input);
      expect(response.status).toBe(201);
      return response.json();
    }),
  );
  const imported = await Promise.all(
    summaries.map((summary) => store.readMap(summary.id)),
  );
  expect(new Set(imported.map((map) => map.id)).size).toBe(5);
  const ids = imported.flatMap((map) => [
    map.root.id,
    map.root.children[0].id,
    map.root.children[0].children[0].id,
  ]);
  expect(new Set(ids).size).toBe(15);
  expect(imported.filter((map) => map.root.id === input.root.id)).toHaveLength(
    1,
  );
});
it("reserves IDs in parseable corrupt maps and ignores files with invalid JSON", async () => {
  const input = portable();
  await fs.writeFile(
    path.join(dir, `${randomUUID()}.json`),
    JSON.stringify({ schemaVersion: 99, root: { id: input.root.id } }),
  );
  await fs.writeFile(path.join(dir, `${randomUUID()}.json`), "{");
  const summary = await (await post(input)).json();
  const imported = await store.readMap(summary.id);
  expect(imported.root.id).not.toBe(input.root.id);
  expect(imported.root.children).toEqual(input.root.children);
});
it("rejects malformed JSON without creating any file", async () => {
  const response = await fetch(`${base}/api/maps/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_JSON" });
  expect(await fs.readdir(dir)).toEqual(["_trash"]);
});
it.each([0, 2, 999, "1", 1.5, undefined])(
  "rejects unsupported schema version %s and reports it without a write",
  async (version) => {
    const response = await post({ ...fixture(), schemaVersion: version });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(String(version));
    expect(await fs.readdir(dir)).toEqual(["_trash"]);
  },
);
it.each([
  "duplicate node IDs",
  "missing root",
  "unknown field",
  "empty label",
  "bad style",
  "null",
])("rejects %s before writing", async (scenario) => {
  const input: any = portable();
  if (scenario === "duplicate node IDs")
    input.root.children[0].id = input.root.id;
  if (scenario === "missing root") delete input.root;
  if (scenario === "unknown field") input.serverPath = "/private/data";
  if (scenario === "empty label") input.root.text = " ";
  if (scenario === "bad style") input.root.style.connectorWidth = 9;
  const response = await post(scenario === "null" ? null : input);
  expect(response.status).toBe(400);
  expect(await fs.readdir(dir)).toEqual(["_trash"]);
});
it("cleans up a failed atomic write and allows a successful retry without changing existing maps", async () => {
  const existing = await store.createMap("Keep me"),
    before = await fs.readFile(path.join(dir, `${existing.id}.json`), "utf8");
  const rename = vi
    .spyOn(fs, "rename")
    .mockRejectedValueOnce(new Error("Disk failure"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await post(portable())).status).toBe(500);
  expect((await fs.readdir(dir)).sort()).toEqual(
    [`${existing.id}.json`, "_trash"].sort(),
  );
  rename.mockRestore();
  expect((await post(portable())).status).toBe(201);
  expect(await fs.readFile(path.join(dir, `${existing.id}.json`), "utf8")).toBe(
    before,
  );
});
