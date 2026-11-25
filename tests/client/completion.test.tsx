import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import fc from "fast-check";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { branchCompletion } from "../../src/shared/completion";
import { MapFileSchema, type MapFile } from "../../src/shared/schema";
import { allNodes, findNode } from "../../src/shared/tree";
import {
  applyOperation,
  createEditorStore,
  useEditorStore,
} from "../../src/client/stores/editorStore";
import {
  encodeSubtree,
  decodeSubtree,
  remapSubtree,
  sameSubtree,
} from "../../src/client/subtreeClipboard";
import { mapToMarkdown } from "../../src/client/markdownExport";
import { pngGraph, expandedPngMap } from "../../src/client/pngExport";
import { NodeContextMenu } from "../../src/client/components/NodeContextMenu";
import { ApiError } from "../../src/client/api";
import { fixture, mapArb } from "../fixtures";

function setup(map = fixture()) {
  let disk = structuredClone(map);
  const service = {
    fetchMap: vi.fn(async () => structuredClone(disk)),
    saveMap: vi.fn(async (next: MapFile) => {
      disk = structuredClone({ ...next, revision: disk.revision + 1 });
      return structuredClone(disk);
    }),
  };
  return { service, store: createEditorStore(service), disk: () => disk };
}
function nested() {
  const map = fixture();
  map.root.children = [1, 2].map((n) => ({
    ...structuredClone(map.root),
    id: `12345678-1234-4234-8234-${String(20 + n).padStart(12, "0")}`,
    text: `Branch ${n}`,
  }));
  return map;
}
afterEach(() => vi.restoreAllMocks());

// Feature: maplora, Property 26: effective completion follows explicit ancestors.
it("derives completion without changing flags, including independently completed children", () => {
  fc.assert(
    fc.property(mapArb, (map) => {
      const before = structuredClone(map);
      const states = branchCompletion(map.root);
      const visit = (node: typeof map.root, inherited = false) => {
        expect(states.get(node.id)?.effective).toBe(
          inherited || !!node.completed,
        );
        node.children.forEach((child) =>
          visit(child, inherited || !!node.completed),
        );
      };
      visit(map.root);
      expect(map).toEqual(before);
      const complete = applyOperation(map, {
        kind: "completion",
        id: map.root.id,
        completed: true,
      });
      expect(
        [...branchCompletion(complete.root).values()].every((s) => s.effective),
      ).toBe(true);
      expect(map).toEqual(before);
      if (complete.root.children.length) {
        expect(() =>
          applyOperation(complete, {
            kind: "completion",
            id: map.root.id,
            completed: false,
          }),
        ).toThrow("Reopen a descendant");
      } else {
        expect(
          applyOperation(complete, {
            kind: "completion",
            id: map.root.id,
            completed: false,
          }).root.completed,
        ).toBeUndefined();
      }
    }),
    { numRuns: 100 },
  );
});
// Feature: maplora, Property 27: one mutation/history entry, stable tree and rollback.
it("persists completion with one undo/redo and no writes for unchanged settings", async () => {
  await fc.assert(
    fc.asyncProperty(mapArb, async (map) => {
      const { store, service } = setup(map);
      await store.getState().loadMap(map.id);
      const leaf = allNodes(map.root).find((n) => !n.children.length)!;
      const value = !branchCompletion(map.root).get(leaf.id)!.effective;
      await store.getState().setNodeCompleted(leaf.id, value);
      const result = structuredClone(store.getState().map!.root);
      expect(!!findNode(result, leaf.id)!.completed).toBe(value);
      const structure = (root: typeof map.root) =>
        JSON.stringify(root, (key, value) =>
          key === "completed" ? undefined : value,
        );
      expect(structure(result)).toBe(structure(map.root));
      expect(store.getState().undoStack).toHaveLength(1);
      expect(await store.getState().setNodeCompleted(leaf.id, value)).toBe(
        false,
      );
      expect(service.saveMap).toHaveBeenCalledTimes(1);
      await store.getState().undo();
      expect(store.getState().map!.root).toEqual(map.root);
      await store.getState().redo();
      expect(store.getState().map!.root).toEqual(result);
    }),
    { numRuns: 100 },
  );
});
// Feature: maplora, Property 28: transfers preserve explicit flags only.
it("round trips and remaps explicit flags without inherited state", () => {
  fc.assert(
    fc.property(mapArb, (map) => {
      const decoded = decodeSubtree(encodeSubtree(map.root));
      expect(decoded.kind).toBe("subtree");
      if (decoded.kind !== "subtree") throw Error("decode failed");
      expect(decoded.root).toEqual(map.root);
      const copy = remapSubtree(decoded.root, map.root);
      expect(allNodes(copy).map((n) => n.completed)).toEqual(
        allNodes(map.root).map((n) => n.completed),
      );
      expect(
        allNodes(copy).every(
          (n) => !allNodes(map.root).some((old) => old.id === n.id),
        ),
      ).toBe(true);
      expect(MapFileSchema.parse(JSON.parse(JSON.stringify(map)))).toEqual(map);
    }),
    { numRuns: 100 },
  );
});
it("accepts old maps unchanged and rejects false and non-boolean stored flags", () => {
  expect(MapFileSchema.parse(fixture()).root).not.toHaveProperty("completed");
  for (const value of [false, 1, "true", null]) {
    const map = fixture();
    Object.assign(map.root, { completed: value });
    expect(MapFileSchema.safeParse(map).success).toBe(false);
  }
});
it("rolls back a failed save and retries while retaining one history entry", async () => {
  const { store, service } = setup();
  await store.getState().loadMap(fixture().id);
  service.saveMap.mockRejectedValueOnce(Error("offline"));
  expect(await store.getState().setNodeCompleted(fixture().root.id, true)).toBe(
    false,
  );
  expect(store.getState().map!.root.completed).toBeUndefined();
  expect(store.getState().undoStack).toHaveLength(0);
  await store.getState().saveMap();
  expect(store.getState().map!.root.completed).toBe(true);
  expect(store.getState().undoStack).toHaveLength(1);
});
it("rebases only completion on conflict and fails if its target disappeared", async () => {
  const map = nested();
  const { store, service } = setup(map);
  await store.getState().loadMap(map.id);
  const latest = structuredClone(map);
  latest.root.text = "Remote edit";
  service.saveMap.mockRejectedValueOnce(new ApiError(409, "CONFLICT", "stale"));
  service.fetchMap.mockResolvedValueOnce(latest);
  await store.getState().setNodeCompleted(map.root.children[0].id, true);
  expect(store.getState().map!.root.text).toBe("Remote edit");
  service.saveMap.mockRejectedValueOnce(new ApiError(409, "CONFLICT", "stale"));
  service.fetchMap.mockResolvedValueOnce(fixture());
  expect(
    await store.getState().setNodeCompleted(map.root.children[0].id, false),
  ).toBe(false);
  expect(store.getState().error).toContain("no longer exists");
});
it("excludes inherited completion when copying a child and protects stale cuts", () => {
  const map = nested();
  map.root.completed = true;
  const child = map.root.children[0];
  expect(branchCompletion(map.root).get(child.id)?.effective).toBe(true);
  const copied = remapSubtree(child, fixture().root);
  expect(branchCompletion(copied).get(copied.id)?.effective).toBe(false);
  const changed = structuredClone(child);
  changed.completed = true;
  expect(sameSubtree(child, changed)).toBe(false);
  expect(() =>
    applyOperation(
      { ...map, root: { ...map.root, children: [changed] } },
      { kind: "cut", id: child.id, expectedSubtree: child },
    ),
  ).toThrow("changed after capture");
});
it("renders effective completion consistently in PNG and Markdown", () => {
  const map = nested();
  map.root.completed = true;
  map.root.children[1].completed = true;
  const graph = pngGraph(
    expandedPngMap(map),
    new Map(allNodes(map.root).map((n) => [n.id, { width: 200, height: 60 }])),
  );
  expect(graph.nodes.every((n) => n.data.completed)).toBe(true);
  expect(graph.edges.every((e) => e.data?.completed)).toBe(true);
  expect(mapToMarkdown(map)).toBe(
    "# Garden of ideas ✓\n- Branch 1 ✓\n- Branch 2 ✓",
  );
});
it("autosaves the checkbox while retaining focus, panel and unapplied styles", async () => {
  const map = nested();
  const original = useEditorStore.getState();
  const save = vi.fn(async (id: string, value: boolean) => {
    const next = applyOperation(useEditorStore.getState().map!, {
      kind: "completion",
      id,
      completed: value,
    });
    useEditorStore.setState({ map: next });
    return true;
  });
  const close = vi.fn();
  useEditorStore.setState({
    map,
    setNodeCompleted: save,
    saving: "idle",
    error: null,
    loading: false,
  });
  function Panel() {
    const state = useEditorStore();
    return (
      <NodeContextMenu
        node={state.map!.root.children[0]}
        root={false}
        depth={1}
        onClose={close}
      />
    );
  }
  try {
    const view = render(<Panel />);
    const checkbox = screen.getByRole("checkbox", {
      name: "Mark branch as done",
    });
    expect(checkbox).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("Background color"), {
      target: { value: "#ff0066" },
    });
    checkbox.focus();
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(checkbox).toHaveFocus();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Background color")).toHaveValue("#ff0066");
    fireEvent.click(
      screen.getByRole("button", { name: "Restore theme defaults" }),
    );
    expect(checkbox).toBeChecked();
    expect(save).toHaveBeenCalledTimes(1);
    view.unmount();
  } finally {
    useEditorStore.setState(original);
  }
});
it("keeps new children unmarked and recomputes completion when branches move", async () => {
  const map = nested();
  map.root.children[0].completed = true;
  const { store } = setup(map);
  await store.getState().loadMap(map.id);
  const parent = map.root.children[0].id;
  store.getState().addNode(parent);
  const child = store.getState().draft!.id;
  await store.getState().editNodeText(child, "New task");
  expect(findNode(store.getState().map!.root, child)).not.toHaveProperty(
    "completed",
  );
  expect(
    branchCompletion(store.getState().map!.root).get(child)?.effective,
  ).toBe(false);
  await store.getState().moveNode(child, map.root.id, 2);
  expect(
    branchCompletion(store.getState().map!.root).get(child)?.effective,
  ).toBe(false);
  expect(
    findNode(store.getState().map!.root, parent)?.completed,
  ).toBeUndefined();
});
it("blocks duplicate changes while saving and ignores late results after map navigation", async () => {
  const { store, service } = setup();
  await store.getState().loadMap(fixture().id);
  let finish!: (map: MapFile) => void;
  service.saveMap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = store.getState().setNodeCompleted(fixture().root.id, true);
  expect(
    await store.getState().setNodeCompleted(fixture().root.id, false),
  ).toBe(false);
  const other = { ...fixture(), id: "12345678-1234-4234-8234-000000000099" };
  service.fetchMap.mockResolvedValueOnce(other);
  await store.getState().loadMap(other.id);
  finish({ ...fixture(), root: { ...fixture().root, completed: true } });
  await pending;
  expect(store.getState().map).toEqual(other);
  expect(store.getState().undoStack).toHaveLength(0);
});

it("keeps completed default text legible against every theme node background", () => {
  const css = readFileSync("src/client/styles.css", "utf8");
  const backgrounds = [...css.matchAll(/--completed-bg:\s*(#[0-9a-f]+)/g)].map(
    (m) => m[1],
  );
  const foregrounds = [
    ...css.matchAll(/--completed-text:\s*(#[0-9a-f]+)/g),
  ].map((m) => m[1]);
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  expect(backgrounds).toHaveLength(2);
  for (const [i, bg] of backgrounds.entries()) {
    const a = luminance(bg),
      b = luminance(foregrounds[i]);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  }
});
it("allows a leaf covered by a legacy completed ancestor to be reopened", () => {
  const map = nested();
  map.root.completed = true;
  const original = useEditorStore.getState();
  const save = vi.fn();
  useEditorStore.setState({
    map,
    setNodeCompleted: save,
    saving: "idle",
    error: null,
    loading: false,
  });
  const view = render(
    <NodeContextMenu
      node={map.root.children[0]}
      root={false}
      depth={1}
      onClose={() => {}}
    />,
  );
  try {
    const checkbox = screen.getByRole("checkbox", {
      name: "Mark branch as done",
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(checkbox);
    expect(save).toHaveBeenCalledWith(map.root.children[0].id, false);
    expect(map.root.children[0]).not.toHaveProperty("completed");
  } finally {
    view.unmount();
    useEditorStore.setState(original);
  }
});
