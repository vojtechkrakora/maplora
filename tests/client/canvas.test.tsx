import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MindMapCanvas } from "../../src/client/components/MindMapCanvas";
import { useEditorStore } from "../../src/client/stores/editorStore";
import { fixture } from "../fixtures";
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
