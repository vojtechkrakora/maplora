import { afterAll, beforeAll, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import fc from "fast-check";
import { randomUUID } from "node:crypto";
import type { MapFile, MapNode } from "../../src/shared/schema.js";
import { MapFileSchema } from "../../src/shared/schema.js";
import { createApp } from "../../src/server/app.js";
import { assertDataDir, MapFileStore } from "../../src/server/MapFileStore.js";
import { textArb } from "../fixtures.js";
let dir: string, base: string, server: Server;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "maplora-api-"));
  await assertDataDir(dir);
  await new Promise<void>((resolve) => {
    server = serve(
      {
        fetch: createApp(new MapFileStore(dir)).fetch,
        port: 0,
        hostname: "127.0.0.1",
      },
      (info) => {
        base = `http://127.0.0.1:${info.port}`;
        resolve();
      },
    ) as Server;
  });
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await fs.rm(dir, { recursive: true, force: true });
});
const request = (url: string, method = "GET", body?: unknown) =>
  fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
it("supports the complete CRUD, stale conflict and trash lifecycle over live HTTP", async () => {
  expect(await (await request("/api/maps")).json()).toEqual([]);
  const created = await request("/api/maps", "POST", { title: "My map" });
  expect(created.status).toBe(201);
  const { id } = await created.json();
  const url = `/api/maps/${id}`;
  const map = await (await request(url)).json();
  expect(map).toMatchObject({ revision: 1, title: "My map" });
  expect(
    (
      await request(url, "PUT", {
        ...map,
        root: { ...map.root, text: "Edited" },
      })
    ).status,
  ).toBe(200);
  expect((await request(url, "PUT", map)).status).toBe(409);
  expect(
    await (
      await request(`${url}/title`, "PATCH", { title: "New title" })
    ).json(),
  ).toMatchObject({ id, title: "New title" });
  const beforeTrash = await (await request(url)).json();
  expect(beforeTrash.revision).toBe(3);
  expect((await request(url, "DELETE")).status).toBe(204);
  expect((await request(url)).status).toBe(410);
  expect(await (await request("/api/maps")).json()).toEqual([]);
  expect(await (await request("/api/trash")).json()).toHaveLength(1);
  expect((await request(`/api/trash/${id}/restore`, "POST")).status).toBe(200);
  expect(await (await request(url)).json()).toEqual(beforeTrash);
  await request(url, "DELETE");
  expect((await request("/api/trash", "DELETE")).status).toBe(204);
  expect(await (await request("/api/trash")).json()).toEqual([]);
  expect((await request(url)).status).toBe(404);
});
// Feature: maplora, Properties 1–8: metadata, ordering, creation, IDs, validation, rename, trash
it("creates unique maps with correct metadata for generated titles and preserves identity across rename/trash", async () => {
  const ids = new Set<string>();
  await fc.assert(
    fc.asyncProperty(textArb, async (title) => {
      const summary = await (
        await request("/api/maps", "POST", { title })
      ).json();
      expect(ids.has(summary.id)).toBe(false);
      ids.add(summary.id);
      const url = `/api/maps/${summary.id}`,
        original = await (await request(url)).json();
      expect(original.root.text).toBe(title);
      expect(original.revision).toBe(1);
      expect(original.root.id).not.toBe(original.id);
      expect(
        await (
          await request(`${url}/title`, "PATCH", { title: "Renamed" })
        ).json(),
      ).toMatchObject({ id: summary.id, title: "Renamed" });
      const renamed = await (await request(url)).json();
      expect(renamed.createdAt).toBe(original.createdAt);
      await request(url, "DELETE");
      await request(`/api/trash/${summary.id}/restore`, "POST");
      expect(await (await request(url)).json()).toEqual(renamed);
      const list = await (await request("/api/maps")).json();
      expect(
        list.every(
          (m: { title: string; updatedAt: string }) =>
            m.title && !isNaN(Date.parse(m.updatedAt)),
        ),
      ).toBe(true);
      expect(list.map((m: { updatedAt: string }) => m.updatedAt)).toEqual(
        list
          .map((m: { updatedAt: string }) => m.updatedAt)
          .sort()
          .reverse(),
      );
    }),
    { numRuns: 100 },
  );
});
it("rejects invalid titles, mismatched IDs, invalid JSON and unknown API routes", async () => {
  for (const title of ["", "  \t", "x".repeat(101)])
    expect((await request("/api/maps", "POST", { title })).status).toBe(400);
  expect((await request("/api/maps/not-a-uuid")).status).toBe(400);
  expect((await request("/api/unknown")).status).toBe(404);
  expect(
    (
      await fetch(base + "/api/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
    ).status,
  ).toBe(400);
  const summary = await (
    await request("/api/maps", "POST", { title: "Valid" })
  ).json();
  for (const title of ["", " ".repeat(4), "x".repeat(101)])
    expect(
      (await request(`/api/maps/${summary.id}/title`, "PATCH", { title }))
        .status,
    ).toBe(400);
});
it("duplicates a complete tree with fresh IDs and metadata without changing the source", async () => {
  const { id } = await (await request("/api/maps", "POST", { title: "Original" })).json();
  let source: MapFile = await (await request(`/api/maps/${id}`)).json();
  source.root.children = [{
    id: randomUUID(), text: "Branch", collapsed: true,
    style: { backgroundColor: "#abcdef", connectorStyle: "dashed" },
    children: [{ id: randomUUID(), text: "Hidden leaf", collapsed: false, children: [] }],
  }];
  source = await (await request(`/api/maps/${id}`, "PUT", source)).json();
  const bytes = await fs.readFile(path.join(dir, `${id}.json`), "utf8");
  const started = Date.now();
  const result = await request(`/api/maps/${id}/duplicate`, "POST");
  expect(result.status).toBe(201);
  const summary = await result.json();
  const copy: MapFile = await (await request(`/api/maps/${summary.id}`)).json();
  expect(MapFileSchema.parse(copy)).toEqual(copy);
  expect(copy).toMatchObject({ title: "Original (Copy)", revision: 1, schemaVersion: 1 });
  expect(copy.id).not.toBe(id);
  expect(summary).toEqual({ id: copy.id, title: copy.title, updatedAt: copy.updatedAt });
  expect(Date.parse(copy.createdAt)).toBeGreaterThanOrEqual(started);
  expect(copy.updatedAt).toBe(copy.createdAt);
  const ids = new Set<string>();
  function compare(a: MapNode, b: MapNode) {
    ids.add(b.id);
    expect(b.id).not.toBe(a.id);
    expect({ ...b, id: a.id, children: a.children }).toEqual(a);
    expect(b.children).toHaveLength(a.children.length);
    a.children.forEach((child, index) => compare(child, b.children[index]));
  }
  compare(source.root, copy.root);
  expect(ids.size).toBe(3);
  expect(await fs.readFile(path.join(dir, `${copy.id}.json`), "utf8")).toBe(JSON.stringify(copy, null, 2));
  copy.root.children[0].text = "Only the copy changes";
  expect((await request(`/api/maps/${copy.id}`, "PUT", copy)).status).toBe(200);
  expect(await fs.readFile(path.join(dir, `${id}.json`), "utf8")).toBe(bytes);
});
it("duplicates maximum-length titles within the schema limit and preserves the copy suffix", async () => {
  for (const title of ["x".repeat(100), "x".repeat(92) + "🌿" + "x".repeat(6)]) {
    const { id } = await (await request("/api/maps", "POST", { title })).json();
    const result = await request(`/api/maps/${id}/duplicate`, "POST");
    expect(result.status).toBe(201);
    const copy = await result.json();
    expect(copy.title.length).toBeLessThanOrEqual(100);
    expect(copy.title.endsWith(" (Copy)")).toBe(true);
    expect(copy.title).not.toMatch(/[\uD800-\uDBFF] \(Copy\)$/);
  }
});
it("rejects duplication of invalid, missing, trashed and corrupt source maps", async () => {
  expect((await request("/api/maps/invalid/duplicate", "POST")).status).toBe(400);
  expect((await request(`/api/maps/${randomUUID()}/duplicate`, "POST")).status).toBe(404);
  const { id } = await (await request("/api/maps", "POST", { title: "Trashed" })).json();
  await request(`/api/maps/${id}`, "DELETE");
  expect((await request(`/api/maps/${id}/duplicate`, "POST")).status).toBe(410);
  const corruptId = randomUUID();
  await fs.writeFile(path.join(dir, `${corruptId}.json`), "{");
  const before = (await fs.readdir(dir)).sort();
  expect((await request(`/api/maps/${corruptId}/duplicate`, "POST")).status).toBe(400);
  expect((await fs.readdir(dir)).sort()).toEqual(before);
});
