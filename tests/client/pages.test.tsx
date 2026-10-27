import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MapListPage } from "../../src/client/pages/MapListPage";
import { TrashPage } from "../../src/client/pages/TrashPage";
import { EditorPage } from "../../src/client/pages/EditorPage";
import { useMapListStore } from "../../src/client/stores/mapListStore";
import { fixture } from "../fixtures";
import { useThemeStore } from "../../src/client/stores/themeStore";
vi.mock("../../src/client/components/MindMapCanvas", async () => {
  const { useEditorStore } =
    await import("../../src/client/stores/editorStore");
  return {
    MindMapCanvas: () => <div>{useEditorStore((s) => s.map?.root.text)}</div>,
  };
});
const handlers = setupServer();
const nativeFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (input, init) =>
    nativeFetch(
      typeof input === "string"
        ? new URL(input, "http://localhost:3000")
        : input,
      init,
    );
  handlers.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  handlers.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  handlers.close();
  globalThis.fetch = nativeFetch;
});
beforeEach(() => {
  useThemeStore.setState({ theme: "light" });
  useMapListStore.setState({
    maps: [], loading: false, error: null,
    searchQuery: "", sortOrder: "updatedAt_desc",
  });
});
it("offers the theme toggle in the library without creating or saving maps", async () => {
  handlers.use(http.get("*/api/maps", () => HttpResponse.json([])));
  const user = userEvent.setup();
  app();
  await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("maplora-theme")).toBe("dark");
  expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
});
function app(url = "/") {
  return render(
    <MemoryRouter
      initialEntries={[url]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<MapListPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/maps/:mapId" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const map = fixture(),
  summary = { id: map.id, title: map.title, updatedAt: map.updatedAt };
it("shows the empty state and validates creation before opening the new editor", async () => {
  handlers.use(
    http.get("*/api/maps", () => HttpResponse.json([])),
    http.post("*/api/maps", () => HttpResponse.json(summary, { status: 201 })),
    http.get("*/api/maps/:id", () => HttpResponse.json(map)),
  );
  const user = userEvent.setup();
  app();
  await user.click(
    await screen.findByRole("button", { name: "Create your first mind map" }),
  );
  await user.click(screen.getByRole("button", { name: "Create map" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("1–100");
  await user.type(screen.getByLabelText("Map title"), "A new idea");
  await user.click(screen.getByRole("button", { name: "Create map" }));
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Your mind, mapped." })).not.toBeInTheDocument(),
  );
  expect(await screen.findByText(map.root.text)).toBeInTheDocument();
});
it("renders cards including corrupt entries and validates and saves rename", async () => {
  handlers.use(
    http.get("*/api/maps", () =>
      HttpResponse.json([
        summary,
        { id: "bad", title: "bad.json", error: true },
      ]),
    ),
    http.patch("*/api/maps/:id/title", () =>
      HttpResponse.json({ ...summary, title: "Renamed" }),
    ),
  );
  const user = userEvent.setup();
  app();
  expect(await screen.findByText("bad.json")).toBeInTheDocument();
  expect(screen.getByText("⚠ File could not be read")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: `Rename ${summary.title}` }),
  );
  expect(screen.getByLabelText("Map title")).toHaveValue(summary.title);
  await user.clear(screen.getByLabelText("Map title"));
  await user.type(screen.getByLabelText("Map title"), " ".repeat(3));
  await user.click(screen.getByRole("button", { name: "Rename map" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Map title"));
  await user.type(screen.getByLabelText("Map title"), "Renamed");
  await user.click(screen.getByRole("button", { name: "Rename map" }));
  expect(
    await screen.findByRole("heading", { name: "Renamed" }),
  ).toBeInTheDocument();
});
it("retains the card when deletion is cancelled and removes it when confirmed", async () => {
  handlers.use(
    http.get("*/api/maps", () => HttpResponse.json([summary])),
    http.delete(
      "*/api/maps/:id",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false),
    user = userEvent.setup();
  app();
  const button = await screen.findByRole("button", {
    name: `Delete ${summary.title}`,
  });
  await user.click(button);
  expect(
    screen.getByRole("heading", { name: summary.title }),
  ).toBeInTheDocument();
  confirm.mockReturnValue(true);
  await user.click(button);
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: summary.title }),
    ).not.toBeInTheDocument(),
  );
});
it("adds a duplicate card without refetching the list or leaving the page", async () => {
  const copy = {
    ...summary,
    id: "12345678-1234-4234-8234-123456789099",
    title: `${summary.title} (Copy)`,
  };
  const list = vi.fn(() =>
    HttpResponse.json([summary, { id: "bad", title: "bad.json", error: true }]),
  );
  let release!: () => void;
  const responseReady = new Promise<void>((resolve) => { release = resolve; });
  const duplicate = vi.fn(async () => {
    await responseReady;
    return HttpResponse.json(copy, { status: 201 });
  });
  handlers.use(
    http.get("*/api/maps", list),
    http.post("*/api/maps/:id/duplicate", duplicate),
  );
  const user = userEvent.setup();
  app();
  await user.click(await screen.findByRole("button", { name: `Duplicate ${summary.title}` }));
  const button = screen.getByRole("button", { name: `Duplicate ${summary.title}` });
  expect(button).toBeDisabled();
  await user.click(button);
  release();
  expect(await screen.findByRole("heading", { name: copy.title })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: summary.title })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Duplicate bad.json" })).toBeDisabled();
  expect(useMapListStore.getState().maps[0]).toEqual(copy);
  expect(list).toHaveBeenCalledTimes(1);
  expect(duplicate).toHaveBeenCalledTimes(1);
});
it("shows duplicate write failures, keeps the source card and allows retry", async () => {
  let fail = true;
  handlers.use(
    http.get("*/api/maps", () => HttpResponse.json([summary])),
    http.post("*/api/maps/:id/duplicate", () => fail
      ? HttpResponse.json({ error: "Disk unavailable", code: "INTERNAL_ERROR" }, { status: 500 })
      : HttpResponse.json({ ...summary, id: "copy", title: `${summary.title} (Copy)` }, { status: 201 })),
  );
  const user = userEvent.setup();
  app();
  await user.click(await screen.findByRole("button", { name: `Duplicate ${summary.title}` }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Disk unavailable");
  expect(useMapListStore.getState().maps).toEqual([summary]);
  fail = false;
  await user.click(screen.getByRole("button", { name: `Duplicate ${summary.title}` }));
  expect(await screen.findByRole("heading", { name: `${summary.title} (Copy)` })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("keeps create dialog open and shows a server write error", async () => {
  handlers.use(
    http.get("*/api/maps", () => HttpResponse.json([])),
    http.post("*/api/maps", () =>
      HttpResponse.json(
        { error: "Disk unavailable", code: "INTERNAL_ERROR" },
        { status: 500 },
      ),
    ),
  );
  const user = userEvent.setup();
  app();
  await user.click(await screen.findByRole("button", { name: "New mind map" }));
  await user.type(screen.getByLabelText("Map title"), "Test");
  await user.click(screen.getByRole("button", { name: "Create map" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Disk unavailable",
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("loads the editor and returns to the list with an error when a file cannot be read", async () => {
  handlers.use(
    http.get("*/api/maps/:id", () =>
      HttpResponse.json(
        { error: "Corrupt file", code: "INVALID_FILE" },
        { status: 400 },
      ),
    ),
    http.get("*/api/maps", () => HttpResponse.json([])),
  );
  app(`/maps/${map.id}`);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be read",
  );
  expect(
    screen.getByRole("heading", { name: "Your mind, mapped." }),
  ).toBeInTheDocument();
});
it("restores confirmed trash entries and shows an empty state", async () => {
  handlers.use(
    http.get("*/api/trash", () => HttpResponse.json([summary])),
    http.post("*/api/trash/:id/restore", () =>
      HttpResponse.json({ restored: true }),
    ),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const user = userEvent.setup();
  app("/trash");
  await user.click(await screen.findByRole("button", { name: "Restore" }));
  expect(await screen.findByText("Your trash is empty.")).toBeInTheDocument();
});
it("requires confirmation before emptying trash", async () => {
  const empty = vi.fn();
  handlers.use(
    http.get("*/api/trash", () => HttpResponse.json([summary])),
    http.delete("*/api/trash", () => {
      empty();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false),
    user = userEvent.setup();
  app("/trash");
  await screen.findByRole("button", { name: "Restore" });
  await user.click(screen.getByRole("button", { name: "Empty Trash" }));
  expect(empty).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Empty Trash" }));
  expect(await screen.findByText("Your trash is empty.")).toBeInTheDocument();
});
it("opens a map immediately after returning from an earlier load failure", async () => {
  let reads = 0;
  handlers.use(
    http.get("*/api/maps/:id", () =>
      ++reads === 1
        ? HttpResponse.json(
            { error: "Temporarily unavailable", code: "NOT_FOUND" },
            { status: 404 },
          )
        : HttpResponse.json(map),
    ),
    http.get("*/api/maps", () => HttpResponse.json([summary])),
  );
  const user = userEvent.setup();
  app(`/maps/${map.id}`);
  await screen.findByRole("alert");
  await user.click(
    screen.getByRole("link", { name: new RegExp(summary.title) }),
  );
  expect(await screen.findByText(map.root.text)).toBeInTheDocument();
  expect(reads).toBe(2);
});
