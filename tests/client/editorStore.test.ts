import { expect, it, vi } from "vitest";
import fc from "fast-check";
import {
  createEditorStore,
  applyOperation,
} from "../../src/client/stores/editorStore";
import { ApiError } from "../../src/client/api";
import { allNodes, findNode } from "../../src/shared/tree";
import { fixture, mapArb, textArb } from "../fixtures";
import type { MapFile } from "../../src/shared/schema";
function setup(initial = fixture()) {
  let disk = structuredClone(initial);
  const service = {
    fetchMap: vi.fn(async () => structuredClone(disk)),
    saveMap: vi.fn(async (m: MapFile) => {
      disk = structuredClone({ ...m, revision: disk.revision + 1 });
      return structuredClone(disk);
    }),
  };
  return { service, store: createEditorStore(service), disk: () => disk };
}
// Feature: maplora, Properties 9–13: UUIDs, edits, validation, deletion and collapse
it("persists generated add/edit/collapse/delete operations with unique IDs", async () => {
  await fc.assert(
    fc.asyncProperty(textArb, async (text) => {
      const { store, disk } = setup();
      await store.getState().loadMap(fixture().id);
      const root = store.getState().map!.root;
      store.getState().addNode(root.id);
      const child = store.getState().draft!.id;
      expect(allNodes(root).some((n) => n.id === child)).toBe(false);
      expect(child).toMatch(/^[a-f0-9-]{14}4[a-f0-9-]+$/);
      await store.getState().editNodeText(child, text);
      expect(disk().root.children[0].text).toBe(text);
      store.getState().addNode(child);
      const grandchild = store.getState().draft!.id;
      await store.getState().editNodeText(grandchild, "Nested");
      await store.getState().toggleCollapse(child);
      expect(disk().root.children[0].collapsed).toBe(true);
      await store.getState().loadMap(fixture().id);
      expect(findNode(store.getState().map!.root, child)!.collapsed).toBe(true);
      await store.getState().editNodeText(child, "Changed");
      expect(disk().root.children[0].text).toBe("Changed");
      await store.getState().deleteNode(child);
      expect(allNodes(disk().root).map((n) => n.id)).not.toContain(grandchild);
      expect(disk().root.children).toHaveLength(0);
      expect(await store.getState().deleteNode(root.id)).toBe(false);
    }),
    { numRuns: 100 },
  );
});
function orderedMap(count = 3) {
  const map = fixture();
  map.root.children = Array.from({ length: count }, (_, index) => ({
    id: `12345678-1234-4234-8234-${String(index + 20).padStart(12, "0")}`,
    text: `Branch ${index}`,
    collapsed: index % 2 === 0,
    style: { backgroundColor: "#abcdef" },
    children: [
      {
        id: `12345678-1234-4234-8234-${String(index + 100).padStart(12, "0")}`,
        text: `Leaf ${index}`,
        collapsed: false,
        children: [],
      },
    ],
  }));
  return map;
}
it("persists generated sibling reorders with intact subtrees, selection and history", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 8 }),
      fc.nat(),
      fc.nat(),
      async (count, from, to) => {
        from %= count;
        to %= count;
        const original = orderedMap(count);
        const { store, service, disk } = setup(original);
        await store.getState().loadMap(original.id);
        const id = original.root.children[from].id;
        store.getState().select(id);
        const expected = structuredClone(original.root.children);
        const [moved] = expected.splice(from, 1);
        expected.splice(to, 0, moved);
        expect(await store.getState().reorderNode(id, to)).toBe(from !== to);
        expect(disk().root.children).toEqual(expected);
        expect(store.getState().selectedNodeId).toBe(id);
        expect(service.saveMap).toHaveBeenCalledTimes(from === to ? 0 : 1);
        expect(store.getState().undoStack).toEqual(
          from === to ? [] : [original],
        );
      },
    ),
    { numRuns: 100 },
  );
});
it("ignores root, missing-node, invalid-index and editing-time reorders without saving", async () => {
  const original = orderedMap();
  const { store, service } = setup(original);
  await store.getState().loadMap(original.id);
  const id = original.root.children[0].id;
  for (const index of [-1, 3, 1.5, NaN, Infinity, 0])
    expect(await store.getState().reorderNode(id, index)).toBe(false);
  expect(await store.getState().reorderNode(original.root.id, 1)).toBe(false);
  expect(await store.getState().reorderNode("missing", 1)).toBe(false);
  store.getState().beginEdit(id);
  expect(await store.getState().reorderNode(id, 1)).toBe(false);
  store.getState().cancelEdit();
  store.getState().addNode(original.root.id);
  expect(await store.getState().reorderNode(id, 1)).toBe(false);
  expect(service.saveMap).not.toHaveBeenCalled();
});
it("rolls back failed reorders and retries while retaining the moved branch selection", async () => {
  const original = orderedMap();
  const { store, service, disk } = setup(original);
  await store.getState().loadMap(original.id);
  const id = original.root.children[2].id;
  store.getState().select(id);
  service.saveMap.mockRejectedValueOnce(new Error("Disk full"));
  expect(await store.getState().reorderNode(id, 0)).toBe(false);
  expect(store.getState().map!.root).toEqual(original.root);
  expect(store.getState().selectedNodeId).toBe(id);
  expect(store.getState().error).toContain("Disk full");
  expect(await store.getState().saveMap()).toBe(true);
  expect(disk().root.children.map((node) => node.id)).toEqual([
    id,
    original.root.children[0].id,
    original.root.children[1].id,
  ]);
});
it("rebases a reorder by sibling ID while preserving remote additions and edits", async () => {
  const original = orderedMap();
  const { store, service, disk } = setup(original);
  await store.getState().loadMap(original.id);
  const latest = orderedMap(4);
  latest.revision = 5;
  const remote = latest.root.children.pop()!;
  latest.root.children.unshift(remote);
  latest.root.children[2].text = "Remote edit";
  service.saveMap.mockRejectedValueOnce(
    new ApiError(409, "STALE_WRITE", "Conflict"),
  );
  service.fetchMap.mockResolvedValueOnce(latest);
  const id = original.root.children[2].id;
  expect(await store.getState().reorderNode(id, 0)).toBe(true);
  expect(disk().root.children.map((node) => node.id)).toEqual([
    remote.id,
    id,
    original.root.children[0].id,
    original.root.children[1].id,
  ]);
  expect(disk().root.children[3].text).toBe("Remote edit");
});
it("rejects replay when the branch has changed parent or its anchor was removed", async () => {
  const original = orderedMap();
  const id = original.root.children[2].id;
  const operation = {
    kind: "reorder" as const,
    id,
    parentId: original.root.id,
    beforeId: original.root.children[0].id,
  };
  const moved = structuredClone(original);
  moved.root.children[0].children.push(moved.root.children.pop()!);
  expect(() => applyOperation(moved, operation)).toThrow("original parent");
  const removed = structuredClone(original);
  removed.root.children.shift();
  expect(() => applyOperation(removed, operation)).toThrow("target sibling");
  expect(original.root.children).toHaveLength(3);
});
it("serializes rapid sibling reorders without overwriting the newer order", async () => {
  const original = orderedMap();
  const { store, service, disk } = setup(original);
  await store.getState().loadMap(original.id);
  let release!: (map: MapFile) => void;
  service.saveMap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = store.getState().reorderNode(original.root.children[0].id, 2);
  const firstSnapshot = structuredClone(store.getState().map!);
  const second = store.getState().reorderNode(original.root.children[1].id, 2);
  release({ ...firstSnapshot, revision: 2 });
  await Promise.all([first, second]);
  expect(disk().root.children.map((node) => node.text)).toEqual([
    "Branch 2",
    "Branch 0",
    "Branch 1",
  ]);
});
it("rejects generated whitespace edits without sending a save", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom(" ", "\t", "\n", "\r"), {
        minLength: 1,
        maxLength: 20,
      }),
      async (chars) => {
        const { store, service } = setup();
        await store.getState().loadMap(fixture().id);
        await expect(
          store.getState().editNodeText(fixture().root.id, chars.join("")),
        ).rejects.toThrow();
        expect(service.saveMap).not.toHaveBeenCalled();
      },
    ),
    { numRuns: 100 },
  );
});
it("cancels pending nodes without writing and inserts a sibling immediately after the selected node", async () => {
  const { store, service, disk } = setup();
  await store.getState().loadMap(fixture().id);
  const root = fixture().root.id;
  store.getState().addNode(root);
  store.getState().cancelEdit();
  expect(service.saveMap).not.toHaveBeenCalled();
  store.getState().addNode(root);
  await store.getState().editNodeText(store.getState().draft!.id, "   ");
  expect(service.saveMap).not.toHaveBeenCalled();
  store.getState().addNode(root);
  const first = store.getState().draft!.id;
  await store.getState().editNodeText(first, "First");
  store.getState().addNode(root);
  await store.getState().editNodeText(store.getState().draft!.id, "Last");
  store.getState().addNode(root, first);
  await store.getState().editNodeText(store.getState().draft!.id, "Middle");
  expect(disk().root.children.map((n) => n.text)).toEqual([
    "First",
    "Middle",
    "Last",
  ]);
});
it("rolls back failed edits and can retry the exact operation", async () => {
  const { store, service, disk } = setup();
  await store.getState().loadMap(fixture().id);
  service.saveMap.mockRejectedValueOnce(new Error("Disk full"));
  expect(
    await store.getState().editNodeText(fixture().root.id, "Unsaved"),
  ).toBe(false);
  expect(store.getState().map!.root.text).toBe("Garden of ideas");
  expect(store.getState().error).toContain("Disk full");
  await store.getState().saveMap();
  expect(disk().root.text).toBe("Unsaved");
});
it("rolls back failed additions, deletions and collapse", async () => {
  const { store, service } = setup();
  await store.getState().loadMap(fixture().id);
  const root = fixture().root.id;
  store.getState().addNode(root);
  let id = store.getState().draft!.id;
  service.saveMap.mockRejectedValueOnce(new Error("Failure"));
  await store.getState().editNodeText(id, "Failed child");
  expect(store.getState().map!.root.children).toHaveLength(0);
  store.getState().addNode(root);
  id = store.getState().draft!.id;
  await store.getState().editNodeText(id, "Child");
  store.getState().addNode(id);
  await store.getState().editNodeText(store.getState().draft!.id, "Grandchild");
  service.saveMap.mockRejectedValueOnce(new Error("Failure"));
  await store.getState().deleteNode(id);
  expect(store.getState().map!.root.children[0].children).toHaveLength(1);
  service.saveMap.mockRejectedValueOnce(new Error("Failure"));
  await store.getState().toggleCollapse(id);
  expect(store.getState().map!.root.children[0].collapsed).toBe(false);
});
it("reapplies only the pending operation on conflict, preserving unrelated remote changes", async () => {
  const { store, service, disk } = setup();
  await store.getState().loadMap(fixture().id);
  const latest = { ...fixture(), title: "Changed in another tab", revision: 5 };
  service.saveMap.mockRejectedValueOnce(
    new ApiError(409, "STALE_WRITE", "Conflict"),
  );
  service.fetchMap.mockResolvedValueOnce(latest);
  await store.getState().editNodeText(fixture().root.id, "Local text");
  expect(disk()).toMatchObject({
    title: "Changed in another tab",
    root: { text: "Local text" },
  });
  expect(service.saveMap).toHaveBeenCalledTimes(2);
});
it("serializes rapid mutations without losing newer changes when a slow save finishes", async () => {
  const { store, service, disk } = setup();
  await store.getState().loadMap(fixture().id);
  let release!: (map: MapFile) => void;
  service.saveMap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = store.getState().editNodeText(fixture().root.id, "First");
  const second = store.getState().editNodeText(fixture().root.id, "Second");
  expect(store.getState().map!.root.text).toBe("Second");
  release({
    ...fixture(),
    revision: 2,
    root: { ...fixture().root, text: "First" },
  });
  await Promise.all([first, second]);
  expect(disk().root.text).toBe("Second");
});
it("caps snapshot infrastructure at 50 and resets it when loading a map", async () => {
  const { store } = setup();
  await store.getState().loadMap(fixture().id);
  for (let i = 0; i < 55; i++)
    await store.getState().editNodeText(fixture().root.id, `Edit ${i}`);
  expect(store.getState().undoStack).toHaveLength(50);
  await store.getState().loadMap(fixture().id);
  expect(store.getState().undoStack).toHaveLength(0);
});
it("deletes entire generated subtrees and protects root identity", () => {
  fc.assert(
    fc.property(mapArb, (map) => {
      if (!map.root.children.length) return;
      const removed = map.root.children[0],
        result = applyOperation(map, { kind: "delete", id: removed.id });
      const ids = allNodes(result.root).map((n) => n.id);
      for (const child of allNodes(removed))
        expect(ids).not.toContain(child.id);
      expect(result.root.id).toBe(map.root.id);
    }),
    { numRuns: 100 },
  );
});
it("ignores a late conflict response after navigating to another map", async () => {
  const { store, service } = setup();
  await store.getState().loadMap(fixture().id);
  let rejectOld!: (error: Error) => void;
  service.saveMap.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  const old = store.getState().editNodeText(fixture().root.id, "Old map edit");
  const next = {
    ...fixture(),
    id: "12345678-1234-4234-8234-123456789014",
    title: "Next map",
    root: { ...fixture().root, id: "12345678-1234-4234-8234-123456789015" },
  };
  service.fetchMap.mockResolvedValueOnce(next);
  await store.getState().loadMap(next.id);
  rejectOld(new ApiError(409, "STALE_WRITE", "Old conflict"));
  await old;
  await store.getState().editNodeText(next.root.id, "Next map edit");
  expect(store.getState().map).toMatchObject({
    id: next.id,
    root: { text: "Next map edit" },
  });
  expect(service.fetchMap).toHaveBeenCalledTimes(2);
});
