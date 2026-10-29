import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnNodeDrag,
} from "@xyflow/react";
import type { MapFile, MapNode } from "../../shared/schema.js";
import { allNodes, findParent } from "../../shared/tree.js";
import { useEditorStore } from "../stores/editorStore";
import {
  clampZoom,
  computeLayout,
  DEFAULT_SIZE,
  type Point,
  type Size,
} from "../layout";
import { branchDropTarget, type BranchDropTarget } from "../reorder";
import { Link } from "react-router-dom";
import { handleEditorKey } from "../keyboard";
import { Dialog } from "./Dialog";
import { NodeContextMenu } from "./NodeContextMenu";
import { nodeAppearance } from "../nodeStyle";
import { ThemeToggle } from "./ThemeToggle";
import { useThemeStore } from "../stores/themeStore";
import { CopyMarkdownButton } from "./CopyMarkdownButton";
import { ExportJsonButton } from "./ExportJsonButton";
import { ExportPngButton } from "./ExportPngButton";
import { MindMapEdge } from "./MindMapEdge";
export { MindMapEdge } from "./MindMapEdge";

type MindNode = Node<
  {
    node: MapNode;
    root: boolean;
    depth: number;
    side: "left" | "right";
    remove(id: string): void;
  },
  "mindmap"
>;
export function MindMapNode({ data, selected }: NodeProps<MindNode>) {
  const s = useEditorStore(),
    { node, root, side, depth } = data;
  const editing = s.editingNodeId === node.id;
  const [text, setText] = useState(node.text),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    finishing = useRef(false);
  useEffect(() => {
    if (editing) {
      setText(s.draft?.id === node.id ? "" : node.text);
      setError("");
      finishing.current = false;
      input.current?.focus();
      input.current?.select();
    }
  }, [editing, node.id]);
  const commit = async () => {
    if (finishing.current) return;
    if ((!text.trim() || text.length > 200) && s.draft?.id !== node.id) {
      setError("Enter 1–200 characters.");
      input.current?.focus();
      return;
    }
    if (text.length > 200) {
      setError("Use at most 200 characters.");
      input.current?.focus();
      return;
    }
    finishing.current = true;
    try {
      await s.editNodeText(node.id, text);
    } catch {
      finishing.current = false;
      setError("Enter 1–200 characters.");
    }
  };
  return (
    <div
      className={`mind-node ${root ? "root-node" : ""} ${selected ? "is-selected" : ""}`}
      style={nodeAppearance(node.style, depth)}
      onDoubleClick={() => s.beginEdit(node.id)}
    >
      {root ? (
        <>
          <Handle id="left" type="source" position={Position.Left} />
          <Handle id="right" type="source" position={Position.Right} />
        </>
      ) : (
        <>
          <Handle
            id="in"
            type="target"
            position={side === "right" ? Position.Left : Position.Right}
          />
          <Handle
            id="out"
            type="source"
            position={side === "right" ? Position.Right : Position.Left}
          />
        </>
      )}
      {editing ? (
        <div className="node-edit nodrag nowheel">
          <input
            aria-label="Node text"
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                finishing.current = true;
                s.cancelEdit();
              }
            }}
          />
          {error && (
            <span className="node-error" role="alert">
              {error}
            </span>
          )}
        </div>
      ) : (
        <span className="node-label">{node.text}</span>
      )}
      {!root && node.children.length > 0 && (
        <button
          className="collapse-toggle nodrag"
          aria-label={`${node.collapsed ? "Expand" : "Collapse"} ${node.text}`}
          onClick={(e) => {
            e.stopPropagation();
            void s.toggleCollapse(node.id);
          }}
        >
          {node.collapsed ? `+${allNodes(node).length - 1}` : "−"}
        </button>
      )}
    </div>
  );
}
const nodeTypes = { mindmap: MindMapNode },
  edgeTypes = { mindmap: MindMapEdge };
interface BranchDrag {
  id: string;
  source: MapFile;
  position: Point;
  target: BranchDropTarget | null;
}
function dropDescription(target: BranchDropTarget | null, nodes: MapNode[]) {
  if (!target)
    return "Drop on a node to move, or near a sibling edge to reorder";
  if (target.kind === "invalid") return target.message;
  if (target.kind === "move")
    return `Drop to move under “${nodes.find((node) => node.id === target.parentId)?.text}”`;
  return `Drop ${target.placement} “${nodes.find((node) => node.id === target.siblingId)?.text}”`;
}
export function MindMapCanvas() {
  const s = useEditorStore(),
    theme = useThemeStore((state) => state.theme),
    flow = useReactFlow(),
    [help, setHelp] = useState(false),
    [styleTarget, setStyleTarget] = useState<{
      mapId: string;
      nodeId: string;
    } | null>(null),
    [sizes, setSizes] = useState(new Map<string, Size>()),
    [drag, setDrag] = useState<BranchDrag | null>(null),
    [invalidDrop, setInvalidDrop] = useState<Extract<
      BranchDropTarget,
      { kind: "invalid" }
    > | null>(null);
  const dragRef = useRef<BranchDrag | null>(null);
  const measurement = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null);
  const map = useMemo(() => {
    if (!s.map) return null;
    if (!s.draft) return s.map;
    const copy = structuredClone(s.map),
      parent = allNodes(copy.root).find((n) => n.id === s.draft!.parentId);
    if (parent) {
      const index = s.draft.afterId
        ? parent.children.findIndex((n) => n.id === s.draft!.afterId) + 1
        : parent.children.length;
      parent.children.splice(index, 0, {
        id: s.draft.id,
        text: "New idea",
        children: [],
        collapsed: false,
      });
      parent.collapsed = false;
    }
    return copy;
  }, [s.map, s.draft]);
  useEffect(() => {
    if (map && !s.editingNodeId) canvas.current?.focus();
  }, [map?.id, s.editingNodeId]);
  useEffect(() => {
    if (
      styleTarget &&
      (styleTarget.mapId !== s.map?.id ||
        styleTarget.nodeId !== s.selectedNodeId ||
        s.editingNodeId ||
        s.draft)
    )
      setStyleTarget(null);
  }, [styleTarget, s.map?.id, s.selectedNodeId, s.editingNodeId, s.draft]);
  const visible = useMemo(() => (map ? allNodes(map.root, true) : []), [map]);
  const depths = useMemo(() => {
    const result = new Map<string, number>();
    const stack = map ? [{ node: map.root, depth: 0 }] : [];
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      result.set(node.id, depth);
      for (const child of node.children)
        stack.push({ node: child, depth: depth + 1 });
    }
    return result;
  }, [map]);
  const signature = visible
    .map((n) => `${n.id}:${n.text}:${n.children.length}:${n.collapsed}`)
    .join("|");
  useLayoutEffect(() => {
    const next = new Map<string, Size>();
    for (const el of measurement.current?.children ?? []) {
      const box = (el as HTMLElement).getBoundingClientRect();
      if (box.width && box.height)
        next.set((el as HTMLElement).dataset.id!, {
          width: box.width,
          height: box.height,
        });
    }
    setSizes((previous) =>
      JSON.stringify([...previous]) === JSON.stringify([...next])
        ? previous
        : next,
    );
  }, [signature]);
  const positions = useMemo(
    () => (map ? computeLayout(map, sizes) : new Map()),
    [map, sizes],
  );
  function recentreRoot() {
    if (!map || dragRef.current) return;
    const root = flow.getInternalNode(map.root.id);
    const position =
      root?.internals.positionAbsolute ?? positions.get(map.root.id);
    const size = sizes.get(map.root.id) ?? DEFAULT_SIZE;
    if (!position) return;
    const zoom = flow.getZoom();
    // An active text field can outgrow the cached label measurements.
    const bounds = canvas.current
      ?.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${map.root.id}"]`,
      )
      ?.getBoundingClientRect();
    const width = bounds?.width
      ? bounds.width / zoom
      : (root?.measured?.width ?? size.width);
    const height = bounds?.height
      ? bounds.height / zoom
      : (root?.measured?.height ?? size.height);
    void flow.setCenter(position.x + width / 2, position.y + height / 2, {
      zoom,
      duration: 200,
      interpolate: "linear",
    });
  }
  function cancelDrag() {
    dragRef.current = null;
    setDrag(null);
  }
  useEffect(() => {
    if (!s.moveError) return;
    const dismiss = () => s.dismissMoveError();
    const timer = window.setTimeout(dismiss, 3000);
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", dismiss, true);
    window.addEventListener("wheel", dismiss, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", dismiss, true);
      window.removeEventListener("wheel", dismiss, true);
    };
  }, [s.moveError, s.dismissMoveError]);
  useEffect(() => {
    if (!invalidDrop) return;
    const timer = window.setTimeout(() => setInvalidDrop(null), 3000);
    return () => window.clearTimeout(timer);
  }, [invalidDrop]);
  useEffect(() => setInvalidDrop(null), [s.map]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) {
        event.preventDefault();
        event.stopPropagation();
        cancelDrag();
      }
    };
    const interrupted = () => {
      if (dragRef.current) cancelDrag();
    };
    window.addEventListener("keydown", cancel, true);
    window.addEventListener("blur", interrupted);
    window.addEventListener("touchcancel", interrupted);
    return () => {
      window.removeEventListener("keydown", cancel, true);
      window.removeEventListener("blur", interrupted);
      window.removeEventListener("touchcancel", interrupted);
    };
  }, []);
  useEffect(() => {
    if (
      dragRef.current &&
      (s.map !== dragRef.current.source || s.editingNodeId)
    )
      cancelDrag();
  }, [s.map, s.editingNodeId]);
  function dropTarget(event: MouseEvent | TouchEvent, current: BranchDrag) {
    const pointer =
      "changedTouches" in event
        ? (event.changedTouches[0] ?? event.touches[0])
        : event;
    const bounds = canvas.current?.getBoundingClientRect();
    if (
      !pointer ||
      !bounds ||
      event.type === "touchcancel" ||
      pointer.clientX < bounds.left ||
      pointer.clientX > bounds.right ||
      pointer.clientY < bounds.top ||
      pointer.clientY > bounds.bottom
    )
      return null;
    const element = document.elementFromPoint?.(
      pointer.clientX,
      pointer.clientY,
    );
    if (
      element?.closest(
        ".editor-toolbar,.node-tools,.node-options,.zoom-tools,.canvas-alert,[role=dialog]",
      )
    )
      return null;
    return branchDropTarget(
      current.source,
      current.id,
      flow.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY }),
      positions,
      sizes,
    );
  }
  const startDrag: OnNodeDrag<MindNode> = (_event, node) => {
    const source = useEditorStore.getState().map;
    const parent = source && findParent(source.root, node.id);
    if (!source || !parent || s.editingNodeId || s.draft) return;
    const current = {
      id: node.id,
      source,
      position: node.position,
      target: null,
    };
    dragRef.current = current;
    setStyleTarget(null);
    setInvalidDrop(null);
    setDrag(current);
    s.select(node.id);
    canvas.current?.focus();
  };
  const moveDrag: OnNodeDrag<MindNode> = (event, node) => {
    const current = dragRef.current;
    if (!current || current.id !== node.id) return;
    const next = {
      ...current,
      position: node.position,
      target: dropTarget(event, current),
    };
    dragRef.current = next;
    setDrag(next);
  };
  const stopDrag: OnNodeDrag<MindNode> = (event, node) => {
    const current = dragRef.current;
    cancelDrag();
    if (
      !current ||
      current.id !== node.id ||
      useEditorStore.getState().map !== current.source
    )
      return;
    const target = dropTarget(event, current);
    if (target?.kind === "reorder") void s.reorderNode(node.id, target.index);
    if (target?.kind === "move") {
      const parent = allNodes(current.source.root).find(
        (n) => n.id === target.parentId,
      )!;
      void s.moveNode(node.id, parent.id, parent.children.length);
    }
    if (target?.kind === "invalid") setInvalidDrop(target);
  };
  const changeNodes = (changes: NodeChange<MindNode>[]) => {
    const current = dragRef.current;
    if (!current) return;
    for (const change of changes) {
      if (
        change.type === "position" &&
        change.id === current.id &&
        change.position
      ) {
        const next = { ...current, position: change.position };
        dragRef.current = next;
        setDrag(next);
      }
    }
  };
  const remove = (id: string) => {
    const node = s.map && allNodes(s.map.root).find((n) => n.id === id);
    if (!node || node === s.map!.root) return;
    const count = allNodes(node).length - 1;
    if (
      !count ||
      window.confirm(
        `Delete “${node.text}” and its ${count} descendant${count === 1 ? "" : "s"}?`,
      )
    )
      void s.deleteNode(id);
  };
  const nodes: MindNode[] = visible.map((node) => ({
    id: node.id,
    type: "mindmap",
    measured: sizes.get(node.id) ?? DEFAULT_SIZE,
    position:
      drag?.id === node.id
        ? drag.position
        : (positions.get(node.id) ?? { x: 0, y: 0 }),
    draggable:
      node !== map!.root &&
      !s.editingNodeId &&
      !s.draft &&
      s.saving !== "saving",
    dragging: drag?.id === node.id,
    className: (() => {
      const target = drag?.target ?? invalidDrop;
      if (target?.kind === "reorder" && target.siblingId === node.id)
        return `reorder-${target.placement}`;
      if (target?.kind === "move" && target.parentId === node.id)
        return "branch-drop-target";
      if (target?.kind === "invalid" && target.nodeId === node.id)
        return "branch-drop-invalid";
      return undefined;
    })(),
    // React Flow remeasures handle bounds when a reorder switches tree sides.
    sourcePosition:
      (positions.get(node.id)?.x ?? 0) < 0 ? Position.Left : Position.Right,
    targetPosition:
      (positions.get(node.id)?.x ?? 0) < 0 ? Position.Right : Position.Left,
    selected: s.selectedNodeId === node.id,
    data: {
      node,
      root: node === map!.root,
      depth: depths.get(node.id)!,
      side: (positions.get(node.id)?.x ?? 0) < 0 ? "left" : "right",
      remove,
    },
  }));
  const edges = visible
    .filter((n) => n !== map!.root)
    .map((n) => {
      const parent = findParent(map!.root, n.id)!;
      return {
        id: `${parent.id}-${n.id}`,
        source: parent.id,
        target: n.id,
        type: "mindmap",
        data: { style: parent.style },
        sourceHandle:
          parent === map!.root
            ? (positions.get(n.id)?.x ?? 0) < 0
              ? "left"
              : "right"
            : "out",
        targetHandle: "in",
      };
    });
  useEffect(() => {
    const el = canvas.current;
    const wheel = (event: WheelEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input,button,select,[role=dialog],.node-options,.editor-toolbar,.shortcut-panel",
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.deltaY) return;
      const viewport = flow.getViewport(),
        zoom = clampZoom(
          Math.round((viewport.zoom + (event.deltaY < 0 ? 0.1 : -0.1)) * 100) /
            100,
        );
      const point = flow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const rect = el!.getBoundingClientRect();
      void flow.setViewport({
        zoom,
        x: event.clientX - rect.left - point.x * zoom,
        y: event.clientY - rect.top - point.y * zoom,
      });
    };
    el?.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => el?.removeEventListener("wheel", wheel, { capture: true });
  }, [flow]);
  if (!map) return null;
  const selected =
    s.selectedNodeId &&
    allNodes(map.root).find((n) => n.id === s.selectedNodeId);
  return (
    <div
      className="canvas-shell"
      ref={canvas}
      tabIndex={0}
      aria-label="Mind map editor"
      onPointerDownCapture={() => setInvalidDrop(null)}
      onKeyDown={(e) => {
        setInvalidDrop(null);
        if (e.key === "Escape") setStyleTarget(null);
        if (dragRef.current) return;
        if (
          e.ctrlKey ||
          e.metaKey ||
          e.key === "Home" ||
          !(e.target as HTMLElement).closest("button")
        )
          handleEditorKey(
            e.nativeEvent,
            s,
            remove,
            () => setHelp(true),
            recentreRoot,
          );
        if (
          e.nativeEvent.defaultPrevented &&
          (e.ctrlKey || e.metaKey) &&
          ["z", "y"].includes(e.key.toLowerCase())
        )
          setStyleTarget(null);
      }}
    >
      <div className="measurement" ref={measurement} aria-hidden="true">
        {visible.map((n) => (
          <div
            className={`mind-node ${n === map.root ? "root-node" : ""}`}
            data-id={n.id}
            key={n.id}
          >
            <span className="node-label">{n.text}</span>
            {n !== map.root && n.children.length > 0 && (
              <span className="collapse-toggle">
                {n.collapsed ? `+${allNodes(n).length - 1}` : "−"}
              </span>
            )}
          </div>
        ))}
      </div>
      <header className="editor-toolbar">
        <div className="editor-title">
          <Link
            to="/"
            onClick={(e) => {
              if (s.saving === "saving") e.preventDefault();
            }}
            aria-label="Back to maps"
          >
            ←
          </Link>
          <span className="toolbar-divider" />
          <div>
            <strong>{map.title}</strong>
            <span className={`save-status ${s.saving}`} role="status">
              {s.saving === "saving"
                ? "Saving…"
                : s.saving === "error"
                  ? "Save failed"
                  : "✓ All changes saved"}
            </span>
          </div>
        </div>
        <div className="editor-toolbar-actions">
          <button
            className="history-button"
            aria-label="Undo"
            title="Undo (Ctrl+Z / ⌘Z)"
            disabled={!s.undoStack.length || !!s.editingNodeId || !!s.draft}
            onClick={() => {
              setStyleTarget(null);
              void s.undo();
              canvas.current?.focus();
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12" />
            </svg>
          </button>
          <button
            className="history-button"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z / Ctrl+Y / ⌘⇧Z)"
            disabled={!s.redoStack.length || !!s.editingNodeId || !!s.draft}
            onClick={() => {
              setStyleTarget(null);
              void s.redo();
              canvas.current?.focus();
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m15 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12" />
            </svg>
          </button>
          <button
            className="recentre-root"
            aria-label="Re-centre root"
            title="Re-centre root (Home)"
            disabled={!!drag}
            onPointerDown={(event) => event.preventDefault()}
            onClick={recentreRoot}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2" />
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            </svg>
          </button>
          <CopyMarkdownButton map={s.map!} />
          <ExportJsonButton map={s.map!} />
          <ExportPngButton map={s.map!} />
          <ThemeToggle />
          <button onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
            ? <span className="desktop-label">Shortcuts</span>
          </button>
        </div>
      </header>
      {(s.error || s.notice) && (
        <div
          className={
            s.error ? "canvas-alert error-banner" : "canvas-alert notice"
          }
          role={s.error ? "alert" : "status"}
        >
          {s.error || s.notice}
          {s.error && (
            <button onClick={() => void s.saveMap()}>Retry change</button>
          )}
        </div>
      )}
      {s.moveError && (
        <div
          className="canvas-alert error-banner move-error-toast"
          role="alert"
        >
          {s.moveError}
          <button
            aria-label="Dismiss move error"
            onClick={() => s.dismissMoveError()}
          >
            ×
          </button>
        </div>
      )}
      {allNodes(map.root).length > 500 && (
        <p className="performance-warning" role="status">
          This map has more than 500 nodes. Editing may be slower.
        </p>
      )}
      <ReactFlow
        colorMode={theme}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.1}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.1, maxZoom: 1 }}
        nodesDraggable
        onNodesChange={changeNodes}
        onNodeDragStart={startDrag}
        onNodeDrag={moveDrag}
        onNodeDragStop={stopDrag}
        selectNodesOnDrag={false}
        multiSelectionKeyCode={null}
        disableKeyboardA11y
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        zoomOnPinch={false}
        panOnDrag
        selectionOnDrag={false}
        onNodeClick={(event, node) => {
          s.select(node.id);
          if (!(event.target as HTMLElement).closest("input,button")) {
            if (!s.editingNodeId && !s.draft && !dragRef.current)
              setStyleTarget({ mapId: map.id, nodeId: node.id });
            canvas.current?.focus();
          }
        }}
        onPaneClick={() => {
          setStyleTarget(null);
          canvas.current?.focus();
        }}
        onNodeDoubleClick={(_, node) => s.beginEdit(node.id)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          if (s.editingNodeId || s.draft || dragRef.current) return;
          s.select(node.id);
          setStyleTarget({ mapId: map.id, nodeId: node.id });
        }}
      >
        <Background gap={24} size={1} color="var(--grid)" />
      </ReactFlow>
      {(drag || invalidDrop) && (
        <div
          className={`reorder-hint ${(drag?.target ?? invalidDrop)?.kind === "invalid" ? "invalid-drop-hint" : ""}`}
          role={
            (drag?.target ?? invalidDrop)?.kind === "invalid"
              ? "alert"
              : "status"
          }
        >
          {dropDescription(drag?.target ?? invalidDrop, visible)}
          {drag && <span> · Escape to cancel</span>}
        </div>
      )}
      <div className="node-tools" aria-label="Node actions">
        <span className="tools-label">
          {selected ? "SELECTED NODE" : "SELECT A NODE"}
        </span>
        <button
          disabled={!selected || !!s.editingNodeId}
          onClick={() => selected && s.addNode(selected.id)}
        >
          ＋ Add child <kbd>Tab</kbd>
        </button>
        <button
          disabled={!selected || !!s.editingNodeId}
          onClick={() => selected && s.beginEdit(selected.id)}
        >
          Edit text <kbd>F2</kbd>
        </button>
        <button
          className="delete-node"
          disabled={
            !selected || selected.id === map.root.id || !!s.editingNodeId
          }
          onClick={() => selected && remove(selected.id)}
        >
          Delete <kbd>⌫</kbd>
        </button>
      </div>
      {styleTarget?.mapId === map.id &&
        selected &&
        selected.id === styleTarget.nodeId &&
        !s.editingNodeId &&
        !s.draft && (
          <NodeContextMenu
            key={`${map.id}:${selected.id}`}
            node={selected}
            root={selected === map.root}
            depth={depths.get(selected.id)!}
            onClose={() => {
              setStyleTarget(null);
              canvas.current?.focus();
            }}
          />
        )}
      <div className="zoom-tools">
        <button
          aria-label="Zoom out"
          onClick={() => void flow.zoomTo(clampZoom(flow.getZoom() - 0.1))}
        >
          −
        </button>
        <ZoomLabel />
        <button
          aria-label="Zoom in"
          onClick={() => void flow.zoomTo(clampZoom(flow.getZoom() + 0.1))}
        >
          ＋
        </button>
        <span className="toolbar-divider" />
        <button
          onClick={() =>
            void flow.fitView({
              padding: 0.2,
              minZoom: 0.1,
              maxZoom: 2,
              duration: 200,
            })
          }
        >
          Fit to screen
        </button>
      </div>
      <div className="canvas-hint">
        Drag the canvas to explore <span>·</span> Scroll to zoom <span>·</span>{" "}
        Double-click a node to edit
      </div>
      {help && (
        <Dialog title="A thought away" onClose={() => setHelp(false)}>
          <p className="subtitle">
            Keep your ideas flowing with keyboard shortcuts.
          </p>
          <dl className="shortcut-list">
            {[
              ["Tab / Insert", "Add a child"],
              ["Enter", "Add a sibling"],
              ["F2 / double-click", "Edit text"],
              ["Delete / Backspace", "Delete branch"],
              ["Space", "Collapse or expand"],
              ["↑ / ↓", "Previous / next sibling"],
              ["Alt + ↑ / ↓", "Move sibling up / down"],
              ["← / →", "Parent / first child"],
              ["Home", "Re-centre root"],
              ["Ctrl / ⌘ + Z", "Undo"],
              ["Ctrl / ⌘ + Shift + Z; Ctrl + Y", "Redo"],
              ["Escape", "Cancel edit or close dialog"],
              ["?", "Show shortcuts"],
            ].map(([key, label]) => (
              <div key={key}>
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
          <button
            className="primary"
            onClick={() => {
              setHelp(false);
              canvas.current?.focus();
            }}
          >
            Back to thinking
          </button>
        </Dialog>
      )}
    </div>
  );
}
import { useViewport } from "@xyflow/react";
function ZoomLabel() {
  const { zoom } = useViewport();
  return <span className="zoom-label">{Math.round(zoom * 100)}%</span>;
}
