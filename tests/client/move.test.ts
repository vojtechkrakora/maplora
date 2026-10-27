import { expect, it, vi } from "vitest";
import fc from "fast-check";
import { ApiError } from "../../src/client/api";
import {
  applyOperation,
  createEditorStore,
} from "../../src/client/stores/editorStore";
import { MapFileSchema, type MapFile } from "../../src/shared/schema";
import { allNodes, findNode, findParent } from "../../src/shared/tree";
import { fixture } from "../fixtures";

function branchMap() {
  const map = fixture();
  const id = (n: number) =>
    `12345678-1234-4234-8234-${String(n).padStart(12, "0")}`;
  map.root.children = [0, 1, 2].map((index) => ({
    id: id(index + 20),
    text: `Branch ${index}`,
    collapsed: true,
    style: { backgroundColor: "#abcdef" },
    children: [0, 1].map((child) => ({
      id: id(index * 10 + child + 100),
      text: `Leaf ${index}.${child}`,
      collapsed: child === 1,
      children: [],
    })),
  }));
  return map;
}
async function setup(initial = branchMap()) {
  let disk = structuredClone(initial);
  const service = {
    fetchMap: vi.fn(async () => structuredClone(disk)),
    saveMap: vi.fn(async (map: MapFile) => {
      disk = structuredClone({ ...map, revision: disk.revision + 1 });
      return structuredClone(disk);
    }),
  };
  const store = createEditorStore(service);
  await store.getState().loadMap(initial.id);
  return { store, service, disk: () => disk, original: initial };
}
it("moves generated branches at any insertion index without losing subtree data or IDs", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: 2 }),
      fc.boolean(),
      fc.integer({ min: 0, max: 2 }),
      async (from, direction, index) => {
        const { store, disk, original } = await setup();
        const branch = original.root.children[from];
        const destination =
          original.root.children[(from + (direction ? 1 : 2)) % 3];
        store.getState().select(branch.id);
        expect(
          await store.getState().moveNode(branch.id, destination.id, index),
        ).toBe(true);
        const saved = disk();
        expect(MapFileSchema.parse(saved)).toEqual(saved);
        expect(findParent(saved.root, branch.id)?.id).toBe(destination.id);
        expect(findNode(saved.root, branch.id)).toEqual(branch);
        const target = findNode(saved.root, destination.id)!;
        expect(target.collapsed).toBe(false);
        expect(target.children[index]).toEqual(branch);
        expect(target.children.filter((node) => node.id !== branch.id)).toEqual(
          destination.children,
        );
        expect(
          allNodes(saved.root)
            .map((node) => node.id)
            .sort(),
        ).toEqual(
          allNodes(original.root)
            .map((node) => node.id)
            .sort(),
        );
        expect(store.getState().undoStack).toEqual([original]);
        expect(store.getState().selectedNodeId).toBe(branch.id);
        expect(saved.revision).toBe(2);
      },
    ),
    { numRuns: 100 },
  );
});
it("allows moving a nested child to the root and preserves sibling order", async () => {
  const { store, disk, original } = await setup();
  const branch = original.root.children[0];
  const child = branch.children[1];
  expect(await store.getState().moveNode(child.id, original.root.id, 1)).toBe(
    true,
  );
  expect(disk().root.children.map((node) => node.id)).toEqual([
    branch.id,
    child.id,
    original.root.children[1].id,
    original.root.children[2].id,
  ]);
  expect(findNode(disk().root, branch.id)?.children).toEqual([
    branch.children[0],
  ]);
});
it("rejects roots, self, descendants, current parent, missing nodes and invalid indices without writes", async () => {
  const { store, service, original } = await setup();
  const [branch, target] = original.root.children;
  for (const [id, parentId, index] of [
    [original.root.id, target.id, 0],
    [branch.id, branch.id, 0],
    [branch.id, branch.children[0].id, 0],
    [branch.id, original.root.id, 0],
    ["missing", target.id, 0],
    [branch.id, "missing", 0],
    ...[-1, 3, 0.5, NaN, Infinity].map((index) => [
      branch.id,
      target.id,
      index,
    ]),
  ] as [string, string, number][])
    expect(await store.getState().moveNode(id, parentId, index)).toBe(false);
  store.getState().beginEdit(branch.id);
  expect(await store.getState().moveNode(branch.id, target.id, 0)).toBe(false);
  store.getState().cancelEdit();
  store.getState().addNode(original.root.id);
  expect(await store.getState().moveNode(branch.id, target.id, 0)).toBe(false);
  expect(service.saveMap).not.toHaveBeenCalled();
  expect(store.getState().map).toEqual(original);
  expect(store.getState().undoStack).toEqual([]);
});
it("rolls back a failed move including destination expansion and exposes a dismissible move error", async () => {
  const { store, service, disk, original } = await setup();
  const [branch, target] = original.root.children;
  service.saveMap.mockRejectedValueOnce(new Error("Disk full"));
  expect(await store.getState().moveNode(branch.id, target.id, 0)).toBe(false);
  expect(store.getState().map).toEqual(original);
  expect(disk()).toEqual(original);
  expect(store.getState().moveError).toContain("Disk full");
  expect(store.getState().error).toBeNull();
  expect(store.getState().saving).toBe("idle");
  store.getState().dismissMoveError();
  expect(store.getState().moveError).toBeNull();
  expect(await store.getState().moveNode(branch.id, target.id, 0)).toBe(true);
});
it("rebases a move using its destination anchor without losing unrelated remote edits", async () => {
  const { store, service, disk, original } = await setup();
  const [branch, target] = original.root.children;
  const latest = structuredClone(original);
  latest.title = "Remote title";
  latest.revision = 5;
  const remote = { ...fixture().root, children: [], text: "Remote child" };
  latest.root.children[1].children.unshift({
    ...remote,
    id: "12345678-1234-4234-8234-000000000999",
  });
  service.saveMap.mockRejectedValueOnce(
    new ApiError(409, "STALE_WRITE", "Conflict"),
  );
  service.fetchMap.mockResolvedValueOnce(latest);
  expect(await store.getState().moveNode(branch.id, target.id, 0)).toBe(true);
  const savedTarget = findNode(disk().root, target.id)!;
  expect(savedTarget.children.map((node) => node.text)).toEqual([
    "Remote child",
    branch.text,
    ...target.children.map((node) => node.text),
  ]);
  expect(disk().title).toBe("Remote title");
});
it("rejects a move that becomes cyclic after a stale revision without overwriting the newer tree", async () => {
  const { store, service, original } = await setup();
  const [branch, target] = original.root.children;
  const latest = structuredClone(original);
  const [remoteTarget] = latest.root.children.splice(1, 1);
  latest.root.children[0].children.push(remoteTarget);
  latest.revision = 5;
  service.saveMap.mockRejectedValueOnce(
    new ApiError(409, "STALE_WRITE", "Conflict"),
  );
  service.fetchMap.mockResolvedValueOnce(latest);
  expect(await store.getState().moveNode(branch.id, target.id, 0)).toBe(false);
  expect(service.saveMap).toHaveBeenCalledTimes(1);
  expect(store.getState().map).toEqual(latest);
  expect(store.getState().moveError).toContain("descendants");
});
it("rejects move replay after an original parent or insertion anchor changed", () => {
  const source = branchMap();
  const [branch, target, other] = source.root.children;
  const operation = {
    kind: "move" as const,
    id: branch.id,
    parentId: source.root.id,
    newParentId: target.id,
    beforeId: target.children[0].id,
  };
  const moved = structuredClone(source);
  moved.root.children.splice(0, 1);
  findNode(moved.root, other.id)!.children.push(structuredClone(branch));
  expect(() => applyOperation(moved, operation)).toThrow("original parent");
  const missing = structuredClone(source);
  missing.root.children[1].children.shift();
  expect(() => applyOperation(missing, operation)).toThrow("target sibling");
  expect(source).toEqual(branchMap());
});
it("serializes a move and a subsequent descendant edit without losing either change", async () => {
  const { store, service, disk, original } = await setup();
  const [branch, target] = original.root.children;
  let release!: (map: MapFile) => void;
  service.saveMap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const move = store.getState().moveNode(branch.id, target.id, 0);
  const snapshot = structuredClone(store.getState().map!);
  const edit = store
    .getState()
    .editNodeText(branch.children[0].id, "Edited descendant");
  release({ ...snapshot, revision: 2 });
  await Promise.all([move, edit]);
  expect(findParent(disk().root, branch.id)?.id).toBe(target.id);
  expect(findNode(disk().root, branch.children[0].id)?.text).toBe(
    "Edited descendant",
  );
});
it("retains deleted-map handling for a move returning HTTP 410", async () => {
  const { store, service, original } = await setup();
  service.saveMap.mockRejectedValueOnce(
    new ApiError(410, "MAP_TRASHED", "Map is in trash"),
  );
  expect(
    await store
      .getState()
      .moveNode(original.root.children[0].id, original.root.children[1].id, 0),
  ).toBe(false);
  expect(store.getState().gone).toBe(true);
  expect(store.getState().error).toContain("trash");
  expect(store.getState().moveError).toBeNull();
});
