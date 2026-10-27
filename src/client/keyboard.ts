import type { EditorState } from "./stores/editorStore";
import { findNode, findParent } from "../shared/tree.js";
export function handleEditorKey(
  event: Pick<
    KeyboardEvent,
    "key" | "target" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault"
  >,
  store: EditorState,
  remove: (id: string) => void,
  showHelp: () => void,
) {
  if (
    (event.target as HTMLElement)?.closest?.(
      "input,textarea,select,[contenteditable=true],[role=dialog]",
    ) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  const { map, selectedNodeId: id } = store;
  if (event.key === "?") {
    event.preventDefault();
    showHelp();
    return;
  }
  if (event.key === "Escape") {
    store.cancelEdit();
    return;
  }
  if (!map || !id) return;
  const node = findNode(map.root, id),
    parent = findParent(map.root, id);
  if (!node) return;
  const keys = [
    "Tab",
    "Insert",
    "Enter",
    "Delete",
    "Backspace",
    "F2",
    " ",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  switch (event.key) {
    case "Tab":
    case "Insert":
      store.addNode(id);
      break;
    case "Enter":
      if (parent) store.addNode(parent.id, id);
      break;
    case "Delete":
    case "Backspace":
      remove(id);
      break;
    case "F2":
      store.beginEdit(id);
      break;
    case " ":
      void store.toggleCollapse(id);
      break;
    case "ArrowLeft":
      if (parent) store.select(parent.id);
      break;
    case "ArrowRight":
      if (node.children.length && !node.collapsed)
        store.select(node.children[0].id);
      break;
    case "ArrowUp":
    case "ArrowDown": {
      const siblings = parent?.children ?? [],
        index = siblings.findIndex((n) => n.id === id),
        next = siblings[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) store.select(next.id);
      break;
    }
  }
}
