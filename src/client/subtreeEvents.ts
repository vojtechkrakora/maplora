import type { EditorState } from "./stores/editorStore";
import { findNode } from "../shared/tree.js";
import {
  decodeSubtree,
  encodeSubtree,
  remapSubtree,
  snapshotSubtree,
} from "./subtreeClipboard";

export interface ClipboardFeedback {
  message: string;
  error: boolean;
}
interface ClipboardEventData {
  type: string;
  target: EventTarget | null;
  clipboardData: Pick<DataTransfer, "getData" | "setData"> | null;
  preventDefault(): void;
}

// Synchronous native event data also works on ordinary HTTP LAN origins.
// No clipboard content is cached, and keydown never suppresses these events.
export function handleSubtreeClipboard(
  event: ClipboardEventData,
  canvas: HTMLElement,
  getState: () => EditorState,
  options: {
    mapId: string;
    dragging: boolean;
    feedback(value: ClipboardFeedback): void;
  },
): void {
  const doc = canvas.ownerDocument;
  const protectedTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest(
      "input,textarea,select,button,a,[contenteditable],[role=dialog],.editor-toolbar,.node-options,.node-tools,.zoom-tools,.shortcut-list",
    );
  if (
    !canvas.contains(doc.activeElement) ||
    protectedTarget(doc.activeElement) ||
    protectedTarget(event.target) ||
    doc.querySelector('[role="dialog"]') ||
    doc.getSelection()?.toString()
  )
    return;
  const s = getState();
  if (
    !s.map ||
    s.map.id !== options.mapId ||
    s.loading ||
    s.gone ||
    s.saving !== "idle" ||
    s.error ||
    s.draft ||
    s.editingNodeId ||
    options.dragging ||
    !s.selectedNodeId
  )
    return;
  const node = findNode(s.map.root, s.selectedNodeId);
  if (!node) return;
  const feedback = (message: string, error = false) =>
    options.feedback({ message, error });
  if (event.type === "cut" && node === s.map.root) {
    event.preventDefault();
    feedback("The root cannot be cut. Copy it instead.", true);
    return;
  }
  try {
    if (!event.clipboardData) throw new Error("Clipboard data is unavailable.");
    if (event.type === "copy" || event.type === "cut") {
      const snapshot = snapshotSubtree(node);
      const text = encodeSubtree(snapshot);
      event.clipboardData.setData("text/plain", text);
      if (event.clipboardData.getData("text/plain") !== text)
        throw new Error("The clipboard did not accept the branch.");
      event.preventDefault();
      if (event.type === "copy") feedback("Branch copied to clipboard.");
      else {
        feedback("Branch captured in clipboard. Saving its removal…");
        void s
          .cutSubtree(node.id, snapshot)
          .then((saved) => {
            if (saved) feedback("Branch cut to clipboard.");
          })
          .catch((error: Error) =>
            feedback(`Branch was not removed: ${error.message}`, true),
          );
      }
    } else if (event.type === "paste") {
      const payload = decodeSubtree(event.clipboardData.getData("text/plain"));
      if (payload.kind === "unrelated") return;
      event.preventDefault();
      if (payload.kind === "invalid") feedback(payload.message, true);
      else {
        const subtree = remapSubtree(payload.root, s.map.root);
        void s
          .pasteSubtree(node.id, subtree)
          .catch((error: Error) =>
            feedback(`Branch could not be pasted: ${error.message}`, true),
          );
      }
    }
  } catch (error) {
    event.preventDefault();
    feedback(
      `Could not ${event.type} branch: ${(error as Error).message}`,
      true,
    );
  }
}
