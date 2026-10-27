import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MindMapNode } from "../../src/client/components/MindMapCanvas";
import { useEditorStore } from "../../src/client/stores/editorStore";
import { fixture } from "../fixtures";
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Handle: () => null,
}));
const map = fixture();
beforeEach(() =>
  useEditorStore.setState({
    map: structuredClone(map),
    editingNodeId: null,
    draft: null,
    selectedNodeId: map.root.id,
  }),
);
function node() {
  return render(
    <MindMapNode
      {...({
        id: map.root.id,
        data: { node: map.root, root: true, side: "right", remove: vi.fn() },
        selected: true,
      } as any)}
    />,
  );
}
it("edits on double click, rejects blank text, and cancels with Escape", async () => {
  const user = userEvent.setup();
  node();
  await user.dblClick(screen.getByText(map.root.text));
  const input = await screen.findByRole("textbox", { name: "Node text" });
  expect(input).toHaveFocus();
  await user.clear(input);
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent("1–200");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(useEditorStore.getState().map!.root.text).toBe(map.root.text);
});
it("confirms valid text on Enter", async () => {
  const edit = vi.fn().mockImplementation(async () => {
    useEditorStore.setState({ editingNodeId: null });
    return true;
  });
  const original = useEditorStore.getState().editNodeText;
  useEditorStore.setState({ editNodeText: edit });
  const user = userEvent.setup();
  node();
  await user.dblClick(screen.getByText(map.root.text));
  const input = screen.getByRole("textbox");
  await user.clear(input);
  await user.type(input, "Updated{Enter}");
  await waitFor(() =>
    expect(edit).toHaveBeenCalledWith(map.root.id, "Updated"),
  );
  useEditorStore.setState({ editNodeText: original });
});
