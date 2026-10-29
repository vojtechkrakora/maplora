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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EditorPage } from "../../src/client/pages/EditorPage";
import { RecentMapsBar } from "../../src/client/components/RecentMapsBar";
import {
  addRecentMap,
  getRecentMaps,
  useRecentMapsStore,
} from "../../src/client/recentMapsStore";
import { useEditorStore } from "../../src/client/stores/editorStore";
import { useMapListStore } from "../../src/client/stores/mapListStore";
import { fixture } from "../fixtures";
import type { MapFile, MapSummary } from "../../src/shared/schema";

vi.mock("../../src/client/components/MindMapCanvas", async () => {
  const { useEditorStore } =
    await import("../../src/client/stores/editorStore");
  const { RecentMapsBar } =
    await import("../../src/client/components/RecentMapsBar");
  return {
    MindMapCanvas: () => {
      const map = useEditorStore((state) => state.map)!;
      return (
        <div>
          <h1>{map.title}</h1>
          <Link to="/">Library</Link>
          <RecentMapsBar currentMapId={map.id} />
        </div>
      );
    },
  };
});
const server = setupServer();
const nativeFetch = globalThis.fetch;
let maps: MapFile[];
let reads: string[];
let writes: number;
function summary(map: MapFile): MapSummary {
  return {
    id: map.id,
    title: map.title,
    tags: map.tags,
    updatedAt: map.updatedAt,
  };
}
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
  maps = Array.from({ length: 7 }, (_, index) => ({
    ...fixture(),
    id: `12345678-1234-4234-8234-${String(index).padStart(12, "0")}`,
    title: `Map ${index}`,
  }));
  reads = [];
  writes = 0;
  useRecentMapsStore.setState({ maps: [] });
  useMapListStore.setState({ maps: [], loading: false, error: null });
  server.use(
    http.get("*/api/maps", () => HttpResponse.json(maps.map(summary))),
    http.get("*/api/maps/:id", ({ params }) => {
      reads.push(params.id as string);
      const map = maps.find((map) => map.id === params.id);
      return map
        ? HttpResponse.json(map)
        : HttpResponse.json(
            { error: "Not found", code: "NOT_FOUND" },
            { status: 404 },
          );
    }),
    http.delete("*/api/maps/:id", ({ params }) => {
      writes++;
      maps = maps.filter((map) => map.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch("*/api/maps/:id/title", async ({ params, request }) => {
      const { title } = (await request.json()) as { title: string };
      writes++;
      const map = maps.find((map) => map.id === params.id)!;
      map.title = title;
      return HttpResponse.json(summary(map));
    }),
  );
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
  globalThis.fetch = nativeFetch;
});
function Library() {
  const location = useLocation();
  return (
    <>
      <h1>Library</h1>
      {location.state?.error && <p role="alert">{location.state.error}</p>}
      {maps.map((map) => (
        <Link key={map.id} to={`/maps/${map.id}`}>
          {map.title}
        </Link>
      ))}
    </>
  );
}
function app(initial = "/", strict = false) {
  const tree = (
    <MemoryRouter
      initialEntries={[initial]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/maps/:mapId" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}
const bar = () =>
  screen.queryByRole("navigation", { name: "Recently opened maps" });
const recentTitles = () =>
  within(bar()!)
    .getAllByRole("link")
    .map((link) => link.textContent);
async function open(index: number) {
  fireEvent.click(
    screen.getByRole("link", { name: `Map ${index}`, exact: true }),
  );
  await screen.findByRole("heading", { name: `Map ${index}`, exact: true });
  await waitFor(() =>
    expect(useRecentMapsStore.getState().maps[0]?.id).toBe(maps[index].id),
  );
}
async function library() {
  fireEvent.click(screen.getByRole("link", { name: "Library", exact: true }));
  await screen.findByRole("heading", { name: "Library" });
}

it("tracks successful opens, hides the first empty bar and navigates between recent maps", async () => {
  app();
  await open(0);
  expect(bar()).not.toBeInTheDocument();
  await library();
  await open(1);
  expect(recentTitles()).toEqual(["Map 0"]);
  fireEvent.click(within(bar()!).getByRole("link", { name: "Map 0" }));
  await screen.findByRole("heading", { name: "Map 0" });
  await waitFor(() => expect(recentTitles()).toEqual(["Map 1"]));
  expect(reads).toEqual([maps[0].id, maps[1].id, maps[0].id]);
  expect(writes).toBe(0);
});

it("bounds history, excludes the current map and preserves full long titles", async () => {
  app();
  for (let index = 0; index < 6; index++) {
    await open(index);
    await library();
  }
  maps[6].title = "A very long recently opened map title ".repeat(2).trim();
  fireEvent.click(screen.getByRole("link", { name: "Map 6" }));
  await screen.findByRole("heading", { name: maps[6].title });
  await waitFor(() =>
    expect(recentTitles()).toEqual(["Map 5", "Map 4", "Map 3", "Map 2"]),
  );
  fireEvent.click(within(bar()!).getByRole("link", { name: "Map 5" }));
  await screen.findByRole("heading", { name: "Map 5" });
  const long = await screen.findByRole("link", { name: maps[6].title });
  expect(long).toHaveAttribute("title", maps[6].title);
  expect(long).toHaveAttribute("href", `/maps/${maps[6].id}`);
  expect(
    within(bar()!).queryByRole("link", { name: "Map 5" }),
  ).not.toBeInTheDocument();
});

it("deduplicates successful StrictMode loads", async () => {
  app(`/maps/${maps[0].id}`, true);
  await screen.findByRole("heading", { name: "Map 0" });
  await waitFor(() => expect(getRecentMaps("other")).toHaveLength(1));
  expect(bar()).not.toBeInTheDocument();
});

it("ignores a late successful response after leaving an editor route", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get(`*/api/maps/${maps[0].id}`, async () => {
      await gate;
      return HttpResponse.json(maps[0]);
    }),
  );
  const { unmount } = app(`/maps/${maps[0].id}`);
  await screen.findByRole("status");
  unmount();
  release();
  await waitFor(() => expect(useEditorStore.getState().loading).toBe(false));
  expect(getRecentMaps("other")).toEqual([]);
});

it("removes locally deleted maps immediately, retaining history on failed deletion", async () => {
  app();
  await open(0);
  await library();
  await open(1);
  server.use(
    http.delete(
      `*/api/maps/${maps[0].id}`,
      () => HttpResponse.json({ error: "Disk full" }, { status: 500 }),
      { once: true },
    ),
  );
  await act(async () => {
    await expect(
      useMapListStore.getState().deleteMap(maps[0].id),
    ).rejects.toThrow("Disk full");
  });
  expect(recentTitles()).toEqual(["Map 0"]);
  await act(async () => {
    await useMapListStore.getState().deleteMap(maps[0].id);
  });
  expect(bar()).not.toBeInTheDocument();
});

it("refreshes titles after rename and prunes unavailable maps only after a successful library refresh", async () => {
  app();
  await open(0);
  await library();
  await open(1);
  await act(async () => {
    await useMapListStore.getState().renameMap(maps[0].id, "Renamed map");
  });
  expect(recentTitles()).toEqual(["Renamed map"]);
  maps = maps.slice(1);
  server.use(
    http.get(
      "*/api/maps",
      () => HttpResponse.json({ error: "Offline" }, { status: 500 }),
      { once: true },
    ),
  );
  await act(async () => {
    await useMapListStore.getState().fetchMaps();
  });
  expect(recentTitles()).toEqual(["Renamed map"]);
  await act(async () => {
    await useMapListStore.getState().fetchMaps();
  });
  expect(bar()).not.toBeInTheDocument();
});

it.each([404, 410])(
  "quietly removes a recent map if its open returns %i",
  async (status) => {
    app();
    await open(0);
    await library();
    await open(1);
    server.use(
      http.get(`*/api/maps/${maps[0].id}`, () =>
        HttpResponse.json({ error: "Gone", code: "NOT_FOUND" }, { status }),
      ),
    );
    fireEvent.click(within(bar()!).getByRole("link", { name: "Map 0" }));
    await screen.findByRole("heading", { name: "Library" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getRecentMaps("other").map((map) => map.id)).toEqual([maps[1].id]);
  },
);

it("retains normal load errors and never records an unsuccessful open", async () => {
  server.use(
    http.get(`*/api/maps/${maps[0].id}`, () =>
      HttpResponse.json({ error: "Offline" }, { status: 500 }),
    ),
  );
  app(`/maps/${maps[0].id}`);
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  expect(getRecentMaps("other")).toEqual([]);
});

it("preserves save errors if an already opened recent map is deleted during editing", async () => {
  app();
  await open(0);
  await library();
  await open(1);
  fireEvent.click(within(bar()!).getByRole("link", { name: "Map 0" }));
  await screen.findByRole("heading", { name: "Map 0" });
  await waitFor(() =>
    expect(useRecentMapsStore.getState().maps[0].id).toBe(maps[0].id),
  );
  act(() =>
    useEditorStore.setState({
      gone: true,
      error: "Change could not be saved: map was deleted",
      saving: "error",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Change could not be saved",
  );
  expect(getRecentMaps("other").map((map) => map.id)).toEqual([maps[1].id]);
});

it("keeps navigation disabled during a save and restores it after completion", async () => {
  addRecentMap(summary(maps[0]));
  addRecentMap(summary(maps[1]));
  useEditorStore.setState({ saving: "saving" });
  render(
    <MemoryRouter
      initialEntries={[`/maps/${maps[1].id}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <RecentMapsBar currentMapId={maps[1].id} />
      <Routes>
        <Route
          path={`/maps/${maps[0].id}`}
          element={<p>Recent destination</p>}
        />
        <Route path="*" element={<p>Current map</p>} />
      </Routes>
    </MemoryRouter>,
  );
  const link = within(bar()!).getByRole("link", { name: "Map 0" });
  expect(link).toHaveAttribute("aria-disabled", "true");
  expect(link).toHaveAttribute("tabindex", "-1");
  expect(fireEvent.click(link)).toBe(false);
  expect(screen.getByText("Current map")).toBeInTheDocument();
  act(() => useEditorStore.setState({ saving: "idle" }));
  expect(link).not.toHaveAttribute("aria-disabled");
  fireEvent.click(link);
  expect(screen.getByText("Recent destination")).toBeInTheDocument();
});

it("keeps recent-chip keyboard events out of canvas node shortcuts", async () => {
  addRecentMap(summary(maps[0]));
  useEditorStore.setState({ saving: "idle" });
  const canvasKey = vi.fn();
  render(
    <MemoryRouter>
      <div onKeyDown={canvasKey}>
        <RecentMapsBar currentMapId={maps[1].id} />
      </div>
    </MemoryRouter>,
  );
  const link = within(bar()!).getByRole("link", { name: "Map 0" });
  link.focus();
  const user = userEvent.setup();
  await user.keyboard("{Tab}");
  fireEvent.keyDown(link, { key: "Enter" });
  expect(canvasKey).not.toHaveBeenCalled();
});
