import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import { toPng } from "html-to-image";
import {
  MapFileSchema,
  type MapFile,
  type MapNode,
  type NodeStyle,
} from "../shared/schema.js";
import { allNodes } from "../shared/tree.js";
import { computeLayout, type Size } from "./layout";
import { nodeAppearance } from "./nodeStyle";
import { MindMapEdge } from "./components/MindMapEdge";
import { downloadUrl, exportFilename } from "./download";

type ExportNode = Node<
  { node: MapNode; root: boolean; depth: number; left: boolean },
  "mindmap"
>;

export function expandedPngMap(map: MapFile): MapFile {
  const copy = MapFileSchema.parse(map);
  for (const node of allNodes(copy.root)) node.collapsed = false;
  return copy;
}

export function pngGraph(map: MapFile, sizes: Map<string, Size>) {
  const positions = computeLayout(map, sizes);
  const nodes: ExportNode[] = [],
    edges: Edge<{ style?: NodeStyle }>[] = [];
  const stack = [{ node: map.root, depth: 0 }];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    const size = sizes.get(node.id),
      position = positions.get(node.id);
    if (!size || !position || size.width <= 0 || size.height <= 0)
      throw new Error("Could not measure the complete map.");
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + size.width);
    maxY = Math.max(maxY, position.y + size.height);
    nodes.push({
      id: node.id,
      type: "mindmap",
      position,
      width: size.width,
      height: size.height,
      measured: size,
      draggable: false,
      selectable: false,
      focusable: false,
      data: { node, root: node === map.root, depth, left: position.x < 0 },
    });
    for (const child of node.children) {
      stack.push({ node: child, depth: depth + 1 });
      edges.push({
        id: `${node.id}-${child.id}`,
        source: node.id,
        target: child.id,
        type: "mindmap",
        sourceHandle:
          node === map.root
            ? positions.get(child.id)!.x < 0
              ? "left"
              : "right"
            : "out",
        targetHandle: "in",
        data: { style: node.style },
        selectable: false,
        focusable: false,
      });
    }
  }
  const padding = 32;
  const width = Math.ceil(maxX - minX + padding * 2),
    height = Math.ceil(maxY - minY + padding * 2);
  // Keep the promised 2× resolution; never silently downsample or clip a large map.
  if (
    !Number.isFinite(width + height) ||
    width * 2 > 32767 ||
    height * 2 > 32767 ||
    width * height * 4 > 64_000_000
  )
    throw new Error(
      "This map is too large to export as a PNG at full resolution.",
    );
  return {
    nodes,
    edges,
    width,
    height,
    viewport: { x: padding - minX, y: padding - minY, zoom: 1 },
  };
}

function PngNode({ data }: NodeProps<ExportNode>) {
  const { node, root, depth, left } = data;
  return (
    <div
      className={`mind-node ${root ? "root-node" : ""}`}
      style={nodeAppearance(node.style, depth)}
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
            position={left ? Position.Right : Position.Left}
          />
          <Handle
            id="out"
            type="source"
            position={left ? Position.Left : Position.Right}
          />
        </>
      )}
      <span className="node-label">{node.text}</span>
    </div>
  );
}
const nodeTypes = { mindmap: PngNode },
  edgeTypes = { mindmap: MindMapEdge };
function ExportReady({ onReady }: { onReady(): void }) {
  const initialized = useNodesInitialized({ includeHiddenNodes: true });
  useEffect(() => {
    if (initialized) onReady();
  }, [initialized, onReady]);
  return null;
}

export function includeInPng(node: HTMLElement): boolean {
  return (
    !node.classList?.contains("react-flow__handle") &&
    !node.classList?.contains("react-flow__panel") &&
    !node.classList?.contains("react-flow__edge-interaction") &&
    !node.classList?.contains("react-flow__aria-live")
  );
}

async function abortable<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function downloadMapPng(
  input: MapFile,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const map = expandedPngMap(input);
  if (document.fonts) await abortable(document.fonts.ready, signal);
  signal.throwIfAborted();
  const host = document.createElement("div");
  host.className = "png-export-host";
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  // Freeze the current palette for the duration of this export.
  const theme =
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const themeStyle = getComputedStyle(document.documentElement);
  for (let i = 0; i < themeStyle.length; i++) {
    const property = themeStyle[i];
    if (property.startsWith("--"))
      host.style.setProperty(property, themeStyle.getPropertyValue(property));
  }
  document.body.append(host);
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    const measurement = document.createElement("div");
    measurement.className = "png-measurement";
    host.append(measurement);
    const sizes = new Map<string, Size>();
    for (const node of allNodes(map.root)) {
      const element = document.createElement("div"),
        label = document.createElement("span");
      element.className = `mind-node ${node === map.root ? "root-node" : ""}`;
      label.className = "node-label";
      label.textContent = node.text;
      element.append(label);
      measurement.append(element);
      const { width, height } = element.getBoundingClientRect();
      sizes.set(node.id, { width, height });
    }
    const graph = pngGraph(map, sizes);
    measurement.remove();
    const container = document.createElement("div");
    container.className = "png-export-canvas";
    container.style.width = `${graph.width}px`;
    container.style.height = `${graph.height}px`;
    host.append(container);
    root = createRoot(container);
    await new Promise<void>((resolve, reject) => {
      let frame = 0,
        finished = false;
      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(signal.reason);
      const timer = window.setTimeout(
        () => finish(new Error("Could not render the complete map.")),
        15000,
      );
      signal.addEventListener("abort", abort, { once: true });
      const ready = () => {
        if (finished) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(function check() {
            if (finished) return;
            if (
              container.querySelectorAll(".react-flow__node").length ===
                graph.nodes.length &&
              container.querySelectorAll(".react-flow__edge-path").length ===
                graph.edges.length
            )
              finish();
            else frame = requestAnimationFrame(check);
          });
        });
      };
      root!.render(
        <ReactFlowProvider>
          <ReactFlow<ExportNode>
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultViewport={graph.viewport}
            colorMode={theme}
            minZoom={1}
            maxZoom={1}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            disableKeyboardA11y
            onError={(_code, message) => finish(new Error(message))}
          >
            <ExportReady onReady={ready} />
          </ReactFlow>
        </ReactFlowProvider>,
      );
    });
    signal.throwIfAborted();
    const flow = container.querySelector<HTMLElement>(".react-flow")!;
    const url = await abortable(
      toPng(flow, {
        width: graph.width,
        height: graph.height,
        pixelRatio: 2,
        skipAutoScale: true,
        backgroundColor: "#ffffff",
        fontEmbedCSS: "",
        filter: includeInPng,
      }),
      signal,
    );
    signal.throwIfAborted();
    if (!url.startsWith("data:image/png;base64,"))
      throw new Error("The browser could not create a PNG image.");
    downloadUrl(url, exportFilename(map.title, "png"));
  } finally {
    root?.unmount();
    host.remove();
  }
}
