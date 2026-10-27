import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { handleEditorKey } from "../../src/client/keyboard";
import type { EditorState } from "../../src/client/stores/editorStore";
import { fixture } from "../fixtures";
function setup(selected = "child") {
  const map = fixture();
  map.root.children = ["first", "child", "last"].map((id) => ({
    id,
    text: id,
    collapsed: false,
    children: [],
  }));
  map.root.children[1].children = [
    { id: "grandchild", text: "Grandchild", children: [], collapsed: false },
  ];
  const store = {
    map,
    selectedNodeId: selected,
    addNode: vi.fn(),
    beginEdit: vi.fn(),
    toggleCollapse: vi.fn(),
    cancelEdit: vi.fn(),
    select: vi.fn(),
    reorderNode: vi.fn(),
  } as unknown as EditorState;
  const remove = vi.fn(),
    help = vi.fn();
  render(
    <div
      tabIndex={0}
      aria-label="Canvas"
      onKeyDown={(e) => handleEditorKey(e.nativeEvent, store, remove, help)}
    >
      <input aria-label="Node text" />
    </div>,
  );
  screen.getByLabelText("Canvas").focus();
  return { store, remove, help, user: userEvent.setup() };
}
it.each([
  ["{Tab}", "addNode", ["child"]],
  ["{Insert}", "addNode", ["child"]],
  ["{Enter}", "addNode", [fixture().root.id, "child"]],
  ["{F2}", "beginEdit", ["child"]],
  [" ", "toggleCollapse", ["child"]],
  ["{ArrowUp}", "select", ["first"]],
  ["{ArrowDown}", "select", ["last"]],
  ["{ArrowLeft}", "select", [fixture().root.id]],
  ["{ArrowRight}", "select", ["grandchild"]],
  ["{Escape}", "cancelEdit", []],
  ["{Alt>}{ArrowUp}{/Alt}", "reorderNode", ["child", 0]],
  ["{Alt>}{ArrowDown}{/Alt}", "reorderNode", ["child", 2]],
])("routes %s to the expected node action", async (key, action, args) => {
  const { store, user } = setup();
  await user.keyboard(key as string);
  expect(store[action as keyof EditorState]).toHaveBeenCalledWith(...args);
});
it("routes delete, backspace and shortcut help", async () => {
  const { user, remove, help } = setup();
  await user.keyboard("{Delete}{Backspace}?");
  expect(remove).toHaveBeenCalledTimes(2);
  expect(help).toHaveBeenCalledTimes(1);
});
it("does not add a sibling or delete the root through its handler", async () => {
  const { user, store } = setup(fixture().root.id);
  await user.keyboard("{Enter}");
  expect(store.addNode).not.toHaveBeenCalled();
  await user.keyboard("{Alt>}{ArrowUp}{ArrowDown}{/Alt}");
  expect(store.reorderNode).not.toHaveBeenCalled();
});
it("ignores node shortcuts while typing", async () => {
  const { store, user, remove } = setup();
  await user.click(screen.getByLabelText("Node text"));
  await user.keyboard(
    "text {ArrowUp}{ArrowDown}{ArrowLeft}{ArrowRight}{Backspace}{Delete}{Insert}{F2}",
  );
  expect(store.addNode).not.toHaveBeenCalled();
  expect(store.select).not.toHaveBeenCalled();
  expect(store.beginEdit).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  await user.keyboard("{Alt>}{ArrowUp}{ArrowDown}{/Alt}");
  expect(store.reorderNode).not.toHaveBeenCalled();
});
