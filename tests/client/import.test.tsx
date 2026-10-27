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
import { fixture } from "../fixtures";

const server = setupServer();
const nativeFetch = globalThis.fetch;
const existing = {
  id: "existing",
  title: "Existing",
  updatedAt: "2026-01-01T00:00:00Z",
};
const summary = {
  id: "new",
  title: fixture().title,
  updatedAt: fixture().updatedAt,
};
const list = vi.fn(() => HttpResponse.json([existing]));
const imported = vi.fn(() => HttpResponse.json(summary, { status: 201 }));
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
  list.mockClear();
  imported.mockClear();
  localStorage.clear();
  useMapListStore.setState({
    maps: [],
    loading: false,
    error: null,
    searchQuery: "",
    sortOrder: "title_asc",
  });
  server.use(
    http.get("*/api/maps", list),
    http.post("*/api/maps/import", imported),
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
async function app() {
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <MapListPage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Existing" });
  return userEvent.setup();
}
const file = (content = JSON.stringify(fixture())) =>
  new File([content], "map.json", { type: "application/json" });
const input = () => screen.getByLabelText("Import JSON file");
it("imports via FileReader, reveals the new card, clears a pending filter and retains sorting without refetching", async () => {
  const user = await app();
  let body: unknown;
  server.use(
    http.post("*/api/maps/import", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json(summary, { status: 201 });
    }),
  );
  await user.type(screen.getByRole("searchbox"), "missing");
  await screen.findByRole("heading", { name: "No results for “missing”" });
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "pending" },
  });
  await user.upload(input(), file());
  await screen.findByRole("heading", { name: summary.title });
  expect(body).toEqual(fixture());
  expect(screen.getByRole("heading", { name: "Existing" })).toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(screen.getByRole("combobox")).toHaveValue("title_asc");
  await act(() => new Promise((resolve) => setTimeout(resolve, 70)));
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(screen.getByText(`Imported “${summary.title}”.`)).toBeInTheDocument();
  expect(list).toHaveBeenCalledTimes(1);
});
it.each([
  ["{", "parsed as JSON"],
  [JSON.stringify({ ...fixture(), schemaVersion: 42 }), "42"],
  [JSON.stringify({ ...fixture(), root: null }), "map schema"],
])(
  "shows validation errors before sending any request",
  async (content, message) => {
    const user = await app();
    await user.upload(input(), file(content));
    expect(
      await screen.findByRole("dialog", { name: "Could not import map" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(imported).not.toHaveBeenCalled();
    expect(useMapListStore.getState().maps).toEqual([existing]);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);
it("keeps the library intact on a server error and allows retrying the same file", async () => {
  const user = await app(),
    upload = file();
  imported.mockImplementationOnce(() =>
    HttpResponse.json(
      { error: "Disk is full", code: "INTERNAL_ERROR" },
      { status: 500 },
    ),
  );
  await user.upload(input(), upload);
  expect(await screen.findByRole("alert")).toHaveTextContent("Disk is full");
  expect(useMapListStore.getState().maps).toEqual([existing]);
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.upload(input(), upload);
  await screen.findByRole("heading", { name: summary.title });
  expect(imported).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenCalledTimes(1);
});
it("does nothing when the picker is cancelled and prevents duplicate submissions while importing", async () => {
  const user = await app();
  fireEvent.change(input(), { target: { files: [] } });
  expect(imported).not.toHaveBeenCalled();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post("*/api/maps/import", async () => {
      imported();
      await wait;
      return HttpResponse.json(summary, { status: 201 });
    }),
  );
  await user.upload(input(), file());
  await waitFor(() => expect(imported).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
  fireEvent.change(input(), { target: { files: [file()] } });
  release();
  await screen.findByRole("heading", { name: summary.title });
  expect(imported).toHaveBeenCalledTimes(1);
});
it("disables import until the initial library fetch finishes so it cannot overwrite the new card", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get("*/api/maps", async () => {
      await wait;
      return HttpResponse.json([existing]);
    }),
  );
  render(
    <MemoryRouter>
      <MapListPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "Import JSON" })).toBeDisabled();
  release();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeEnabled(),
  );
});
