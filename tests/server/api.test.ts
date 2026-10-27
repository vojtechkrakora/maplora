import { afterAll, beforeAll, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import fc from "fast-check";
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
