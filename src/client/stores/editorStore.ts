import { create } from "zustand";
import * as api from "../api";
import { newNodeId } from "../id";
import {
  NodeTextSchema,
  NodeStyleSchema,
  type MapFile,
  type MapNode,
  type NodeStyle,
} from "../../shared/schema.js";
import {
  allNodes,
  branchMoveError,
  findNode,
  findParent,
} from "../../shared/tree.js";
import { sameSubtree, snapshotSubtree } from "../subtreeClipboard";
export type NodeOperation =
  | { kind: "add"; parentId: string; node: MapNode; afterId?: string }
  | { kind: "edit"; id: string; text: string }
  | { kind: "delete"; id: string }
  | { kind: "cut"; id: string; expectedSubtree: MapNode }
  | { kind: "paste"; parentId: string; subtree: MapNode }
  | { kind: "collapse"; id: string; collapsed: boolean }
  | { kind: "style"; id: string; style: Partial<NodeStyle> }
  | { kind: "reorder"; id: string; parentId: string; beforeId: string | null }
  | {
      kind: "move";
      id: string;
      parentId: string;
      newParentId: string;
      beforeId: string | null;
    };
export function applyOperation(source: MapFile, op: NodeOperation): MapFile {
  const map = structuredClone(source);
  if (op.kind === "add") {
    const parent = findNode(map.root, op.parentId);
    if (!parent) throw new Error("The parent node no longer exists.");
    if (!findNode(map.root, op.node.id)) {
      const index = op.afterId
        ? parent.children.findIndex((n) => n.id === op.afterId) + 1
        : parent.children.length;
      parent.children.splice(index, 0, structuredClone(op.node));
      parent.collapsed = false;
    }
  } else if (op.kind === "cut") {
    if (op.id === map.root.id)
      throw new Error("The root cannot be cut. Copy it instead.");
    const node = findNode(map.root, op.id);
    const parent = findParent(map.root, op.id);
    if (!node || !parent)
      throw new Error("The captured branch no longer exists.");
    if (!sameSubtree(node, op.expectedSubtree))
      throw new Error(
        "The branch changed after capture; its newer content was kept.",
      );
    parent.children = parent.children.filter((child) => child.id !== op.id);
  } else if (op.kind === "paste") {
    const parent = findNode(map.root, op.parentId);
    if (!parent) throw new Error("The paste destination no longer exists.");
    const subtree = snapshotSubtree(op.subtree);
    const ids = new Set(
      allNodes(map.root).map((node) => node.id.toLowerCase()),
    );
    if (allNodes(subtree).some((node) => ids.has(node.id.toLowerCase())))
      throw new Error(
        "A pasted node ID already exists in this map. Paste again for fresh IDs.",
      );
    parent.children.push(subtree);
    parent.collapsed = false;
  } else if (op.kind === "delete") {
    const parent = findParent(map.root, op.id);
    if (parent) parent.children = parent.children.filter((n) => n.id !== op.id);
  } else if (op.kind === "reorder") {
    const parent = findParent(map.root, op.id);
    if (!parent || parent.id !== op.parentId)
      throw new Error("The node is no longer under its original parent.");
    const index = parent.children.findIndex((node) => node.id === op.id);
    const [node] = parent.children.splice(index, 1);
    const target =
      op.beforeId === null
        ? parent.children.length
        : parent.children.findIndex((child) => child.id === op.beforeId);
    if (target < 0) throw new Error("The target sibling no longer exists.");
    parent.children.splice(target, 0, node);
  } else if (op.kind === "move") {
    const error = branchMoveError(map.root, op.id, op.newParentId);
    if (error) throw new Error(error);
    const parent = findParent(map.root, op.id)!;
    if (parent.id !== op.parentId)
      throw new Error("The branch is no longer under its original parent.");
    const newParent = findNode(map.root, op.newParentId)!;
    const target =
      op.beforeId === null
        ? newParent.children.length
        : newParent.children.findIndex((node) => node.id === op.beforeId);
    if (target < 0) throw new Error("The target sibling no longer exists.");
    const [node] = parent.children.splice(
      parent.children.findIndex((n) => n.id === op.id),
      1,
    );
    newParent.children.splice(target, 0, node);
    newParent.collapsed = false;
  } else {
    const node = findNode(map.root, op.id);
    if (!node) throw new Error("The node no longer exists.");
    if (op.kind === "edit") {
      NodeTextSchema.parse(op.text);
      node.text = op.text;
    } else if (op.kind === "style") {
      const patch = NodeStyleSchema.parse(op.style);
      const style = { ...node.style, ...patch };
      for (const key of Object.keys(style) as (keyof NodeStyle)[])
        if (style[key] === undefined) delete style[key];
      if (Object.keys(style).length) node.style = style;
      else delete node.style;
    } else if (node !== map.root && node.children.length)
      node.collapsed = op.collapsed;
  }
  return map;
}
interface Draft {
  id: string;
  parentId: string;
  afterId?: string;
}
type QueuedOperation = NodeOperation | { kind: "undo" } | { kind: "redo" };
type History = Pick<EditorState, "undoStack" | "redoStack">;

function advance(map: MapFile, history: History, operation: QueuedOperation) {
  const { undoStack, redoStack } = history;
  if (operation.kind === "undo" || operation.kind === "redo") {
    const undo = operation.kind === "undo";
    const snapshot = (undo ? undoStack : redoStack).at(-1);
    if (!snapshot) return null;
    // History restores the tree; revisions and map metadata belong to the latest save.
    return {
      map: { ...map, root: structuredClone(snapshot.root) },
      undoStack: undo
        ? undoStack.slice(0, -1)
        : [...undoStack, structuredClone(map)].slice(-50),
      redoStack: undo
        ? [...redoStack, structuredClone(map)].slice(-50)
        : redoStack.slice(0, -1),
    };
  }
  return {
    map: applyOperation(map, operation),
    undoStack: [...undoStack, structuredClone(map)].slice(-50),
    redoStack: [],
  };
}
export interface EditorState {
  map: MapFile | null;
  selectedNodeId: string | null;
  editingNodeId: string | null;
  draft: Draft | null;
  saving: "idle" | "saving" | "error";
  error: string | null;
  notice: string | null;
  moveError: string | null;
  loading: boolean;
  gone: boolean;
  undoStack: MapFile[];
  redoStack: MapFile[];
  loadMap(id: string): Promise<void>;
  saveMap(): Promise<boolean>;
  select(id: string | null): void;
  beginEdit(id: string): void;
  cancelEdit(): void;
  addNode(parentId: string, afterId?: string): void;
  editNodeText(id: string, text: string): Promise<boolean>;
  deleteNode(id: string): Promise<boolean>;
  cutSubtree(id: string, expectedSubtree: MapNode): Promise<boolean>;
  pasteSubtree(parentId: string, subtree: MapNode): Promise<boolean>;
  toggleCollapse(id: string): Promise<boolean>;
  reorderNode(id: string, newIndex: number): Promise<boolean>;
  moveNode(id: string, newParentId: string, index: number): Promise<boolean>;
  updateNodeStyle(id: string, style: Partial<NodeStyle>): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  dismissMoveError(): void;
}
export function createEditorStore(
  service: Pick<typeof api, "fetchMap" | "saveMap"> = api,
) {
  return create<EditorState>((set, get) => {
    let base: MapFile | null = null,
      generation = 0,
      runningGeneration: number | null = null;
    let failed: QueuedOperation | null = null;
    let history: History = { undoStack: [], redoStack: [] };
    type Pending = {
      operation: QueuedOperation;
      resolve(success: boolean): void;
    };
    const pending: Pending[] = [];
    function project() {
      let map = base;
      let projectedHistory = history;
      if (map)
        for (const p of pending) {
          try {
            const next = advance(map, projectedHistory, p.operation);
            if (next) {
              map = next.map;
              projectedHistory = next;
            }
          } catch {
            /* A dependent edit may become invalid after rollback. */
          }
        }
      const { selectedNodeId, editingNodeId, draft } = get();
      const validDraft = draft && map && findNode(map.root, draft.parentId);
      const exists = (id: string | null) =>
        id &&
        map &&
        (findNode(map.root, id) || (validDraft && draft?.id === id));
      set({
        map,
        undoStack: projectedHistory.undoStack,
        redoStack: projectedHistory.redoStack,
        selectedNodeId:
          selectedNodeId && !exists(selectedNodeId)
            ? (map?.root.id ?? null)
            : selectedNodeId,
        editingNodeId: exists(editingNodeId) ? editingNodeId : null,
        draft: validDraft ? draft : null,
      });
    }
    async function pump() {
      if (runningGeneration === generation || !base) return;
      const currentGeneration = generation;
      runningGeneration = currentGeneration;
      while (pending.length && currentGeneration === generation) {
        const item = pending[0];
        set({ saving: "saving" });
        try {
          let next = advance(base!, history, item.operation);
          if (!next) {
            pending.shift();
            project();
            item.resolve(false);
            continue;
          }
          let candidate = next.map;
          let saved: MapFile;
          try {
            saved = await service.saveMap(candidate);
          } catch (error) {
            if (!(error instanceof api.ApiError) || error.status !== 409)
              throw error;
            if (currentGeneration !== generation) break;
            const latest = await service.fetchMap(candidate.id);
            if (currentGeneration !== generation) break;
            base = latest;
            next = advance(latest, history, item.operation)!;
            candidate = next.map;
            saved = await service.saveMap(candidate);
            if (currentGeneration !== generation) break;
            set({
              notice:
                "A newer revision was found. Your change was applied to it.",
            });
          }
          if (currentGeneration !== generation) break;
          history = { undoStack: next.undoStack, redoStack: next.redoStack };
          base = saved;
          pending.shift();
          project();
          item.resolve(true);
        } catch (error) {
          if (currentGeneration !== generation) break;
          pending.shift();
          project();
          const gone =
            error instanceof api.ApiError && [404, 410].includes(error.status);
          if (item.operation.kind === "move" && !gone) {
            failed = null;
            set({
              moveError: `Branch could not be moved: ${(error as Error).message}`,
              error: null,
              notice: null,
              saving: pending.length ? "saving" : "idle",
            });
          } else {
            failed = item.operation;
            set({
              error: `${item.operation.kind === "cut" ? "Branch removal failed; the clipboard remains usable as a copy" : "Change could not be saved"}: ${(error as Error).message}`,
              saving: "error",
              gone,
            });
          }
          item.resolve(false);
        }
      }
      if (currentGeneration === generation) {
        runningGeneration = null;
        if (!get().error) set({ saving: "idle" });
      }
    }
    function enqueue(operation: QueuedOperation): Promise<boolean> {
      const current = get().map;
      if (!current) return Promise.resolve(false);
      // Validate first. Replaying pending changes also projects their history, so
      // failed saves remove their snapshots without losing later valid changes.
      if (!advance(current, get(), operation)) return Promise.resolve(false);
      set({
        error: null,
        notice: null,
        moveError: null,
        saving: "saving",
      });
      failed = null;
      return new Promise((resolve) => {
        pending.push({ operation, resolve });
        project();
        if (operation.kind === "paste")
          set({ selectedNodeId: operation.subtree.id });
        if (operation.kind === "cut")
          set({ selectedNodeId: findParent(current.root, operation.id)!.id });
        void pump();
      });
    }
    return {
      map: null,
      selectedNodeId: null,
      editingNodeId: null,
      draft: null,
      saving: "idle",
      error: null,
      notice: null,
      moveError: null,
      loading: false,
      gone: false,
      undoStack: [],
      redoStack: [],
      async loadMap(id) {
        const token = ++generation;
        for (const p of pending.splice(0)) p.resolve(false);
        base = null;
        history = { undoStack: [], redoStack: [] };
        failed = null;
        runningGeneration = null;
        set({
          map: null,
          loading: true,
          selectedNodeId: null,
          editingNodeId: null,
          draft: null,
          error: null,
          notice: null,
          moveError: null,
          gone: false,
          saving: "idle",
          undoStack: [],
          redoStack: [],
        });
        try {
          const map = await service.fetchMap(id);
          if (token === generation) {
            base = map;
            set({ map, selectedNodeId: map.root.id });
          }
        } catch (error) {
          if (token === generation)
            set({
              error: `Map could not be read: ${(error as Error).message}`,
              gone:
                error instanceof api.ApiError &&
                [404, 410].includes(error.status),
            });
        } finally {
          if (token === generation) set({ loading: false });
        }
      },
      async saveMap() {
        if (failed) {
          const op = failed;
          try {
            return await enqueue(op);
          } catch (error) {
            set({
              error: `${op.kind === "cut" ? "Branch removal failed; the clipboard remains usable as a copy" : "Change could not be saved"}: ${(error as Error).message}`,
              saving: "error",
            });
            return false;
          }
        }
        return true;
      },
      async undo() {
        if (get().draft || get().editingNodeId) return false;
        return enqueue({ kind: "undo" });
      },
      async redo() {
        if (get().draft || get().editingNodeId) return false;
        return enqueue({ kind: "redo" });
      },
      select(id) {
        set({ selectedNodeId: id });
      },
      beginEdit(id) {
        if (get().draft) return;
        set({ editingNodeId: id, selectedNodeId: id });
      },
      cancelEdit() {
        const draft = get().draft;
        set({
          editingNodeId: null,
          draft: null,
          ...(draft ? { selectedNodeId: draft.parentId } : {}),
        });
      },
      addNode(parentId, afterId) {
        if (
          get().draft ||
          get().editingNodeId ||
          !get().map ||
          !findNode(get().map!.root, parentId)
        )
          return;
        const id = newNodeId();
        set({
          draft: { id, parentId, afterId },
          editingNodeId: id,
          selectedNodeId: id,
        });
      },
      async editNodeText(id, text) {
        const draft = get().draft;
        if (draft?.id === id && !text.trim()) {
          get().cancelEdit();
          return true;
        }
        NodeTextSchema.parse(text);
        if (draft?.id === id) {
          set({ draft: null, editingNodeId: null });
          return enqueue({
            kind: "add",
            parentId: draft.parentId,
            afterId: draft.afterId,
            node: { id, text, collapsed: false, children: [] },
          });
        }
        set({ editingNodeId: null });
        if (findNode(get().map!.root, id)?.text === text) return true;
        return enqueue({ kind: "edit", id, text });
      },
      async deleteNode(id) {
        const map = get().map;
        if (!map || id === map.root.id) return false;
        if (get().draft?.id === id) {
          get().cancelEdit();
          return true;
        }
        const parent = findParent(map.root, id);
        if (!parent) return false;
        set({ selectedNodeId: parent.id });
        return enqueue({ kind: "delete", id });
      },
      async cutSubtree(id, expectedSubtree) {
        const s = get();
        if (
          !s.map ||
          s.loading ||
          s.gone ||
          s.saving !== "idle" ||
          s.error ||
          s.draft ||
          s.editingNodeId ||
          s.selectedNodeId !== id
        )
          return false;
        const operation: NodeOperation = {
          kind: "cut",
          id,
          expectedSubtree: snapshotSubtree(expectedSubtree),
        };
        applyOperation(s.map, operation);
        return enqueue(operation);
      },
      async pasteSubtree(parentId, subtree) {
        const s = get();
        if (
          !s.map ||
          s.loading ||
          s.gone ||
          s.saving !== "idle" ||
          s.error ||
          s.draft ||
          s.editingNodeId ||
          s.selectedNodeId !== parentId
        )
          return false;
        const operation: NodeOperation = {
          kind: "paste",
          parentId,
          subtree: snapshotSubtree(subtree),
        };
        applyOperation(s.map, operation);
        return enqueue(operation);
      },
      async toggleCollapse(id) {
        const map = get().map,
          node = map && findNode(map.root, id);
        if (!node || id === map!.root.id || !node.children.length) return false;
        return enqueue({ kind: "collapse", id, collapsed: !node.collapsed });
      },
      async reorderNode(id, newIndex) {
        const { map, draft, editingNodeId } = get();
        if (!map || draft || editingNodeId || !Number.isInteger(newIndex))
          return false;
        const parent = findParent(map.root, id);
        if (!parent || newIndex < 0 || newIndex >= parent.children.length)
          return false;
        const oldIndex = parent.children.findIndex((node) => node.id === id);
        if (oldIndex === newIndex) return false;
        // Use a stable sibling anchor so a 409 retry preserves remote additions.
        const siblings = parent.children.filter((node) => node.id !== id);
        return enqueue({
          kind: "reorder",
          id,
          parentId: parent.id,
          beforeId: siblings[newIndex]?.id ?? null,
        });
      },
      async moveNode(id, newParentId, index) {
        const { map, draft, editingNodeId } = get();
        if (
          !map ||
          draft ||
          editingNodeId ||
          !Number.isInteger(index) ||
          branchMoveError(map.root, id, newParentId)
        )
          return false;
        const parent = findParent(map.root, id)!;
        const newParent = findNode(map.root, newParentId)!;
        if (index < 0 || index > newParent.children.length) return false;
        return enqueue({
          kind: "move",
          id,
          parentId: parent.id,
          newParentId,
          beforeId: newParent.children[index]?.id ?? null,
        });
      },
      dismissMoveError() {
        set({ moveError: null });
      },
      async updateNodeStyle(id, style) {
        const { map, draft, editingNodeId } = get();
        const node = map && findNode(map.root, id);
        if (!node || draft || editingNodeId) return false;
        const patch = NodeStyleSchema.parse(style);
        const keys = Object.keys(patch) as (keyof NodeStyle)[];
        if (!keys.some((key) => node.style?.[key] !== patch[key])) return false;
        return enqueue({ kind: "style", id, style: structuredClone(patch) });
      },
    };
  });
}
export const useEditorStore = createEditorStore();
