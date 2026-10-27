import { expect, it, vi } from "vitest";
import fc from "fast-check";
import { createEditorStore } from "../../src/client/stores/editorStore";
import { ApiError } from "../../src/client/api";
import { allNodes, findParent } from "../../src/shared/tree";
import type { MapFile, MapNode } from "../../src/shared/schema";
import { fixture, mapArb } from "../fixtures";

async function setup(initial = fixture()) {
  // Match the JSON API boundary: generated trees can share empty arrays,
  // whereas files and HTTP responses contain independent child arrays.
  let disk = JSON.parse(JSON.stringify(initial)) as MapFile;
  const service = {
    fetchMap: vi.fn(async () => structuredClone(disk)),
    saveMap: vi.fn(async (map: MapFile) => {
      expect(map.revision).toBe(disk.revision);
      disk = structuredClone({
        ...map,
        revision: disk.revision + 1,
        updatedAt: new Date(Date.parse(disk.updatedAt) + 1000).toISOString(),
      });
      return structuredClone(disk);
    }),
  };
  const store = createEditorStore(service);
  await store.getState().loadMap(initial.id);
  return {
    store,
    service,
    disk: () => disk,
    setDisk: (map: MapFile) => {
      disk = map;
    },
  };
}
type Store = Awaited<ReturnType<typeof setup>>["store"];
function tree() {
  const map = fixture();
  const node = (n: number): MapNode => ({
    id: `12345678-1234-4234-8234-${String(n).padStart(12, "0")}`,
    text: `Node ${n}`,
    collapsed: false,
    children: [],
  });
  map.root.children = [node(20), node(21), node(22)];
  map.root.children[0].children = [node(23)];
  return map;
}
async function operate(
  store: Store,
  kind: number,
  choice: number,
  index: number,
) {
  const s = store.getState(),
    map = s.map!;
  const nodes = allNodes(map.root),
    node = nodes[choice % nodes.length];
  const nonRoot = nodes.slice(1);
  switch (kind) {
    case 0:
      s.addNode(node.id);
      return store
        .getState()
        .editNodeText(store.getState().draft!.id, `Added ${index}`);
    case 1:
      return s.editNodeText(node.id, `Edit ${index}`);
    case 2:
      if (nonRoot.length)
        return s.deleteNode(nonRoot[choice % nonRoot.length].id);
      break;
    case 3:
      return s.updateNodeStyle(node.id, {
        backgroundColor: index % 2 ? "#ffbbcc" : "#aabbcc",
        connectorWidth: (index % 8) + 1,
        connectorColor: `#${(0x100000 + index).toString(16)}`,
      });
    case 4: {
      const parents = nodes.filter((n) => n.children.length > 1);
      if (parents.length) {
        const parent = parents[choice % parents.length];
        return s.reorderNode(parent.children[0].id, parent.children.length - 1);
      }
      break;
    }
    case 5: {
      const moves = nonRoot.flatMap((n) =>
        nodes
          .filter(
            (p) =>
              p.id !== n.id &&
              findParent(map.root, n.id)?.id !== p.id &&
              !allNodes(n).some((child) => child.id === p.id),
          )
          .map((p) => ({ node: n, parent: p })),
      );
      if (moves.length) {
        const move = moves[choice % moves.length];
        return s.moveNode(move.node.id, move.parent.id, 0);
      }
      break;
    }
    case 6: {
      const branches = nonRoot.filter((n) => n.children.length);
      if (branches.length)
        return s.toggleCollapse(branches[choice % branches.length].id);
    }
  }
  return s.editNodeText(map.root.id, `Fallback ${index}`);
}
const sequence = fc.array(fc.tuple(fc.integer({ min: 0, max: 6 }), fc.nat()), {
  minLength: 1,
  maxLength: 18,
});
// Feature: maplora, Property 20: Undo reverses the most recent operation.
it("undo reverses generated sequences of all node operation kinds", async () => {
  await fc.assert(
    fc.asyncProperty(
      mapArb.filter((map) => allNodes(map.root).length <= 20),
      sequence,
      async (initial, operations) => {
        const { store, disk } = await setup(initial);
        const snapshots: MapNode[] = [];
        for (const [index, [kind, choice]] of operations.entries()) {
          snapshots.push(structuredClone(store.getState().map!.root));
          expect(await operate(store, kind, choice, index)).toBe(true);
        }
        for (const snapshot of snapshots.reverse()) {
          const revision = disk().revision;
          expect(await store.getState().undo()).toBe(true);
          expect(store.getState().map!.root).toEqual(snapshot);
          expect(disk().root).toEqual(snapshot);
          expect(disk().revision).toBe(revision + 1);
        }
        expect(store.getState().undoStack).toHaveLength(0);
      },
    ),
    { numRuns: 100 },
  );
});
// Feature: maplora, Property 21: Undo then redo is an identity operation.
it("undo followed by redo restores each generated tree including IDs and styles", async () => {
  await fc.assert(
    fc.asyncProperty(sequence, async (operations) => {
      const { store, disk } = await setup(tree());
      for (const [index, [kind, choice]] of operations.entries()) {
        expect(await operate(store, kind, choice, index)).toBe(true);
        const after = structuredClone(disk());
        expect(await store.getState().undo()).toBe(true);
        expect(await store.getState().redo()).toBe(true);
        expect(disk()).toEqual({
          ...after,
          revision: after.revision + 2,
          updatedAt: new Date(Date.parse(after.updatedAt) + 2000).toISOString(),
        });
        expect(store.getState().map).toEqual(disk());
      }
    }),
    { numRuns: 100 },
  );
});
it("caps history at 50, drops the oldest snapshots and redoes the entire retained history", async () => {
  const { store, disk, service } = await setup();
  for (let i = 0; i < 55; i++)
    await store.getState().editNodeText(fixture().root.id, `Edit ${i}`);
  expect(store.getState().undoStack).toHaveLength(50);
  for (let i = 0; i < 50; i++) expect(await store.getState().undo()).toBe(true);
  expect(disk().root.text).toBe("Edit 4");
  expect(store.getState().redoStack).toHaveLength(50);
  expect(await store.getState().undo()).toBe(false);
  for (let i = 0; i < 50; i++) expect(await store.getState().redo()).toBe(true);
  expect(disk().root.text).toBe("Edit 54");
  expect(store.getState().undoStack).toHaveLength(50);
  expect(await store.getState().redo()).toBe(false);
  expect(service.saveMap).toHaveBeenCalledTimes(155);
});
it("does nothing without a loaded map or an available history entry", async () => {
  const { store, service } = await setup();
  expect(await store.getState().undo()).toBe(false);
  expect(await store.getState().redo()).toBe(false);
  store.setState({ map: null });
  expect(await store.getState().undo()).toBe(false);
  expect(await store.getState().redo()).toBe(false);
  expect(service.saveMap).not.toHaveBeenCalled();
});
it("clears redo only for a new valid operation, not drafts or invalid/no-op changes", async () => {
  const { store } = await setup();
  const root = fixture().root.id;
  await store.getState().editNodeText(root, "First");
  await store.getState().undo();
  store.getState().addNode(root);
  expect(await store.getState().redo()).toBe(false);
  expect(store.getState().redoStack).toHaveLength(1);
  store.getState().cancelEdit();
  await expect(store.getState().editNodeText(root, "   ")).rejects.toThrow();
  await store.getState().editNodeText(root, fixture().root.text);
  await store.getState().deleteNode(root);
  expect(store.getState().redoStack).toHaveLength(1);
  await store.getState().editNodeText(root, "New timeline");
  expect(store.getState().redoStack).toHaveLength(0);
});
it("resets both stacks on load and ignores late saves from the previous map", async () => {
  const { store, service } = await setup();
  await store.getState().editNodeText(fixture().root.id, "Changed");
  let release!: (map: MapFile) => void;
  service.saveMap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const old = store.getState().undo();
  const next = { ...tree(), id: "12345678-1234-4234-8234-000000000050" };
  service.fetchMap.mockResolvedValueOnce(next);
  await store.getState().loadMap(next.id);
  release(fixture());
  expect(await old).toBe(false);
  expect(store.getState().map).toEqual(next);
  expect(store.getState().undoStack).toEqual([]);
  expect(store.getState().redoStack).toEqual([]);
});
it.each(["undo", "redo"] as const)(
  "rolls back failed %s and retries with both stacks intact",
  async (action) => {
    const { store, service, disk } = await setup();
    await store.getState().editNodeText(fixture().root.id, "Changed");
    if (action === "redo") await store.getState().undo();
    const before = structuredClone({
      map: store.getState().map,
      undoStack: store.getState().undoStack,
      redoStack: store.getState().redoStack,
    });
    service.saveMap.mockRejectedValueOnce(new Error("Disk full"));
    expect(await store.getState()[action]()).toBe(false);
    expect(store.getState()).toMatchObject(before);
    expect(store.getState().error).toContain("Disk full");
    expect(await store.getState().saveMap()).toBe(true);
    expect(disk().root.text).toBe(
      action === "undo" ? fixture().root.text : "Changed",
    );
    expect(store.getState().error).toBeNull();
  },
);
it("removes failed mutations from history and restores redo after a failed new edit", async () => {
  const { store, service } = await setup();
  await store.getState().editNodeText(fixture().root.id, "Changed");
  await store.getState().undo();
  const before = structuredClone(store.getState().redoStack);
  service.saveMap.mockRejectedValueOnce(new Error("Failure"));
  await store.getState().editNodeText(fixture().root.id, "Failed");
  expect(store.getState().undoStack).toEqual([]);
  expect(store.getState().redoStack).toEqual(before);
  expect(await store.getState().redo()).toBe(true);
  expect(store.getState().map!.root.text).toBe("Changed");
});
it("serializes rapid edits, undo and redo while a save is in flight", async () => {
  const { store, service, disk, setDisk } = await setup();
  let release!: (map: MapFile) => void;
  service.saveMap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const root = fixture().root.id;
  const first = store.getState().editNodeText(root, "First");
  const second = store.getState().editNodeText(root, "Second");
  const undo = store.getState().undo();
  const redo = store.getState().redo();
  expect(store.getState().map!.root.text).toBe("Second");
  const saved = {
    ...fixture(),
    revision: 2,
    root: { ...fixture().root, text: "First" },
  };
  setDisk(saved);
  release(saved);
  expect(await Promise.all([first, second, undo, redo])).toEqual([
    true,
    true,
    true,
    true,
  ]);
  expect(disk().root.text).toBe("Second");
  expect(disk().revision).toBe(5);
  expect(store.getState().undoStack.map((m) => m.root.text)).toEqual([
    fixture().root.text,
    "First",
  ]);
  expect(store.getState().redoStack).toEqual([]);
});
it("reprojects queued history after an earlier save fails", async () => {
  const { store, service, disk } = await setup();
  let reject!: (error: Error) => void;
  service.saveMap.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const first = store.getState().editNodeText(fixture().root.id, "Failed");
  const second = store.getState().editNodeText(fixture().root.id, "Saved");
  const undo = store.getState().undo();
  reject(new Error("Failure"));
  expect(await Promise.all([first, second, undo])).toEqual([false, true, true]);
  expect(disk().root).toEqual(fixture().root);
  expect(store.getState().undoStack).toEqual([]);
  expect(store.getState().redoStack.map((m) => m.root.text)).toEqual(["Saved"]);
});
it("uses the latest metadata on conflict and retains that state for redo", async () => {
  const { store, service, disk, setDisk } = await setup();
  await store.getState().editNodeText(fixture().root.id, "Local");
  const latest = {
    ...disk(),
    revision: 8,
    title: "Renamed remotely",
    root: { ...disk().root, text: "Remote" },
  };
  setDisk(latest);
  service.saveMap.mockRejectedValueOnce(
    new ApiError(409, "STALE_WRITE", "Conflict"),
  );
  expect(await store.getState().undo()).toBe(true);
  expect(disk()).toMatchObject({
    title: latest.title,
    revision: 9,
    root: fixture().root,
  });
  expect(store.getState().notice).toContain("newer revision");
  expect(await store.getState().redo()).toBe(true);
  expect(disk()).toMatchObject({
    title: latest.title,
    revision: 10,
    root: latest.root,
  });
});
it("selects a valid node when undo removes the selected addition and preserves native text editing", async () => {
  const { store } = await setup();
  const root = fixture().root.id;
  store.getState().addNode(root);
  const id = store.getState().draft!.id;
  await store.getState().editNodeText(id, "New child");
  store.getState().beginEdit(id);
  expect(await store.getState().undo()).toBe(false);
  store.getState().cancelEdit();
  expect(await store.getState().undo()).toBe(true);
  expect(store.getState().selectedNodeId).toBe(root);
  expect(store.getState().editingNodeId).toBeNull();
  expect(await store.getState().redo()).toBe(true);
  expect(store.getState().map!.root.children[0].id).toBe(id);
});
