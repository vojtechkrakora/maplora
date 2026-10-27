import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { MapFile, MapNode } from "../../shared/schema.js";
import { allNodes, findParent } from "../../shared/tree.js";
import { useEditorStore } from "../stores/editorStore";
import { clampZoom, computeLayout, DEFAULT_SIZE, type Size } from "../layout";
import { Link } from "react-router-dom";
import { handleEditorKey } from "../keyboard";
import { Dialog } from "./Dialog";

type MindNode = Node<
  {
    node: MapNode;
    root: boolean;
    side: "left" | "right";
    remove(id: string): void;
  },
  "mindmap"
>;
export function MindMapNode({ data, selected }: NodeProps<MindNode>) {
  const s = useEditorStore(),
    { node, root, side } = data;
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
export function MindMapEdge(props: EdgeProps) {
  const [path] = getBezierPath(props);
  return (
    <BaseEdge
      id={props.id}
      path={path}
      style={{ stroke: "var(--edge)", strokeWidth: 2 }}
    />
  );
}
const nodeTypes = { mindmap: MindMapNode },
  edgeTypes = { mindmap: MindMapEdge };
export function MindMapCanvas() {
  const s = useEditorStore(),
    flow = useReactFlow(),
    [help, setHelp] = useState(false),
    [sizes, setSizes] = useState(new Map<string, Size>());
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
  const visible = useMemo(() => (map ? allNodes(map.root, true) : []), [map]);
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
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    selected: s.selectedNodeId === node.id,
    data: {
      node,
      root: node === map!.root,
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
          "input,button,.editor-toolbar,.shortcut-panel",
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
      onKeyDown={(e) => {
        if (!(e.target as HTMLElement).closest("button"))
          handleEditorKey(e.nativeEvent, s, remove, () => setHelp(true));
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
        <button onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
          ? <span className="desktop-label">Shortcuts</span>
        </button>
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
      {allNodes(map.root).length > 500 && (
        <p className="performance-warning" role="status">
          This map has more than 500 nodes. Editing may be slower.
        </p>
      )}
      <ReactFlow
        colorMode="system"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.1}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.1, maxZoom: 1 }}
        nodesDraggable={false}
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
          if (!(event.target as HTMLElement).closest("input,button"))
            canvas.current?.focus();
        }}
        onPaneClick={() => canvas.current?.focus()}
        onNodeDoubleClick={(_, node) => s.beginEdit(node.id)}
      >
        <Background gap={24} size={1} color="var(--grid)" />
      </ReactFlow>
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
              ["← / →", "Parent / first child"],
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
