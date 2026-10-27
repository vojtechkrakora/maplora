import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MindMapCanvas } from "../../src/client/components/MindMapCanvas";
import { useEditorStore } from "../../src/client/stores/editorStore";
import { fixture } from "../fixtures";
import { useThemeStore } from "../../src/client/stores/themeStore";
import { applyOperation } from "../../src/client/stores/editorStore";
const { flowProps, methods } = vi.hoisted(() => ({
  flowProps: { current: null as any },
  methods: {
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    screenToFlowPosition: (point: { x: number; y: number }) => ({
      x: point.x - 600,
      y: point.y - 400,
    }),
    setViewport: vi.fn(),
    getZoom: () => 1,
    zoomTo: vi.fn(),
    fitView: vi.fn(),
  },
}));
const originalReorder = useEditorStore.getState().reorderNode;
const originalMove = useEditorStore.getState().moveNode;
afterEach(() => {
  useEditorStore.setState({
    reorderNode: originalReorder,
    moveNode: originalMove,
  });
  vi.restoreAllMocks();
  vi.useRealTimers();
});
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ReactFlow: (props: any) => {
    flowProps.current = props;
    return <div>{props.children}</div>;
  },
  Background: () => null,
  useReactFlow: () => methods,
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}));
beforeEach(() => {
  useThemeStore.setState({ theme: "light" });
  const map = fixture();
  useEditorStore.setState({
    map,
    selectedNodeId: map.root.id,
    editingNodeId: null,
    draft: null,
    error: null,
    notice: null,
    moveError: null,
    saving: "idle",
  });
});
it("switches the canvas color mode from the editor theme control without modifying the map", () => {
  const original = structuredClone(useEditorStore.getState().map!);
  render(
    <MemoryRouter>
      <MindMapCanvas />
    </MemoryRouter>,
  );
  expect(flowProps.current.colorMode).toBe("light");
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
  expect(flowProps.current.colorMode).toBe("dark");
  expect(useEditorStore.getState().map).toEqual(original);
});
it.each(["unselected", "editing", "draft", "saving", "error"])(
  "keeps Copy as Markdown available while %s",
  (state) => {
    const map = useEditorStore.getState().map!;
    useEditorStore.setState({
      selectedNodeId: state === "unselected" ? null : map.root.id,
      editingNodeId:
        state === "editing" || state === "draft" ? map.root.id : null,
      draft: state === "draft" ? { id: "draft", parentId: map.root.id } : null,
      saving:
        state === "saving" ? "saving" : state === "error" ? "error" : "idle",
    });
    render(
      <MemoryRouter>
        <MindMapCanvas />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: "Copy as Markdown" }),
    ).toBeEnabled();
  },
);
it("keeps measured dimensions across controlled selection updates so nodes remain clickable", () => {
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <MindMapCanvas />
    </MemoryRouter>,
  );
  expect(flowProps.current.nodes[0].measured).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
  });
  act(() => useEditorStore.getState().select(null));
  expect(flowProps.current.nodes[0].measured.width).toBeGreaterThan(0);
  expect(flowProps.current.nodes[0].measured.height).toBeGreaterThan(0);
  expect(flowProps.current.fitView).toBe(true);
  expect(flowProps.current.nodesDraggable).toBe(true);
  expect(flowProps.current.nodes[0].draggable).toBe(false);
});
it("passes logical depths on both sides, through collapse/expand, drafts and branch moves", () => {
  let map = fixture();
  const chain = Array.from({ length: 6 }, (_, i) => ({
    id: `depth-${i + 1}`,
    text: `Level ${i + 1}`,
    children: [] as typeof map.root.children,
    collapsed: false,
  }));
  for (let i = 0; i < chain.length - 1; i++) chain[i].children = [chain[i + 1]];
  map.root.children = [
    chain[0],
    { id: "left", text: "Left", children: [], collapsed: false },
  ];
  useEditorStore.setState({ map });
  render(
    <MemoryRouter>
      <MindMapCanvas />
    </MemoryRouter>,
  );
  const depth = (id: string) =>
    flowProps.current.nodes.find((node: any) => node.id === id)?.data.depth;
  expect(depth(map.root.id)).toBe(0);
  expect(depth("left")).toBe(1);
  chain.forEach((node, index) => expect(depth(node.id)).toBe(index + 1));
  map = structuredClone(map);
  map.root.children[0].collapsed = true;
  act(() => useEditorStore.setState({ map }));
  expect(depth("depth-2")).toBeUndefined();
  expect(depth("left")).toBe(1);
  act(() =>
    useEditorStore.setState({ draft: { id: "draft", parentId: "depth-2" } }),
  );
  // The draft expands its parent; its color follows the logical parent depth.
  map = structuredClone(map);
  map.root.children[0].collapsed = false;
  act(() => useEditorStore.setState({ map }));
  expect(depth("draft")).toBe(3);
  map = applyOperation(map, {
    kind: "move",
    id: "depth-2",
    parentId: "depth-1",
    newParentId: map.root.id,
    beforeId: null,
  });
  act(() => useEditorStore.setState({ map, draft: null }));
  expect(depth("depth-2")).toBe(1);
  expect(depth("depth-6")).toBe(5);
});
function draggableMap() {
  const map = fixture();
  map.root.children = ["first", "second", "third"].map((id) => ({
    id,
    text: id,
    children: [],
    collapsed: false,
  }));
  const reorder = vi.fn().mockResolvedValue(true);
  const move = vi.fn().mockResolvedValue(true);
  useEditorStore.setState({ map, reorderNode: reorder, moveNode: move });
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <MindMapCanvas />
    </MemoryRouter>,
  );
  vi.spyOn(
    screen.getByLabelText("Mind map editor"),
    "getBoundingClientRect",
  ).mockReturnValue({
    left: 0,
    top: 0,
    right: 1500,
    bottom: 1000,
    width: 1500,
    height: 1000,
  } as DOMRect);
  const first = flowProps.current.nodes.find(
    (node: any) => node.id === "first",
  );
  const third = flowProps.current.nodes.find(
    (node: any) => node.id === "third",
  );
  const event = new MouseEvent("mousemove", {
    clientX: third.position.x + third.measured.width / 2 + 600,
    clientY: third.position.y + third.measured.height - 2 + 400,
  });
  return { first, third, event, reorder, move };
}
it("previews a sibling insertion without saving, then commits the drop once", () => {
  const { first, third, event, reorder } = draggableMap();
  act(() => flowProps.current.onNodeDragStart(event, first));
  act(() =>
    flowProps.current.onNodeDrag(event, { ...first, position: third.position }),
  );
  expect(screen.getByText("Drop after “third”")).toBeInTheDocument();
  expect(
    flowProps.current.nodes.find((node: any) => node.id === "third").className,
  ).toBe("reorder-after");
  expect(
    useEditorStore.getState().map!.root.children.map((node) => node.id),
  ).toEqual(["first", "second", "third"]);
  expect(reorder).not.toHaveBeenCalled();
  act(() => flowProps.current.onNodeDragStop(event, first));
  expect(reorder).toHaveBeenCalledExactlyOnceWith("first", 2);
  expect(screen.queryByText("Drop after “third”")).not.toBeInTheDocument();
});
function centreOf(node: any) {
  return new MouseEvent("mousemove", {
    clientX: node.position.x + node.measured.width / 2 + 600,
    clientY: node.position.y + node.measured.height / 2 + 400,
  });
}
it("passes source-node styling to outgoing edges and opens styling on a node click or context menu", () => {
  draggableMap();
  const map = structuredClone(useEditorStore.getState().map!);
  map.root.style = { connectorColor: "#ff0000", connectorWidth: 8 };
  map.root.children[0].style = { connectorColor: "#0000ff" };
  map.root.children[0].children = [
    { id: "nested", text: "Nested", collapsed: false, children: [] },
  ];
  act(() => useEditorStore.setState({ map }));
  expect(
    flowProps.current.edges.find((edge: any) => edge.target === "first").data
      .style,
  ).toEqual(map.root.style);
  expect(
    flowProps.current.edges.find((edge: any) => edge.target === "nested").data
      .style,
  ).toEqual(map.root.children[0].style);
  expect(
    screen.queryByRole("button", { name: "Style" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  act(() =>
    flowProps.current.onNodeClick(
      { target: document.createElement("span") },
      { id: "first" },
    ),
  );
  expect(
    screen.getByRole("complementary", { name: "Node options" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" });
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  const event = { preventDefault: vi.fn() };
  act(() => flowProps.current.onNodeContextMenu(event, { id: "first" }));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(useEditorStore.getState().selectedNodeId).toBe("first");
  expect(
    screen.getByRole("complementary", { name: "Node options" }),
  ).toBeInTheDocument();
  act(() => useEditorStore.getState().select("third"));
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});
it("switches node options on click and dismisses them for canvas clicks, editing, and dragging", () => {
  const { first } = draggableMap();
  const click = (id: string) =>
    act(() =>
      flowProps.current.onNodeClick(
        { target: document.createElement("span") },
        { id },
      ),
    );
  click("first");
  fireEvent.change(screen.getByLabelText("Background color"), {
    target: { value: "#ff0000" },
  });
  click("third");
  expect(screen.getByRole("complementary")).toHaveTextContent("third");
  expect(screen.getByRole("button", { name: "Apply style" })).toBeDisabled();
  act(() => flowProps.current.onPaneClick());
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  click("first");
  act(() => flowProps.current.onNodeDoubleClick({}, { id: "first" }));
  expect(useEditorStore.getState().editingNodeId).toBe("first");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  act(() => useEditorStore.getState().cancelEdit());
  click("first");
  act(() =>
    flowProps.current.onNodeDragStart(new MouseEvent("mousemove"), first),
  );
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});
it("ignores control clicks and keeps canvas shortcuts working while options are open", () => {
  draggableMap();
  act(() =>
    flowProps.current.onNodeClick(
      { target: document.createElement("button") },
      { id: "first" },
    ),
  );
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  act(() =>
    flowProps.current.onNodeClick(
      { target: document.createElement("span") },
      { id: "first" },
    ),
  );
  fireEvent.keyDown(screen.getByLabelText("Mind map editor"), {
    key: "Escape",
  });
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});
it("highlights a new parent and moves the entire branch only on drop", () => {
  const { first, third, move, reorder } = draggableMap();
  const event = centreOf(third);
  act(() => flowProps.current.onNodeDragStart(event, first));
  act(() =>
    flowProps.current.onNodeDrag(event, { ...first, position: third.position }),
  );
  expect(screen.getByText("Drop to move under “third”")).toBeInTheDocument();
  expect(
    flowProps.current.nodes.find((node: any) => node.id === "third").className,
  ).toBe("branch-drop-target");
  expect(move).not.toHaveBeenCalled();
  act(() => flowProps.current.onNodeDragStop(event, first));
  expect(move).toHaveBeenCalledExactlyOnceWith("first", "third", 0);
  expect(reorder).not.toHaveBeenCalled();
});
it("allows a single child to be dragged to another parent while protecting the root", () => {
  draggableMap();
  const map = structuredClone(useEditorStore.getState().map!);
  map.root.children[0].children = [
    { id: "only-child", text: "Only child", collapsed: false, children: [] },
  ];
  act(() => useEditorStore.setState({ map }));
  expect(
    flowProps.current.nodes.find((node: any) => node.id === "only-child")
      .draggable,
  ).toBe(true);
  expect(
    flowProps.current.nodes.find((node: any) => node.id === map.root.id)
      .draggable,
  ).toBe(false);
});
it("shows invalid parent feedback during and after a rejected drop without saving", () => {
  vi.useFakeTimers();
  const { first, move, reorder } = draggableMap();
  const root = flowProps.current.nodes[0];
  const event = centreOf(root);
  act(() => flowProps.current.onNodeDragStart(event, first));
  act(() => flowProps.current.onNodeDrag(event, first));
  expect(screen.getByRole("alert")).toHaveTextContent("already under");
  expect(flowProps.current.nodes[0].className).toBe("branch-drop-invalid");
  act(() => flowProps.current.onNodeDragStop(event, first));
  expect(screen.getByRole("alert")).toHaveTextContent("already under");
  expect(move).not.toHaveBeenCalled();
  expect(reorder).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("cancels a prospective branch move with Escape", () => {
  const { first, third, move, reorder } = draggableMap();
  const event = centreOf(third);
  act(() => flowProps.current.onNodeDragStart(event, first));
  act(() => flowProps.current.onNodeDrag(event, first));
  fireEvent.keyDown(window, { key: "Escape" });
  act(() => flowProps.current.onNodeDragStop(event, first));
  expect(move).not.toHaveBeenCalled();
  expect(reorder).not.toHaveBeenCalled();
  expect(
    screen.queryByText("Drop to move under “third”"),
  ).not.toBeInTheDocument();
});
it("dismisses move-failure feedback after exactly three seconds", () => {
  vi.useFakeTimers();
  draggableMap();
  act(() =>
    useEditorStore.setState({
      moveError: "Branch could not be moved: Disk full",
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Disk full");
  act(() => vi.advanceTimersByTime(2999));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(useEditorStore.getState().moveError).toBeNull();
});
it.each(["pointerdown", "keydown", "wheel"])(
  "dismisses move errors on the next %s interaction",
  (type) => {
    draggableMap();
    act(() =>
      useEditorStore.setState({
        moveError: "Branch could not be moved: Disk full",
      }),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent(window, new Event(type));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
);
it("cancels a drag with Escape and ignores subsequent movement and drop from that gesture", () => {
  const { first, third, event, reorder } = draggableMap();
  act(() => flowProps.current.onNodeDragStart(event, first));
  act(() =>
    flowProps.current.onNodeDrag(event, { ...first, position: third.position }),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  act(() => {
    flowProps.current.onNodesChange([
      {
        type: "position",
        id: first.id,
        position: third.position,
        dragging: true,
      },
    ]);
    flowProps.current.onNodeDrag(event, { ...first, position: third.position });
    flowProps.current.onNodeDragStop(event, first);
  });
  expect(reorder).not.toHaveBeenCalled();
  expect(
    flowProps.current.nodes.find((node: any) => node.id === first.id).position,
  ).toEqual(first.position);
  expect(flowProps.current.nodes.every((node: any) => !node.className)).toBe(
    true,
  );
});
it("does not persist a drop onto empty canvas or outside the editor", () => {
  const { first, reorder } = draggableMap();
  for (const event of [
    new MouseEvent("mouseup", { clientX: 1400, clientY: 900 }),
    new MouseEvent("mouseup", { clientX: 1600, clientY: 900 }),
  ]) {
    act(() => flowProps.current.onNodeDragStart(event, first));
    act(() => flowProps.current.onNodeDragStop(event, first));
  }
  expect(reorder).not.toHaveBeenCalled();
});
it("cancels an active preview when the live map changes or the window loses focus", () => {
  const { first, event, reorder } = draggableMap();
  act(() => flowProps.current.onNodeDragStart(event, first));
  fireEvent.blur(window);
  act(() => flowProps.current.onNodeDragStop(event, first));
  act(() => flowProps.current.onNodeDragStart(event, first));
  act(() =>
    useEditorStore.setState({
      map: structuredClone(useEditorStore.getState().map!),
    }),
  );
  act(() => flowProps.current.onNodeDragStop(event, first));
  expect(reorder).not.toHaveBeenCalled();
});
