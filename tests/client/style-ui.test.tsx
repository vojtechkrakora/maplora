import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Position } from "@xyflow/react";
import {
  MindMapEdge,
  MindMapNode,
} from "../../src/client/components/MindMapCanvas";
import { NodeContextMenu } from "../../src/client/components/NodeContextMenu";
import { useEditorStore } from "../../src/client/stores/editorStore";
import { fixture } from "../fixtures";

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Handle: () => null,
  BaseEdge: (props: any) => (
    <path data-testid="connector" style={props.style} />
  ),
}));
const originalUpdate = useEditorStore.getState().updateNodeStyle;
beforeEach(() =>
  useEditorStore.setState({ map: fixture(), editingNodeId: null, draft: null }),
);
afterEach(() => useEditorStore.setState({ updateNodeStyle: originalUpdate }));
function panel(style = {}) {
  const node = { ...fixture().root, style };
  const update = vi.fn().mockResolvedValue(true);
  const close = vi.fn();
  useEditorStore.setState({ updateNodeStyle: update });
  const view = render(
    <NodeContextMenu node={node} root={false} onClose={close} />,
  );
  return {
    node,
    update,
    close,
    unmount: view.unmount,
    user: userEvent.setup(),
  };
}
it("previews all controls locally and saves one patch only when applied", async () => {
  const { update, close, node, user } = panel();
  expect(screen.getByLabelText("Background color")).toHaveAttribute(
    "type",
    "color",
  );
  for (const [label, value] of [
    ["Background color", "#ff0066"],
    ["Text color", "#0022cc"],
    ["Connector color", "#33cc55"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await user.selectOptions(screen.getByLabelText("Line style"), "dashed");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "8" } });
  expect(
    screen.getByLabelText("Style preview").querySelector(".mind-node"),
  ).toHaveStyle({ backgroundColor: "#ff0066", color: "#0022cc" });
  expect(
    screen.getByLabelText("Style preview").querySelector("path"),
  ).toHaveStyle({
    stroke: "#33cc55",
    strokeWidth: 8,
    strokeDasharray: "32 16",
  });
  expect(update).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Apply style" }));
  expect(update).toHaveBeenCalledExactlyOnceWith(node.id, {
    backgroundColor: "#ff0066",
    textColor: "#0022cc",
    connectorColor: "#33cc55",
    connectorStyle: "dashed",
    connectorWidth: 8,
  });
  expect(close).toHaveBeenCalledOnce();
});
it("cancels pending changes with Escape without saving", async () => {
  const { update, close, user } = panel();
  fireEvent.change(screen.getByLabelText("Background color"), {
    target: { value: "#ff0000" },
  });
  screen.getByLabelText("Background color").focus();
  await user.keyboard("{Escape}");
  expect(close).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
});
it("clears overrides individually and restores theme defaults without persisting theme colors", async () => {
  const { node, update, user } = panel({
    backgroundColor: "#112233",
    connectorWidth: 8,
    connectorStyle: "dotted",
    borderColor: "#ff0000",
  });
  await user.click(
    screen.getByRole("button", { name: "Reset background color" }),
  );
  expect(
    screen.getByLabelText("Style preview").querySelector(".mind-node")!.style
      .backgroundColor,
  ).toBe("");
  await user.click(
    screen.getByRole("button", { name: "Restore theme defaults" }),
  );
  expect(screen.getByRole("slider")).toHaveValue("2");
  expect(screen.getByLabelText("Line style")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Apply style" }));
  expect(update).toHaveBeenCalledWith(node.id, {
    backgroundColor: undefined,
    textColor: undefined,
    borderColor: undefined,
    connectorColor: undefined,
    connectorStyle: undefined,
    connectorWidth: undefined,
  });
});
it("keeps a failed patch available to retry and prevents duplicate requests while saving", async () => {
  const { update, close, user } = panel();
  let release!: (saved: boolean) => void;
  update.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  fireEvent.change(screen.getByLabelText("Text color"), {
    target: { value: "#aabbcc" },
  });
  await user.click(screen.getByRole("button", { name: "Apply style" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getByLabelText("Text color")).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  release(false);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be saved",
  );
  await user.click(screen.getByRole("button", { name: "Apply style" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(update).toHaveBeenCalledTimes(2);
});
it("preserves canvas focus on opening and allows keyboard focus to leave the panel", async () => {
  const { user } = panel();
  expect(screen.getByLabelText("Background color")).not.toHaveFocus();
  render(<button>Outside panel</button>);
  screen.getByLabelText("Line style").focus();
  await user.tab();
  expect(screen.getByRole("slider")).toHaveFocus();
  screen.getByRole("button", { name: "Cancel" }).focus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Outside panel" })).toHaveFocus();
});
it("does not invoke a stale close callback after unmounting during a save", async () => {
  const { update, close, unmount, user } = panel();
  let release!: (saved: boolean) => void;
  update.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  fireEvent.change(screen.getByLabelText("Text color"), {
    target: { value: "#123456" },
  });
  await user.click(screen.getByRole("button", { name: "Apply style" }));
  // Switching selection unmounts the old panel while its save is still pending.
  unmount();
  release(true);
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(close).not.toHaveBeenCalled();
});
it("renders stored CSS node colors and removes inline overrides when reset", () => {
  const node = {
    ...fixture().root,
    style: {
      backgroundColor: "#123456",
      textColor: "white",
      borderColor: "#789abc",
    },
  };
  const props: any = {
    id: node.id,
    data: { node, root: false, side: "left" },
    selected: false,
  };
  const { container, rerender } = render(<MindMapNode {...props} />);
  expect(container.querySelector(".mind-node")).toHaveStyle({
    backgroundColor: "#123456",
    color: "rgb(255, 255, 255)",
    borderColor: "#789abc",
  });
  rerender(
    <MindMapNode
      {...props}
      data={{ ...props.data, node: { ...node, style: undefined } }}
    />,
  );
  expect(container.querySelector(".mind-node")!.getAttribute("style")).toBe("");
});
it.each(["solid", "dashed", "dotted"] as const)(
  "renders %s SVG connectors with color, thickness and a theme fallback",
  (line) => {
    const props: any = {
      id: "edge",
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 0,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        style: {
          connectorColor: "#ff0000",
          connectorWidth: 8,
          connectorStyle: line,
        },
      },
    };
    const { rerender } = render(
      <svg>
        <MindMapEdge {...props} />
      </svg>,
    );
    const edge = screen.getByTestId("connector");
    expect(edge).toHaveStyle({ stroke: "#ff0000", strokeWidth: 8 });
    expect(edge.style.strokeDasharray).toBe(
      line === "dashed" ? "32 16" : line === "dotted" ? "0 24" : "",
    );
    expect(edge.style.strokeLinecap).toBe(line === "dotted" ? "round" : "butt");
    rerender(
      <svg>
        <MindMapEdge {...props} data={undefined} />
      </svg>,
    );
    expect(edge).toHaveStyle({ stroke: "var(--edge)", strokeWidth: 2 });
    expect(edge.style.strokeDasharray).toBe("");
  },
);
