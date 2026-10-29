import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MindMapCanvas } from "../../src/client/components/MindMapCanvas";
import { useEditorStore } from "../../src/client/stores/editorStore";
import { encodeSubtree } from "../../src/client/subtreeClipboard";
import { allNodes } from "../../src/shared/tree";
import { fixture } from "../fixtures";

const { props } = vi.hoisted(() => ({ props: { current: null as any } }));
vi.mock("@xyflow/react", async (original) => ({
  ...(await original<object>()),
  ReactFlow: (value: any) => {
    props.current = value;
    return <div>{value.children}</div>;
  },
  Background: () => null,
  useReactFlow: () => ({
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    getZoom: () => 1,
    fitView: vi.fn(),
    zoomTo: vi.fn(),
    getInternalNode: vi.fn(),
    screenToFlowPosition: (p: unknown) => p,
  }),
  useViewport: () => ({ zoom: 1 }),
}));
const original = useEditorStore.getState();
let cut = vi.fn(),
  paste = vi.fn();
beforeEach(() => {
  const map = fixture();
  map.root.children = [
    {
      ...structuredClone(map.root),
      id: "12345678-1234-4234-8234-123456789020",
      text: "  Branch 🌲 ",
      collapsed: true,
      style: { connectorColor: "#abcdef" },
      children: [
        {
          ...structuredClone(map.root),
          id: "12345678-1234-4234-8234-123456789021",
          text: "Hidden child",
        },
      ],
    },
  ];
  cut = vi.fn(async () => true);
  paste = vi.fn(async () => true);
  useEditorStore.setState({
    ...original,
    map,
    selectedNodeId: map.root.children[0].id,
    cutSubtree: cut,
    pasteSubtree: paste,
  });
});
afterEach(() => {
  useEditorStore.setState(original, true);
  document.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});
function editor() {
  const rendered = render(
    <StrictMode>
      <MemoryRouter>
        <MindMapCanvas />
      </MemoryRouter>
    </StrictMode>,
  );
  const canvas = screen.getByLabelText("Mind map editor");
  canvas.focus();
  return { canvas, ...rendered };
}
function transfer(text = "", failure?: "read" | "write") {
  let content = text;
  return {
    getData: vi.fn(() => {
      if (failure === "read") throw new Error("Read denied");
      return content;
    }),
    setData: vi.fn((_type: string, value: string) => {
      if (failure === "write") throw new Error("Write denied");
      content = value;
    }),
  };
}
function dispatch(
  target: Element,
  type: "copy" | "cut" | "paste",
  clipboardData: ReturnType<typeof transfer> | null = transfer(),
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  fireEvent(target, event);
  return event;
}
it("captures the full persisted tree without changing state, history, revision or selection", () => {
  const { canvas } = editor(),
    before = useEditorStore.getState(),
    data = transfer();
  expect(dispatch(canvas, "copy", data).defaultPrevented).toBe(true);
  expect(data.setData).toHaveBeenCalledExactlyOnceWith(
    "text/plain",
    encodeSubtree(before.map!.root.children[0]),
  );
  expect(useEditorStore.getState()).toBe(before);
  expect(cut).not.toHaveBeenCalled();
  expect(paste).not.toHaveBeenCalled();
  expect(screen.getByText("Branch copied to clipboard.")).toBeVisible();
});
it.each(["c", "x", "v"])(
  "preserves native Ctrl/Cmd+%s keydown so the browser dispatches clipboard events",
  (key) => {
    const { canvas } = editor();
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }])
      expect(fireEvent.keyDown(canvas, { key, ...modifier })).toBe(true);
    expect(cut).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
  },
);
it("captures successfully before cutting and never requests delete confirmation", async () => {
  const { canvas } = editor(),
    data = transfer(),
    captured = structuredClone(useEditorStore.getState().map!.root.children[0]);
  cut.mockImplementation(async () => {
    expect(data.setData).toHaveBeenCalledOnce();
    return true;
  });
  const confirm = vi.spyOn(window, "confirm");
  await act(async () => {
    expect(dispatch(canvas, "cut", data).defaultPrevented).toBe(true);
  });
  expect(cut).toHaveBeenCalledExactlyOnceWith(captured.id, captured);
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByText("Branch cut to clipboard.")).toBeVisible();
});
it.each(["write failure", "missing clipboard", "silent write failure"])(
  "never cuts when capture fails: %s",
  (failure) => {
    const { canvas } = editor(),
      before = useEditorStore.getState();
    const data =
      failure === "missing clipboard"
        ? null
        : transfer(
            "unchanged",
            failure === "write failure" ? "write" : undefined,
          );
    if (failure === "silent write failure")
      data!.setData.mockImplementation(() => {});
    expect(dispatch(canvas, "cut", data).defaultPrevented).toBe(true);
    expect(cut).not.toHaveBeenCalled();
    expect(useEditorStore.getState()).toBe(before);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not cut branch");
  },
);
it("permits root copy and rejects root cut before any clipboard access", () => {
  const { canvas } = editor();
  act(() =>
    useEditorStore.setState({
      selectedNodeId: useEditorStore.getState().map!.root.id,
    }),
  );
  const data = transfer("Keep this");
  expect(dispatch(canvas, "cut", data).defaultPrevented).toBe(true);
  expect(data.setData).not.toHaveBeenCalled();
  expect(data.getData).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("root cannot be cut");
  expect(dispatch(canvas, "copy", data).defaultPrevented).toBe(true);
  expect(data.getData("text/plain")).toBe(
    encodeSubtree(useEditorStore.getState().map!.root),
  );
});
it("reads actual event data on every paste, creates disjoint IDs and targets the selected node", () => {
  const { canvas } = editor(),
    map = useEditorStore.getState().map!,
    data = transfer(encodeSubtree(map.root));
  expect(dispatch(canvas, "paste", data).defaultPrevented).toBe(true);
  expect(dispatch(canvas, "paste", data).defaultPrevented).toBe(true);
  const [a, b] = paste.mock.calls as unknown as [string, typeof map.root][];
  expect(a[0]).toBe(map.root.children[0].id);
  const ids = [...allNodes(map.root), ...allNodes(a[1]), ...allNodes(b[1])].map(
    (n) => n.id,
  );
  expect(new Set(ids).size).toBe(ids.length);
  expect(a[1].children[0].style).toEqual(map.root.children[0].style);
  expect(a[1].children[0].collapsed).toBe(true);
  data.setData("text/plain", "# Markdown replaced the clipboard");
  expect(dispatch(canvas, "paste", data).defaultPrevented).toBe(false);
  expect(paste).toHaveBeenCalledTimes(2);
});
it.each([
  '{"type":"maplora/subtree",',
  '{"type":"maplora/subtree","version":99}',
])("reports invalid Maplora payloads without pasting", (text) => {
  const { canvas } = editor();
  expect(dispatch(canvas, "paste", transfer(text)).defaultPrevented).toBe(true);
  expect(screen.getByRole("alert")).toHaveTextContent("Maplora subtree");
  expect(paste).not.toHaveBeenCalled();
});
it("reports clipboard read failure and never uses an earlier captured payload", () => {
  const { canvas } = editor();
  dispatch(canvas, "copy");
  expect(dispatch(canvas, "paste", transfer("", "read")).defaultPrevented).toBe(
    true,
  );
  expect(paste).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Read denied");
});
it.each([
  "saving",
  "error",
  "loading",
  "gone",
  "editing",
  "draft",
  "no selection",
  "stale selection",
])("leaves clipboard, focus and state alone while %s", (guard) => {
  const { canvas } = editor(),
    state = useEditorStore.getState();
  act(() =>
    useEditorStore.setState(
      guard === "saving"
        ? { saving: "saving" }
        : guard === "error"
          ? { saving: "error", error: "Pending failed change" }
          : guard === "loading"
            ? { loading: true }
            : guard === "gone"
              ? { gone: true }
              : guard === "editing"
                ? { editingNodeId: state.selectedNodeId }
                : guard === "draft"
                  ? { draft: { id: "draft", parentId: state.selectedNodeId! } }
                  : {
                      selectedNodeId:
                        guard === "no selection" ? null : "missing",
                    },
    ),
  );
  const before = useEditorStore.getState(),
    data = transfer(encodeSubtree(state.map!.root));
  for (const type of ["copy", "cut", "paste"] as const)
    expect(dispatch(canvas, type, data).defaultPrevented).toBe(false);
  expect(data.getData).not.toHaveBeenCalled();
  expect(data.setData).not.toHaveBeenCalled();
  expect(useEditorStore.getState()).toBe(before);
  expect(document.activeElement).toBe(canvas);
  expect(cut).not.toHaveBeenCalled();
  expect(paste).not.toHaveBeenCalled();
});
it.each([
  "input",
  "textarea",
  "contenteditable",
  "toolbar",
  "options",
  "help",
  "outside",
])(
  "preserves native clipboard in %s controls and inherited editable descendants",
  (kind) => {
    const { canvas } = editor();
    let target: HTMLElement;
    if (kind === "toolbar")
      target = screen.getByRole("button", { name: "Keyboard shortcuts" });
    else if (kind === "help") {
      fireEvent.click(
        screen.getByRole("button", { name: "Keyboard shortcuts" }),
      );
      target = screen.getByRole("button", { name: "Back to thinking" });
    } else if (kind === "contenteditable") {
      const parent = document.createElement("div");
      parent.setAttribute("contenteditable", "true");
      target = document.createElement("span");
      target.tabIndex = 0;
      parent.append(target);
      canvas.append(parent);
    } else {
      target = document.createElement(
        kind === "input" || kind === "textarea" ? kind : "div",
      );
      target.tabIndex = 0;
      if (kind === "options") target.className = "node-options";
      (kind === "outside" ? document.body : canvas).append(target);
    }
    target.focus();
    const data = transfer(encodeSubtree(useEditorStore.getState().map!.root)),
      before = useEditorStore.getState();
    for (const type of ["copy", "cut", "paste"] as const)
      expect(dispatch(target, type, data).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(target);
    expect(useEditorStore.getState()).toBe(before);
    expect(data.setData).not.toHaveBeenCalled();
    expect(data.getData).not.toHaveBeenCalled();
    if (kind === "outside") target.remove();
  },
);
it("preserves a nonempty DOM text selection and guards a dialog even if canvas focus is restored", () => {
  const { canvas } = editor(),
    text = document.createElement("span");
  text.textContent = "Native text";
  canvas.append(text);
  const range = document.createRange();
  range.selectNodeContents(text);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  expect(document.getSelection()!.toString()).toBe("Native text");
  const data = transfer();
  expect(dispatch(canvas, "cut", data).defaultPrevented).toBe(false);
  document.getSelection()!.removeAllRanges();
  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  canvas.focus();
  expect(dispatch(canvas, "cut", data).defaultPrevented).toBe(false);
  expect(data.setData).not.toHaveBeenCalled();
  expect(cut).not.toHaveBeenCalled();
});
it("blocks transfer while dragging and exposes documented complete-branch shortcuts", () => {
  const { canvas } = editor(),
    child = props.current.nodes.find(
      (n: any) => n.id === useEditorStore.getState().selectedNodeId,
    );
  act(() =>
    props.current.onNodeDragStart(
      new MouseEvent("mousedown", { clientX: 20, clientY: 20 }),
      child,
    ),
  );
  const data = transfer();
  expect(dispatch(canvas, "cut", data).defaultPrevented).toBe(false);
  expect(cut).not.toHaveBeenCalled();
  expect(data.setData).not.toHaveBeenCalled();
  fireEvent.keyDown(canvas, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  expect(screen.getByText("Paste branch as last child")).toBeVisible();
  expect(
    screen.getByText(/Branches include collapsed descendants/),
  ).toBeVisible();
});
it("cleans up handlers under StrictMode and suppresses late cut feedback after navigation", async () => {
  const { canvas, unmount } = editor();
  let finish!: (value: boolean) => void;
  cut.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  dispatch(canvas, "cut");
  expect(cut).toHaveBeenCalledTimes(1);
  const other = fixture();
  other.id = "12345678-1234-4234-8234-123456789099";
  act(() =>
    useEditorStore.setState({ map: other, selectedNodeId: other.root.id }),
  );
  await act(async () => {
    finish(true);
  });
  expect(
    screen.queryByText("Branch cut to clipboard."),
  ).not.toBeInTheDocument();
  unmount();
  expect(dispatch(canvas, "copy", transfer()).defaultPrevented).toBe(false);
});
