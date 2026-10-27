import { beforeEach, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MindMapCanvas } from "../../src/client/components/MindMapCanvas";
import { useEditorStore } from "../../src/client/stores/editorStore";
import { fixture } from "../fixtures";
const { flowProps, methods } = vi.hoisted(() => ({
  flowProps: { current: null as any },
  methods: {
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    screenToFlowPosition: (point: unknown) => point,
    setViewport: vi.fn(),
    getZoom: () => 1,
    zoomTo: vi.fn(),
    fitView: vi.fn(),
  },
}));
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
  expect(flowProps.current.nodesDraggable).toBe(false);
});
