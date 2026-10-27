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
    undo: vi.fn(),
    redo: vi.fn(),
    undoStack: [map],
    redoStack: [map],
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
  ["{Control>}z{/Control}", "undo", []],
  ["{Meta>}z{/Meta}", "undo", []],
  ["{Control>}{Shift>}z{/Shift}{/Control}", "redo", []],
  ["{Meta>}{Shift>}z{/Shift}{/Meta}", "redo", []],
  ["{Control>}y{/Control}", "redo", []],
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
it("ignores history shortcuts in native text fields and dialogs", async () => {
  const { store, user } = setup();
  await user.click(screen.getByLabelText("Node text"));
  await user.keyboard("{Control>}z{Shift>}z{/Shift}y{/Control}{Meta>}z{/Meta}");
  expect(store.undo).not.toHaveBeenCalled();
  expect(store.redo).not.toHaveBeenCalled();
  const input = screen.getByLabelText("Node text");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  input.parentElement!.append(dialog);
  handleEditorKey(
    {
      key: "z",
      target: dialog,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    },
    store,
    vi.fn(),
    vi.fn(),
  );
  expect(store.undo).not.toHaveBeenCalled();
});
it("allows history without a selection and does nothing for empty stacks or unrelated modifiers", async () => {
  const { store, user } = setup();
  store.selectedNodeId = null;
  await user.keyboard("{Control>}z{/Control}");
  expect(store.undo).toHaveBeenCalledTimes(1);
  store.undoStack = [];
  store.redoStack = [];
  await user.keyboard("{Control>}z{Shift>}z{/Shift}y{/Control}");
  await user.keyboard("{Control>}{Alt>}z{/Alt}{/Control}{Meta>}y{/Meta}");
  expect(store.undo).toHaveBeenCalledTimes(1);
  expect(store.redo).not.toHaveBeenCalled();
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
