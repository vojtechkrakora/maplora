import { expect, it, vi } from "vitest";
import fc from "fast-check";
import { render, screen } from "@testing-library/react";
import { branchCompletion } from "../../src/shared/completion";
import { allNodes } from "../../src/shared/tree";
import type { MapNode, MapFile } from "../../src/shared/schema";
import {
  createEditorStore,
  applyOperation,
} from "../../src/client/stores/editorStore";
import { CompletionProgress } from "../../src/client/components/CompletionProgress";
import { pngGraph, expandedPngMap } from "../../src/client/pngExport";
import { ApiError } from "../../src/client/api";
import { fixture, mapArb } from "../fixtures";
function leaf(n: number, done = false): MapNode {
  return {
    id: `12345678-1234-4234-8234-${String(n).padStart(12, "0")}`,
    text: `Task ${n}`,
    collapsed: false,
    children: [],
    ...(done ? { completed: true as const } : {}),
  };
}
function mapWithChildren(children: MapNode[]) {
  const map = fixture();
  map.root.children = children;
  return map;
}
async function setup(map: MapFile) {
  const service = {
    fetchMap: vi.fn(async () => structuredClone(map)),
    saveMap: vi.fn(async (next: MapFile) => ({
      ...structuredClone(next),
      revision: next.revision + 1,
    })),
  };
  const store = createEditorStore(service);
  await store.getState().loadMap(map.id);
  return { store, service };
}
it("automatically completes parents and rejects manual reopening without another write", async () => {
  const map = mapWithChildren([leaf(21, true), leaf(22)]);
  const { store, service } = await setup(map);
  await store.getState().setNodeCompleted(map.root.children[1].id, true);
  expect(
    branchCompletion(store.getState().map!.root).get(map.root.id)?.effective,
  ).toBe(true);
  expect(await store.getState().setNodeCompleted(map.root.id, false)).toBe(
    false,
  );
  expect(service.saveMap).toHaveBeenCalledTimes(1);
  await store.getState().setNodeCompleted(map.root.children[1].id, false);
  expect(
    branchCompletion(store.getState().map!.root).get(map.root.id),
  ).toMatchObject({ effective: false, percentage: 50 });
  expect(store.getState().map!.root.children[0].completed).toBe(true);
  await store.getState().undo();
  expect(
    branchCompletion(store.getState().map!.root).get(map.root.id)?.effective,
  ).toBe(true);
});
it("reopens a legacy completed branch through one leaf, preserving other completed descendants", async () => {
  const map = mapWithChildren([leaf(21), leaf(22)]);
  map.root.completed = true;
  const { store } = await setup(map);
  await store.getState().setNodeCompleted(map.root.children[0].id, false);
  expect(store.getState().map!.root.completed).toBeUndefined();
  expect(store.getState().map!.root.children[1].completed).toBe(true);
  expect(
    branchCompletion(store.getState().map!.root).get(map.root.id)?.percentage,
  ).toBe(50);
  await store.getState().undo();
  expect(store.getState().map!.root).toEqual(map.root);
});
it("new unfinished children reopen an automatically completed parent without reopening its siblings", async () => {
  const map = mapWithChildren([leaf(21, true), leaf(22, true)]);
  const { store } = await setup(map);
  store.getState().addNode(map.root.id);
  const id = store.getState().draft!.id;
  await store.getState().editNodeText(id, "New work");
  expect(
    branchCompletion(store.getState().map!.root).get(map.root.id),
  ).toMatchObject({
    effective: false,
    percentage: 67,
    descendants: 3,
    completedDescendants: 2,
  });
  expect(
    store
      .getState()
      .map!.root.children.slice(0, 2)
      .every((n) => n.completed),
  ).toBe(true);
});
it("counts all descendants exactly once, including completed internal nodes and collapsed grandchildren", () => {
  const branch = {
    ...leaf(21),
    collapsed: true,
    children: [leaf(22, true), leaf(23, true)],
  };
  const map = mapWithChildren([branch, leaf(24)]);
  const states = branchCompletion(map.root);
  expect(states.get(branch.id)?.effective).toBe(true);
  expect(states.get(map.root.id)).toMatchObject({
    descendants: 4,
    completedDescendants: 3,
    percentage: 75,
  });
  expect(states.get(branch.id)?.percentage).toBeUndefined();
  const graph = pngGraph(
    expandedPngMap(map),
    new Map(allNodes(map.root).map((n) => [n.id, { width: 160, height: 60 }])),
  );
  expect(graph.nodes.find((n) => n.id === map.root.id)?.data.percentage).toBe(
    75,
  );
});
it("shows no badge for leaves, zero completions or rounded 100%; supports rounded 0% when some work is done", () => {
  expect(
    branchCompletion(leaf(21, true)).get(leaf(21).id)?.percentage,
  ).toBeUndefined();
  for (const done of [false, true]) {
    const map = mapWithChildren([leaf(21, done)]);
    expect(
      branchCompletion(map.root).get(map.root.id)?.percentage,
    ).toBeUndefined();
  }
  const children = Array.from({ length: 251 }, (_, i) =>
    leaf(i + 100, i === 0),
  );
  let map = mapWithChildren(children);
  expect(branchCompletion(map.root).get(map.root.id)?.percentage).toBe(0);
  map = mapWithChildren(
    children.map((n, i) => ({
      ...n,
      ...(i > 0 ? { completed: true as const } : {}),
    })),
  );
  delete map.root.children[0].completed;
  expect(branchCompletion(map.root).get(map.root.id)).toMatchObject({
    effective: false,
    completedDescendants: 250,
    percentage: undefined,
  });
  const view = render(<CompletionProgress percentage={0} />);
  expect(
    screen.getByRole("img", { name: "0% of descendants done" }),
  ).toHaveTextContent("0%");
  view.rerender(<CompletionProgress />);
  expect(screen.queryByRole("img")).toBeNull();
});
// Property 29: descendant progress matches a separately evaluated tree oracle.
it("derives percentages and completed parents from all descendant states", () => {
  fc.assert(
    fc.property(mapArb, (map) => {
      const before = structuredClone(map);
      const expected = new Map<string, boolean>();
      const visit = (node: MapNode, covered = false): boolean => {
        const inherited = covered || !!node.completed;
        const children = node.children.map((child) => visit(child, inherited));
        const done =
          inherited || (children.length > 0 && children.every(Boolean));
        expected.set(node.id, done);
        return done;
      };
      visit(map.root);
      const states = branchCompletion(map.root);
      for (const node of allNodes(map.root)) {
        const descendants = allNodes(node).slice(1);
        const done = descendants.filter((n) => expected.get(n.id)).length;
        const rounded = done
          ? Math.round((done * 100) / descendants.length)
          : undefined;
        expect(states.get(node.id)).toEqual({
          effective: expected.get(node.id),
          descendants: descendants.length,
          completedDescendants: done,
          percentage: rounded === 100 ? undefined : rounded,
        });
      }
      expect(map).toEqual(before);
    }),
    { numRuns: 100 },
  );
});
// Property 30: reopening any covered leaf preserves every other leaf's completion.
it("reopens one descendant without losing completed siblings or tree structure", () => {
  fc.assert(
    fc.property(mapArb, (map) => {
      const completed = applyOperation(map, {
        kind: "completion",
        id: map.root.id,
        completed: true,
      });
      const leaves = allNodes(completed.root).filter((n) => !n.children.length);
      const target = leaves[0];
      const next = applyOperation(completed, {
        kind: "completion",
        id: target.id,
        completed: false,
      });
      const states = branchCompletion(next.root);
      for (const leaf of leaves)
        expect(states.get(leaf.id)?.effective).toBe(leaf.id !== target.id);
      expect(states.get(next.root.id)?.effective).toBe(false);
      expect(allNodes(next.root).map((n) => n.id)).toEqual(
        allNodes(map.root).map((n) => n.id),
      );
    }),
    { numRuns: 100 },
  );
});

it("reconciles source and destination after move, cut and paste without losing done leaves", () => {
  const doneBranch = { ...leaf(21), children: [leaf(22, true)] };
  const mixedBranch = { ...leaf(23), children: [leaf(24, true), leaf(25)] };
  const source = mapWithChildren([doneBranch, mixedBranch]);
  const moved = applyOperation(source, {
    kind: "move",
    id: leaf(25).id,
    parentId: mixedBranch.id,
    newParentId: doneBranch.id,
    beforeId: null,
  });
  let states = branchCompletion(moved.root);
  expect(states.get(doneBranch.id)).toMatchObject({
    effective: false,
    percentage: 50,
  });
  expect(states.get(mixedBranch.id)?.effective).toBe(true);
  const cut = applyOperation(moved, {
    kind: "cut",
    id: leaf(25).id,
    expectedSubtree: leaf(25),
  });
  states = branchCompletion(cut.root);
  expect(states.get(cut.root.id)?.effective).toBe(true);
  const pasted = applyOperation(cut, {
    kind: "paste",
    parentId: mixedBranch.id,
    subtree: leaf(26),
  });
  states = branchCompletion(pasted.root);
  expect(states.get(pasted.root.id)?.effective).toBe(false);
  expect(states.get(mixedBranch.id)).toMatchObject({
    effective: false,
    percentage: 50,
  });
  expect(states.get(leaf(22).id)?.effective).toBe(true);
  expect(states.get(leaf(24).id)?.effective).toBe(true);
  expect(source.root.children[0].completed).toBeUndefined();
});
it("rolls back legacy normalization and rebases reopening against newly added remote work", async () => {
  const map = mapWithChildren([leaf(21), leaf(22)]);
  map.root.completed = true;
  const { store, service } = await setup(map);
  service.saveMap.mockRejectedValueOnce(Error("offline"));
  expect(await store.getState().setNodeCompleted(leaf(21).id, false)).toBe(
    false,
  );
  expect(store.getState().map!.root).toEqual(map.root);
  expect(store.getState().undoStack).toHaveLength(0);
  const remote = mapWithChildren([leaf(21, true), leaf(22, true), leaf(23)]);
  remote.root.text = "Remote title";
  service.saveMap.mockRejectedValueOnce(new ApiError(409, "CONFLICT", "stale"));
  service.fetchMap.mockResolvedValueOnce(remote);
  expect(await store.getState().saveMap()).toBe(true);
  expect(store.getState().map!.root.text).toBe("Remote title");
  expect(
    branchCompletion(store.getState().map!.root).get(map.root.id),
  ).toMatchObject({
    effective: false,
    percentage: 33,
    completedDescendants: 1,
    descendants: 3,
  });
  expect(store.getState().map!.root.children[1].completed).toBe(true);
  expect(store.getState().undoStack).toHaveLength(1);
});
