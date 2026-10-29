import { expect, it, vi } from "vitest";
import fc from "fast-check";
import { fixture, mapArb } from "../fixtures";
import {
  MapFileSchema,
  UUIDSchema,
  type MapFile,
  type MapNode,
} from "../../src/shared/schema";
import { allNodes, findNode } from "../../src/shared/tree";
import {
  decodeSubtree,
  encodeSubtree,
  remapSubtree,
  sameSubtree,
  snapshotSubtree,
} from "../../src/client/subtreeClipboard";
import {
  applyOperation,
  createEditorStore,
} from "../../src/client/stores/editorStore";
import { ApiError } from "../../src/client/api";

const styledMap = mapArb.map((generated) => {
  const map: MapFile = JSON.parse(JSON.stringify(generated));
  for (const [i, node] of allNodes(map.root).entries()) {
    if (i % 2 === 0)
      node.style = {
        backgroundColor: "#123456",
        textColor: "#fedcba",
        borderColor: "#012345",
        connectorColor: "#abcdef",
        connectorStyle: "dotted",
        connectorWidth: 3,
      };
    if (i % 3 === 0) node.text = "  Příliš žluťoučký 🌳\n第二行\t ";
  }
  return map;
});
function node(n: number, children: MapNode[] = []): MapNode {
  return {
    id: `12345678-1234-4234-8234-${String(n).padStart(12, "0")}`,
    text: `Node ${n}`,
    collapsed: false,
    children,
  };
}
function tree() {
  const map = fixture();
  map.root.children = [
    node(20, [node(23, [node(24)])]),
    node(21, [node(25)]),
    node(22),
  ];
  map.root.children[0].collapsed = true;
  map.root.children[0].style = { connectorStyle: "dashed", connectorWidth: 4 };
  map.root.children[1].collapsed = true;
  return map;
}
async function setup(initial = tree()) {
  let disk = structuredClone(initial);
  const service = {
    fetchMap: vi.fn(async () => structuredClone(disk)),
    saveMap: vi.fn(async (map: MapFile) => {
      expect(map.revision).toBe(disk.revision);
      disk = {
        ...structuredClone(map),
        revision: disk.revision + 1,
        updatedAt: new Date(Date.parse(disk.updatedAt) + 1000).toISOString(),
      };
      return structuredClone(disk);
    }),
  };
  const store = createEditorStore(service);
  await store.getState().loadMap(initial.id);
  return {
    store,
    service,
    disk: () => disk,
    remote: (map: MapFile) => {
      disk = map;
    },
  };
}
function withoutIds(root: MapNode): unknown {
  const { id, children, ...rest } = root;
  return { ...rest, children: children.map(withoutIds) };
}

// Feature: maplora, Property 22: Clipboard snapshots preserve complete subtrees.
it("Property 22: round-trips independent complete styled Unicode subtrees (100 cases)", () => {
  fc.assert(
    fc.property(styledMap, (map) => {
      const before = structuredClone(map);
      const payload = decodeSubtree(encodeSubtree(map.root));
      expect(payload.kind).toBe("subtree");
      if (payload.kind !== "subtree") throw new Error("Missing subtree");
      expect(payload.root).toEqual(map.root);
      expect(Object.keys(JSON.parse(encodeSubtree(map.root))).sort()).toEqual([
        "root",
        "type",
        "version",
      ]);
      allNodes(payload.root).forEach((node, index) => {
        expect(node).not.toBe(allNodes(map.root)[index]);
        expect(node.children).not.toBe(allNodes(map.root)[index].children);
      });
      payload.root.text = "Changed copy";
      expect(map).toEqual(before);
      expect(snapshotSubtree(map.root)).toEqual(map.root);
    }),
    { numRuns: 100 },
  );
});

// Feature: maplora, Property 23: Paste creates a disjoint, ordered subtree.
it("Property 23: repeated paste creates fresh independent trees and preserves metadata (100 cases)", () => {
  fc.assert(
    fc.property(
      styledMap,
      styledMap,
      fc.nat(),
      (source, destination, choice) => {
        const before = structuredClone(source);
        const parent = allNodes(destination.root)[
          choice % allNodes(destination.root).length
        ];
        const first = remapSubtree(source.root, destination.root);
        const pasted = applyOperation(destination, {
          kind: "paste",
          parentId: parent.id,
          subtree: first,
        });
        const second = remapSubtree(source.root, pasted.root);
        const twice = applyOperation(pasted, {
          kind: "paste",
          parentId: parent.id,
          subtree: second,
        });
        const target = findNode(twice.root, parent.id)!;
        expect(target.children.slice(-2)).toEqual([first, second]);
        expect(target.children.slice(0, -2)).toEqual(parent.children);
        expect(target.collapsed).toBe(false);
        for (const inserted of [first, second])
          expect(withoutIds(inserted)).toEqual(withoutIds(source.root));
        const originalIds = new Set(
          [...allNodes(source.root), ...allNodes(destination.root)].map(
            (n) => n.id,
          ),
        );
        const fresh = [...allNodes(first), ...allNodes(second)].map(
          (n) => n.id,
        );
        expect(new Set(fresh).size).toBe(fresh.length);
        fresh.forEach((id) => {
          UUIDSchema.parse(id);
          expect(originalIds.has(id)).toBe(false);
        });
        expect(allNodes(twice.root)).toHaveLength(
          allNodes(destination.root).length + 2 * allNodes(source.root).length,
        );
        expect({ ...twice, root: destination.root }).toEqual(destination);
        MapFileSchema.parse(twice);
        target.children.at(-1)!.text = "Independent";
        expect(source).toEqual(before);
        expect(first.text).toBe(source.root.text);
        expect(second.text).toBe(source.root.text);
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: maplora, Property 24: Cut removes exactly the captured non-root subtree.
it("Property 24: cut removes only the captured tree in one save/history entry (100 cases)", async () => {
  await fc.assert(
    fc.asyncProperty(styledMap, async (generated) => {
      const initial = tree();
      initial.root.children[1] = generated.root;
      const { store, service, disk } = await setup(initial);
      const captured = snapshotSubtree(generated.root);
      const clipboard = encodeSubtree(captured);
      store.getState().select(captured.id);
      expect(await store.getState().cutSubtree(captured.id, captured)).toBe(
        true,
      );
      expect(disk().root).toEqual({
        ...initial.root,
        children: [initial.root.children[0], initial.root.children[2]],
      });
      expect(store.getState().selectedNodeId).toBe(initial.root.id);
      expect(service.saveMap).toHaveBeenCalledTimes(1);
      expect(store.getState().undoStack).toHaveLength(1);
      expect(encodeSubtree(captured)).toBe(clipboard);
      expect(await store.getState().undo()).toBe(true);
      expect(disk().root).toEqual(initial.root);
      expect(encodeSubtree(captured)).toBe(clipboard);
      expect(await store.getState().redo()).toBe(true);
      expect(findNode(disk().root, captured.id)).toBeUndefined();
    }),
    { numRuns: 100 },
  );
});

// Feature: maplora, Property 25: Undo/redo and rollback preserve atomic transfers.
it("Property 25: paste rollback/retry and undo/redo retain exact IDs, ordering and collapse (100 cases)", async () => {
  await fc.assert(
    fc.asyncProperty(styledMap, fc.boolean(), async (source, fail) => {
      const initial = tree(),
        parent = initial.root.children[1];
      const { store, service, disk } = await setup(initial);
      const clipboard = encodeSubtree(source.root);
      const inserted = remapSubtree(source.root, initial.root);
      store.getState().select(parent.id);
      if (fail) service.saveMap.mockRejectedValueOnce(new Error("Disk full"));
      expect(await store.getState().pasteSubtree(parent.id, inserted)).toBe(
        !fail,
      );
      if (fail) {
        expect(store.getState().map!.root).toEqual(initial.root);
        expect(store.getState().undoStack).toEqual([]);
        expect(await store.getState().saveMap()).toBe(true);
      }
      const pasted = structuredClone(disk().root);
      expect(findNode(pasted, parent.id)!.children.at(-1)).toEqual(inserted);
      expect(store.getState().undoStack).toHaveLength(1);
      expect(await store.getState().undo()).toBe(true);
      expect(disk().root).toEqual(initial.root);
      expect(await store.getState().redo()).toBe(true);
      expect(disk().root).toEqual(pasted);
      expect(encodeSubtree(source.root)).toBe(clipboard);
      expect(store.getState().redoStack).toEqual([]);
      expect(store.getState().undoStack).toHaveLength(1);
    }),
    { numRuns: 100 },
  );
});

it.each([
  "ordinary text",
  "# Markdown\n- child",
  JSON.stringify(fixture()),
  "[1,2,3]",
  "null",
])("leaves unrelated content alone: %s", (text) => {
  expect(decodeSubtree(text)).toEqual({ kind: "unrelated" });
});
it.each([
  '{"type":"maplora/subtree",',
  JSON.stringify({ type: "maplora/subtree", version: 2, root: fixture().root }),
  JSON.stringify({ type: "maplora/subtree", version: 1 }),
  JSON.stringify({
    type: "maplora/subtree",
    version: 1,
    root: { ...fixture().root, text: " " },
  }),
  JSON.stringify({
    type: "maplora/subtree",
    version: 1,
    root: { ...fixture().root, style: { connectorWidth: 9 } },
  }),
  JSON.stringify({
    type: "maplora/subtree",
    version: 1,
    root: { ...fixture().root, children: [fixture().root] },
  }),
  JSON.stringify({
    type: "maplora/subtree",
    version: 1,
    root: fixture().root,
    title: "Unexpected metadata",
  }),
])("rejects malformed or unsupported recognized envelopes: %s", (text) => {
  expect(decodeSubtree(text).kind).toBe("invalid");
});
it("skips source, destination and newly allocated ID collisions and fails boundedly", () => {
  const map = tree(),
    source = map.root.children[0];
  const ids = [
    source.id,
    map.root.id,
    node(80).id,
    node(80).id,
    node(81).id,
    node(81).id,
    node(82).id,
  ];
  const allocate = vi.fn(() => ids.shift()!);
  expect(
    allNodes(remapSubtree(source, map.root, allocate)).map((n) => n.id),
  ).toEqual([node(80).id, node(81).id, node(82).id]);
  expect(() => remapSubtree(source, map.root, () => map.root.id)).toThrow(
    "unique node ID",
  );
});
it("compares captured content independently of JSON field/style property order", () => {
  const a = tree().root.children[0];
  const b = {
    children: a.children,
    style: { connectorWidth: 4, connectorStyle: "dashed" as const },
    collapsed: a.collapsed,
    text: a.text,
    id: a.id,
  };
  expect(sameSubtree(a, b)).toBe(true);
});
it("rejects root cut, changed capture and invalid paste before changing selection or history", async () => {
  const { store, service } = await setup();
  const initial = store.getState();
  await expect(
    initial.cutSubtree(initial.map!.root.id, initial.map!.root),
  ).rejects.toThrow("root");
  const source = initial.map!.root.children[0];
  store.getState().select(source.id);
  await expect(
    store
      .getState()
      .cutSubtree(source.id, { ...source, text: "Uncaptured change" }),
  ).rejects.toThrow("changed");
  store.getState().select(initial.map!.root.id);
  await expect(
    store.getState().pasteSubtree(initial.map!.root.id, source),
  ).rejects.toThrow("already exists");
  expect(service.saveMap).not.toHaveBeenCalled();
  expect(store.getState().map).toEqual(initial.map);
  expect(store.getState().undoStack).toEqual([]);
});
it("rolls back failed cut and retains a usable captured copy and exact retry", async () => {
  const { store, service, disk } = await setup();
  const initial = structuredClone(disk()),
    source = initial.root.children[0];
  const text = encodeSubtree(source);
  service.saveMap.mockRejectedValueOnce(new Error("Read-only disk"));
  store.getState().select(source.id);
  expect(await store.getState().cutSubtree(source.id, source)).toBe(false);
  expect(store.getState().map).toEqual(initial);
  expect(store.getState().undoStack).toEqual([]);
  expect(store.getState().error).toMatch(
    /removal failed; the clipboard remains usable as a copy/,
  );
  const captured = decodeSubtree(text);
  expect(captured.kind).toBe("subtree");
  expect(await store.getState().saveMap()).toBe(true);
  expect(findNode(disk().root, source.id)).toBeUndefined();
  expect(store.getState().undoStack).toHaveLength(1);
});
it.each(["cut", "paste"] as const)(
  "rebases %s once on 409 preserving unrelated changes and IDs",
  async (kind) => {
    const { store, service, disk, remote } = await setup();
    const initial = structuredClone(disk()),
      source = initial.root.children[0];
    const inserted = remapSubtree(source, initial.root);
    const latest = structuredClone(initial);
    latest.title = "Remote title";
    latest.tags = ["remote"];
    latest.revision++;
    latest.root.children.push(node(90));
    service.saveMap.mockImplementationOnce(async () => {
      remote(latest);
      throw new ApiError(409, "STALE_REVISION", "Conflict");
    });
    store.getState().select(kind === "cut" ? source.id : initial.root.id);
    const success =
      kind === "cut"
        ? await store.getState().cutSubtree(source.id, source)
        : await store.getState().pasteSubtree(initial.root.id, inserted);
    expect(success).toBe(true);
    expect(disk().title).toBe("Remote title");
    expect(disk().tags).toEqual(["remote"]);
    expect(findNode(disk().root, node(90).id)).toBeDefined();
    if (kind === "paste") {
      expect(disk().root.children.at(-1)).toEqual(inserted);
      expect(service.saveMap.mock.calls[0][0].root.children.at(-1)).toEqual(
        inserted,
      );
    } else expect(findNode(disk().root, source.id)).toBeUndefined();
    expect(service.saveMap).toHaveBeenCalledTimes(2);
    expect(store.getState().undoStack).toHaveLength(1);
    await store.getState().undo();
    expect(disk().root).toEqual(latest.root);
  },
);
it.each([
  "source removed",
  "source text",
  "source hidden child",
  "source style",
  "source order",
  "destination removed",
  "ID collision",
])("rejects unsafe 409 reapplication: %s", async (change) => {
  const { store, service, disk, remote } = await setup();
  const initial = structuredClone(disk()),
    source = initial.root.children[0],
    parent = initial.root.children[1];
  const inserted = remapSubtree(source, initial.root);
  const latest = structuredClone(initial);
  latest.revision++;
  switch (change) {
    case "source removed":
      latest.root.children.shift();
      break;
    case "source text":
      latest.root.children[0].text += " remote";
      break;
    case "source hidden child":
      latest.root.children[0].children[0].text += " remote";
      break;
    case "source style":
      latest.root.children[0].style = { textColor: "red" };
      break;
    case "source order":
      latest.root.children[0].children.unshift(node(95));
      break;
    case "destination removed":
      latest.root.children.splice(1, 1);
      break;
    case "ID collision":
      latest.root.children.push({ ...node(95), id: inserted.children[0].id });
      break;
  }
  const paste = change === "destination removed" || change === "ID collision";
  service.saveMap.mockImplementationOnce(async () => {
    remote(latest);
    throw new ApiError(409, "STALE_REVISION", "Conflict");
  });
  store.getState().select(paste ? parent.id : source.id);
  expect(
    paste
      ? await store.getState().pasteSubtree(parent.id, inserted)
      : await store.getState().cutSubtree(source.id, source),
  ).toBe(false);
  expect(store.getState().map).toEqual(latest);
  expect(store.getState().undoStack).toEqual([]);
  expect(service.saveMap).toHaveBeenCalledTimes(1);
  expect(await store.getState().saveMap()).toBe(false);
  expect(service.saveMap).toHaveBeenCalledTimes(1);
});
it.each(["cut", "paste"] as const)(
  "does not mutate another map after a late %s response",
  async (kind) => {
    const { store, service, disk, remote } = await setup();
    const initial = structuredClone(disk()),
      source = initial.root.children[0];
    let release!: (map: MapFile) => void;
    service.saveMap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    store.getState().select(kind === "cut" ? source.id : initial.root.id);
    const pending =
      kind === "cut"
        ? store.getState().cutSubtree(source.id, source)
        : store
            .getState()
            .pasteSubtree(initial.root.id, remapSubtree(source, initial.root));
    const other = fixture();
    other.id = node(99).id;
    remote(other);
    await store.getState().loadMap(other.id);
    const after = store.getState();
    release(initial);
    expect(await pending).toBe(false);
    await Promise.resolve();
    expect(store.getState()).toBe(after);
    expect(store.getState().undoStack).toEqual([]);
  },
);
it.each([
  "saving",
  "error",
  "loading",
  "gone",
  "draft",
  "editing",
  "missing selection",
])("blocks store clipboard actions while %s", async (guard) => {
  const { store, service, disk } = await setup();
  const source = disk().root.children[0];
  store.getState().select(source.id);
  store.setState(
    guard === "saving"
      ? { saving: "saving" }
      : guard === "error"
        ? { error: "Failed pending operation", saving: "error" }
        : guard === "loading"
          ? { loading: true }
          : guard === "gone"
            ? { gone: true }
            : guard === "draft"
              ? { draft: { id: node(90).id, parentId: source.id } }
              : guard === "editing"
                ? { editingNodeId: source.id }
                : { selectedNodeId: null },
  );
  expect(await store.getState().cutSubtree(source.id, source)).toBe(false);
  expect(
    await store
      .getState()
      .pasteSubtree(source.id, remapSubtree(source, disk().root)),
  ).toBe(false);
  expect(service.saveMap).not.toHaveBeenCalled();
});
it("keeps cross-map cut/paste and histories independent", async () => {
  const { store, service, disk, remote } = await setup();
  const source = structuredClone(disk().root.children[0]);
  store.getState().select(source.id);
  await store.getState().cutSubtree(source.id, source);
  const savedSource = structuredClone(disk());
  const other = fixture();
  other.id = node(99).id;
  remote(other);
  await store.getState().loadMap(other.id);
  expect(store.getState().undoStack).toEqual([]);
  const inserted = remapSubtree(source, other.root);
  await store.getState().pasteSubtree(other.root.id, inserted);
  expect(service.saveMap).toHaveBeenCalledTimes(2);
  await store.getState().undo();
  expect(disk().root).toEqual(other.root);
  expect(findNode(savedSource.root, source.id)).toBeUndefined();
});

it("retains redo on rejected transfers and copies, but clears it on a successful paste", async () => {
  const { store, service, disk } = await setup();
  const original = structuredClone(disk());
  const source = original.root.children[0];
  store.getState().select(source.id);
  await store.getState().cutSubtree(source.id, source);
  await store.getState().undo();
  const before = store.getState();
  expect(before.redoStack).toHaveLength(1);
  expect(decodeSubtree(encodeSubtree(source)).kind).toBe("subtree");
  expect(store.getState()).toBe(before);
  store.getState().select(original.root.id);
  await expect(
    store.getState().pasteSubtree(original.root.id, source),
  ).rejects.toThrow("already exists");
  expect(store.getState().redoStack).toBe(before.redoStack);
  expect(service.saveMap).toHaveBeenCalledTimes(2);
  await store
    .getState()
    .pasteSubtree(original.root.id, remapSubtree(source, original.root));
  expect(store.getState().redoStack).toEqual([]);
});

it.each(["cut", "paste"] as const)(
  "retries %s at most once if the server returns a second 409",
  async (kind) => {
    const { store, service, disk } = await setup();
    const initial = structuredClone(disk()),
      source = initial.root.children[0];
    service.saveMap.mockRejectedValue(
      new ApiError(409, "STALE_REVISION", "Still conflicting"),
    );
    store.getState().select(kind === "cut" ? source.id : initial.root.id);
    expect(
      kind === "cut"
        ? await store.getState().cutSubtree(source.id, source)
        : await store
            .getState()
            .pasteSubtree(initial.root.id, remapSubtree(source, initial.root)),
    ).toBe(false);
    expect(service.saveMap).toHaveBeenCalledTimes(2);
    expect(store.getState().map!.root).toEqual(initial.root);
    expect(store.getState().undoStack).toEqual([]);
    expect(store.getState().error).toContain("Still conflicting");
  },
);
