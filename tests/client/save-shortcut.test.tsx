import { StrictMode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EditorPage } from "../../src/client/pages/EditorPage";
import { useEditorStore } from "../../src/client/stores/editorStore";
import { fixture } from "../fixtures";
import type { MapFile } from "../../src/shared/schema";

// Like the real node inputs, options and Dialog, these stop bubbling key events.
vi.mock("../../src/client/components/MindMapCanvas", () => ({
  MindMapCanvas: () => (
    <div aria-label="Mind map editor" tabIndex={0}>
      <input
        aria-label="Node text"
        onKeyDown={(event) => event.stopPropagation()}
      />
      <textarea
        aria-label="Notes"
        onKeyDown={(event) => event.stopPropagation()}
      />
      <aside onKeyDown={(event) => event.stopPropagation()}>
        <select aria-label="Line style">
          <option>Solid</option>
        </select>
      </aside>
      <div
        role="dialog"
        aria-label="Shortcuts"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button>Close shortcuts</button>
      </div>
      <Link to="/">Library</Link>
      <Link to="/maps/12345678-1234-4234-8234-123456789014">Other map</Link>
    </div>
  ),
}));

const server = setupServer();
const nativeFetch = globalThis.fetch;
const originalSaveMap = useEditorStore.getState().saveMap;
let disk: MapFile;
let writes: number;
beforeAll(() => {
  globalThis.fetch = (input, init) =>
    nativeFetch(
      typeof input === "string"
        ? new URL(input, "http://localhost:3000")
        : input,
      init,
    );
  server.listen({ onUnhandledRequest: "error" });
});
beforeEach(() => {
  disk = fixture();
  writes = 0;
  useEditorStore.setState({ saveMap: originalSaveMap });
  server.use(
    http.get("*/api/maps/:id", () => HttpResponse.json(disk)),
    http.put("*/api/maps/:id", async ({ request }) => {
      writes++;
      disk = {
        ...((await request.json()) as MapFile),
        revision: disk.revision + 1,
      };
      return HttpResponse.json(disk);
    }),
  );
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
  useEditorStore.setState({ saveMap: originalSaveMap });
});
afterAll(() => {
  server.close();
  globalThis.fetch = nativeFetch;
});
function app(strict = false) {
  const tree = (
    <MemoryRouter
      initialEntries={[`/maps/${disk.id}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/maps/:mapId" element={<EditorPage />} />
        <Route path="/" element={<h1>Library</h1>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}
function shortcut(target: EventTarget, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "s",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  const preventDefault = vi.spyOn(event, "preventDefault");
  act(() => {
    target.dispatchEvent(event);
  });
  return { event, preventDefault };
}

it.each([
  ["Ctrl+S", { ctrlKey: true }],
  ["Cmd+S", { ctrlKey: false, metaKey: true }],
  ["uppercase S", { key: "S" }],
])(
  "prevents the browser save dialog and calls saveMap on every %s activation",
  async (_name, keys) => {
    app();
    const canvas = await screen.findByLabelText("Mind map editor");
    const save = vi.fn().mockResolvedValue(true);
    act(() => useEditorStore.setState({ saveMap: save }));
    canvas.focus();
    for (let index = 0; index < 2; index++) {
      const { event, preventDefault } = shortcut(canvas, keys);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    }
    expect(save).toHaveBeenCalledTimes(2);
    expect(writes).toBe(0);
  },
);

it.each(["Node text", "Notes", "Line style", "Close shortcuts"])(
  "captures Ctrl+S when %s has focus and stops propagation",
  async (name) => {
    app();
    await screen.findByLabelText("Mind map editor");
    const save = vi.fn().mockResolvedValue(true);
    act(() => useEditorStore.setState({ saveMap: save }));
    const target =
      name === "Close shortcuts"
        ? screen.getByRole("button", { name })
        : screen.getByLabelText(name);
    target.focus();
    if (name === "Node text")
      fireEvent.change(target, { target: { value: "Unconfirmed text" } });
    const { event, preventDefault } = shortcut(target);
    expect(event.defaultPrevented).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(target).toHaveFocus();
    expect(disk.root.text).toBe(fixture().root.text);
    expect(writes).toBe(0);
    if (name === "Node text") expect(target).toHaveValue("Unconfirmed text");
  },
);

it("handles focus outside the canvas and preserves unfinished drafts", async () => {
  app();
  await screen.findByLabelText("Mind map editor");
  act(() => useEditorStore.getState().addNode(disk.root.id));
  const draft = useEditorStore.getState().draft;
  const save = vi.fn(originalSaveMap);
  act(() => useEditorStore.setState({ saveMap: save }));
  expect(shortcut(document.body).event.defaultPrevented).toBe(true);
  expect(save).toHaveBeenCalledOnce();
  expect(useEditorStore.getState().draft).toEqual(draft);
  expect(writes).toBe(0);
});

it("ignores ordinary typing and unrelated shortcuts", async () => {
  app();
  const canvas = await screen.findByLabelText("Mind map editor");
  const save = vi.fn().mockResolvedValue(true);
  act(() => useEditorStore.setState({ saveMap: save }));
  expect(shortcut(canvas, { ctrlKey: false }).event.defaultPrevented).toBe(
    false,
  );
  expect(shortcut(canvas, { key: "p" }).event.defaultPrevented).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it("prevents browser saving during loading without saving a different map", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const other = { ...fixture(), id: "12345678-1234-4234-8234-123456789014" };
  server.use(
    http.get(`*/api/maps/${other.id}`, async () => {
      await gate;
      return HttpResponse.json(other);
    }),
  );
  app();
  await screen.findByLabelText("Mind map editor");
  const save = vi.fn().mockResolvedValue(true);
  act(() => useEditorStore.setState({ saveMap: save }));
  fireEvent.click(screen.getByRole("link", { name: "Other map" }));
  await screen.findByRole("status");
  expect(shortcut(document).event.defaultPrevented).toBe(true);
  expect(save).not.toHaveBeenCalled();
  release();
  await screen.findByLabelText("Mind map editor");
  shortcut(document);
  expect(save).toHaveBeenCalledOnce();
  expect(useEditorStore.getState().map?.id).toBe(other.id);
});

it("skips duplicate saves in progress but still suppresses the browser dialog", async () => {
  app();
  await screen.findByLabelText("Mind map editor");
  const save = vi.fn().mockResolvedValue(true);
  act(() => useEditorStore.setState({ saveMap: save, saving: "saving" }));
  expect(shortcut(document).event.defaultPrevented).toBe(true);
  expect(shortcut(document, { repeat: true }).event.defaultPrevented).toBe(
    true,
  );
  expect(save).not.toHaveBeenCalled();
  act(() => useEditorStore.setState({ saving: "idle" }));
  shortcut(document);
  expect(save).toHaveBeenCalledOnce();
});

it("retries a failed operation through the real queue once and persists the changed map", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.put("*/api/maps/:id", async ({ request }) => {
      writes++;
      if (writes === 1)
        return HttpResponse.json({ error: "Unavailable" }, { status: 500 });
      await gate;
      disk = {
        ...((await request.json()) as MapFile),
        revision: disk.revision + 1,
      };
      return HttpResponse.json(disk);
    }),
  );
  app();
  await screen.findByLabelText("Mind map editor");
  await act(async () => {
    expect(
      await useEditorStore
        .getState()
        .editNodeText(disk.root.id, "Recovered change"),
    ).toBe(false);
  });
  expect(useEditorStore.getState().saving).toBe("error");
  expect(useEditorStore.getState().map?.root.text).toBe(fixture().root.text);
  expect(shortcut(document).event.defaultPrevented).toBe(true);
  await waitFor(() => expect(writes).toBe(2));
  expect(useEditorStore.getState().saving).toBe("saving");
  for (let index = 0; index < 3; index++)
    expect(shortcut(document).event.defaultPrevented).toBe(true);
  expect(writes).toBe(2);
  release();
  await waitFor(() => expect(useEditorStore.getState().saving).toBe("idle"));
  expect(useEditorStore.getState().error).toBeNull();
  expect(disk.root.text).toBe("Recovered change");
  expect(disk.revision).toBe(2);
  shortcut(document);
  expect(writes).toBe(2);
});

it("removes the listener on unmount", async () => {
  const { unmount } = app();
  await screen.findByLabelText("Mind map editor");
  const save = vi.fn().mockResolvedValue(true);
  act(() => useEditorStore.setState({ saveMap: save }));
  unmount();
  expect(shortcut(document).event.defaultPrevented).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it("registers only one listener in StrictMode and restores native saving in the library", async () => {
  app(true);
  const canvas = await screen.findByLabelText("Mind map editor");
  const save = vi.fn().mockResolvedValue(true);
  act(() => useEditorStore.setState({ saveMap: save }));
  shortcut(canvas);
  expect(save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("link", { name: "Library" }));
  await screen.findByRole("heading", { name: "Library" });
  expect(shortcut(document).event.defaultPrevented).toBe(false);
  expect(save).toHaveBeenCalledOnce();
});
