import { expect, it, vi } from "vitest";
import fc from "fast-check";
import { ApiError } from "../../src/client/api";
import { createEditorStore } from "../../src/client/stores/editorStore";
import {
  MapFileSchema,
  type MapFile,
  type NodeStyle,
} from "../../src/shared/schema";
import { fixture } from "../fixtures";

async function setup() {
  const original = fixture();
  original.root.children = [
    {
      ...structuredClone(original.root),
      id: "12345678-1234-4234-8234-000000000001",
      text: "Child",
    },
  ];
  original.root.style = { backgroundColor: "#abcdef", borderColor: "#222222" };
  let disk = structuredClone(original);
  const service = {
    fetchMap: vi.fn(async () => structuredClone(disk)),
    saveMap: vi.fn(async (map: MapFile) => {
      disk = structuredClone({ ...map, revision: disk.revision + 1 });
      return structuredClone(disk);
    }),
  };
  const store = createEditorStore(service);
  await store.getState().loadMap(original.id);
  return { store, service, original, disk: () => disk };
}
const color = fc
  .integer({ min: 0, max: 0xffffff })
  .map((value) => `#${value.toString(16).padStart(6, "0")}`);
it("persists generated per-node colors and line settings without changing other nodes or structure", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        backgroundColor: color,
        textColor: color,
        connectorColor: color,
        connectorStyle: fc.constantFrom(
          "solid" as const,
          "dashed" as const,
          "dotted" as const,
        ),
        connectorWidth: fc.integer({ min: 1, max: 8 }),
      }),
      async (style) => {
        const { store, disk, original } = await setup();
        const child = original.root.children[0];
        expect(await store.getState().updateNodeStyle(child.id, style)).toBe(
          true,
        );
        expect(disk().root.children[0]).toEqual({ ...child, style });
        expect(disk().root.style).toEqual(original.root.style);
        expect(MapFileSchema.parse(disk())).toEqual(disk());
        expect(store.getState().undoStack).toEqual([original]);
        await store.getState().loadMap(original.id);
        expect(store.getState().map).toEqual(disk());
      },
    ),
    { numRuns: 100 },
  );
});
it("merges partial styles, clears individual overrides and removes an empty style object", async () => {
  const { store, disk, original } = await setup();
  const id = original.root.id;
  await store
    .getState()
    .updateNodeStyle(id, { textColor: "#123456", connectorWidth: 8 });
  expect(disk().root.style).toEqual({
    ...original.root.style,
    textColor: "#123456",
    connectorWidth: 8,
  });
  await store.getState().updateNodeStyle(id, { backgroundColor: undefined });
  expect(disk().root.style).toEqual({
    borderColor: "#222222",
    textColor: "#123456",
    connectorWidth: 8,
  });
  await store
    .getState()
    .updateNodeStyle(id, {
      borderColor: undefined,
      textColor: undefined,
      connectorWidth: undefined,
    });
  expect(disk().root).not.toHaveProperty("style");
  expect(JSON.parse(JSON.stringify(disk())).root).not.toHaveProperty("style");
});
it("does not save or add history for unchanged styles, missing nodes, drafts or text editing", async () => {
  const { store, service, original } = await setup();
  const id = original.root.id;
  for (const patch of [
    {},
    { backgroundColor: "#abcdef" },
    { textColor: undefined },
  ])
    expect(await store.getState().updateNodeStyle(id, patch)).toBe(false);
  expect(
    await store.getState().updateNodeStyle("missing", { textColor: "red" }),
  ).toBe(false);
  store.getState().beginEdit(id);
  expect(await store.getState().updateNodeStyle(id, { textColor: "red" })).toBe(
    false,
  );
  store.getState().cancelEdit();
  store.getState().addNode(id);
  expect(await store.getState().updateNodeStyle(id, { textColor: "red" })).toBe(
    false,
  );
  expect(service.saveMap).not.toHaveBeenCalled();
  expect(store.getState().undoStack).toEqual([]);
});
it("rejects invalid line settings without changing state or making a request", async () => {
  const { store, service, original } = await setup();
  for (const style of [
    { connectorWidth: 0 },
    { connectorWidth: 9 },
    { connectorWidth: NaN },
    { connectorStyle: "wavy" },
    { unknown: true },
  ])
    await expect(
      store.getState().updateNodeStyle(original.root.id, style as NodeStyle),
    ).rejects.toThrow();
  expect(store.getState().map).toEqual(original);
  expect(service.saveMap).not.toHaveBeenCalled();
});
it("rolls back failed style saves and retries the exact patch", async () => {
  const { store, service, original, disk } = await setup();
  service.saveMap.mockRejectedValueOnce(new Error("Disk full"));
  expect(
    await store
      .getState()
      .updateNodeStyle(original.root.id, { backgroundColor: "#ff0000" }),
  ).toBe(false);
  expect(store.getState().map).toEqual(original);
  expect(store.getState().error).toContain("Disk full");
  expect(await store.getState().saveMap()).toBe(true);
  expect(disk().root.style).toEqual({
    ...original.root.style,
    backgroundColor: "#ff0000",
  });
});
it("rebases a style patch and reset while preserving unrelated remote styling", async () => {
  const { store, service, original, disk } = await setup();
  const latest = structuredClone(original);
  latest.root.style!.textColor = "#ff00ff";
  latest.title = "Remote title";
  latest.revision = 4;
  service.saveMap.mockRejectedValueOnce(
    new ApiError(409, "STALE_WRITE", "Conflict"),
  );
  service.fetchMap.mockResolvedValueOnce(latest);
  await store
    .getState()
    .updateNodeStyle(original.root.id, {
      backgroundColor: undefined,
      connectorStyle: "dotted",
    });
  expect(disk().root.style).toEqual({
    borderColor: "#222222",
    textColor: "#ff00ff",
    connectorStyle: "dotted",
  });
  expect(disk().title).toBe("Remote title");
});
it("does not resurrect a styled node deleted in another tab", async () => {
  const { store, service, original } = await setup();
  const latest = structuredClone(original);
  latest.root.children = [];
  latest.revision = 4;
  service.saveMap.mockRejectedValueOnce(
    new ApiError(409, "STALE_WRITE", "Conflict"),
  );
  service.fetchMap.mockResolvedValueOnce(latest);
  expect(
    await store
      .getState()
      .updateNodeStyle(original.root.children[0].id, {
        backgroundColor: "#ff0000",
      }),
  ).toBe(false);
  expect(service.saveMap).toHaveBeenCalledTimes(1);
  expect(store.getState().map).toEqual(latest);
  expect(store.getState().error).toContain("no longer exists");
});
it("serializes independent style patches and removes customization with a deleted branch", async () => {
  const { store, service, original, disk } = await setup();
  let release!: (map: MapFile) => void;
  service.saveMap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const child = original.root.children[0];
  const first = store
    .getState()
    .updateNodeStyle(child.id, { textColor: "#123456" });
  const snapshot = structuredClone(store.getState().map!);
  const second = store
    .getState()
    .updateNodeStyle(child.id, { connectorWidth: 1 });
  release({ ...snapshot, revision: 2 });
  await Promise.all([first, second]);
  expect(disk().root.children[0].style).toEqual({
    textColor: "#123456",
    connectorWidth: 1,
  });
  await store.getState().deleteNode(child.id);
  expect(disk().root.children).toEqual([]);
  expect(JSON.stringify(disk())).not.toContain("#123456");
});
