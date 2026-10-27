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
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MapListPage } from "../../src/client/pages/MapListPage";
import { useMapListStore } from "../../src/client/stores/mapListStore";

const maps = [
  { id: "z", title: "Zebra plan", updatedAt: "2026-01-02T00:00:00Z" },
  { id: "a", title: "Alpha plan", updatedAt: "2026-01-01T00:00:00Z" },
  { id: "b", title: "Beta", updatedAt: "2026-01-03T00:00:00Z" },
];
const server = setupServer();
const nativeFetch = globalThis.fetch;
const list = vi.fn(() => HttpResponse.json(maps));
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
  localStorage.clear();
  list.mockClear();
  server.use(http.get("*/api/maps", list));
  useMapListStore.setState({
    maps: [],
    loading: false,
    error: null,
    searchQuery: "",
    sortOrder: "updatedAt_desc",
  });
});
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
  globalThis.fetch = nativeFetch;
});
function app() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <MapListPage />
    </MemoryRouter>,
  );
}
const titles = () =>
  screen
    .queryAllByRole("article")
    .map((card) => card.querySelector("h2")?.textContent);
it("debounces keystrokes for 50ms and combines case-insensitive search with the current sort without requests", async () => {
  const user = userEvent.setup();
  app();
  await screen.findByRole("heading", { name: "Beta" });
  expect(titles()).toEqual(["Beta", "Zebra plan", "Alpha plan"]);
  vi.useFakeTimers();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search maps" }), {
    target: { value: "bet" },
  });
  act(() => vi.advanceTimersByTime(30));
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "PLAN" },
  });
  act(() => vi.advanceTimersByTime(49));
  expect(titles()).toHaveLength(3);
  act(() => vi.advanceTimersByTime(1));
  expect(titles()).toEqual(["Zebra plan", "Alpha plan"]);
  vi.useRealTimers();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Sort maps" }),
    "title_asc",
  );
  expect(titles()).toEqual(["Alpha plan", "Zebra plan"]);
  expect(screen.getByRole("status")).toHaveTextContent("2 matching maps");
  expect(list).toHaveBeenCalledTimes(1);
});
it("shows the query on no results, clears both the input and results and cancels a pending query", async () => {
  const user = userEvent.setup();
  app();
  await screen.findByRole("heading", { name: "Beta" });
  const input = screen.getByRole("searchbox");
  await user.type(input, "<missing>");
  expect(
    await screen.findByRole("heading", { name: "No results for “<missing>”" }),
  ).toBeInTheDocument();
  // An unapplied keystroke must not overwrite the explicit clear action.
  fireEvent.change(input, { target: { value: "pending" } });
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(input).toHaveValue("");
  expect(titles()).toHaveLength(3);
  await new Promise((resolve) => setTimeout(resolve, 70));
  expect(input).toHaveValue("");
  expect(titles()).toHaveLength(3);
  expect(list).toHaveBeenCalledTimes(1);
});
it("offers all four sorts, persists selection and keeps the preference across remounts", async () => {
  const user = userEvent.setup();
  const view = app();
  await screen.findByRole("heading", { name: "Beta" });
  const select = screen.getByRole("combobox", { name: "Sort maps" });
  expect(select).toHaveValue("updatedAt_desc");
  expect(screen.getAllByRole("option")).toHaveLength(4);
  for (const [order, expected] of [
    ["updatedAt_asc", ["Alpha plan", "Zebra plan", "Beta"]],
    ["title_asc", ["Alpha plan", "Beta", "Zebra plan"]],
    ["title_desc", ["Zebra plan", "Beta", "Alpha plan"]],
  ] as const) {
    await user.selectOptions(select, order);
    expect(titles()).toEqual(expected);
    expect(localStorage.getItem("maplora:sortOrder")).toBe(order);
  }
  view.unmount();
  app();
  await screen.findByRole("heading", { name: "Beta" });
  expect(screen.getByRole("combobox")).toHaveValue("title_desc");
  expect(titles()).toEqual(["Zebra plan", "Beta", "Alpha plan"]);
});
it("keeps controls mounted for an empty library and distinguishes it from no results", async () => {
  server.use(http.get("*/api/maps", () => HttpResponse.json([])));
  const user = userEvent.setup();
  app();
  await screen.findByRole("heading", { name: "Every idea starts somewhere." });
  const input = screen.getByRole("searchbox");
  await user.type(input, "Idea");
  await screen.findByRole("button", { name: "Clear search" });
  expect(screen.getByRole("searchbox")).toBe(input);
  expect(screen.getByRole("combobox")).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(
    screen.getByRole("heading", { name: "Every idea starts somewhere." }),
  ).toBeInTheDocument();
});
it("updates filtered cards when the in-memory library changes without refetching", async () => {
  const user = userEvent.setup();
  app();
  await screen.findByRole("heading", { name: "Beta" });
  await user.type(screen.getByRole("searchbox"), "plan");
  await waitFor(() => expect(titles()).toHaveLength(2));
  act(() =>
    useMapListStore.setState({ maps: [{ id: "new", title: "New plan" }] }),
  );
  expect(titles()).toEqual(["New plan"]);
  expect(list).toHaveBeenCalledTimes(1);
});
