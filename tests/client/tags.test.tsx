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
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MapListPage } from "../../src/client/pages/MapListPage";
import { useMapListStore } from "../../src/client/stores/mapListStore";
import { tagColor } from "../../src/client/tagColor";
import { fixture } from "../fixtures";
import type { MapSummary } from "../../src/shared/schema";
const originals: MapSummary[] = [
  {
    id: "a",
    title: "Alpha plan",
    updatedAt: "2026-01-01T00:00:00Z",
    tags: ["work", "Research"],
  },
  {
    id: "b",
    title: "Beta plan",
    updatedAt: "2026-01-02T00:00:00Z",
    tags: ["work", "home"],
  },
  {
    id: "c",
    title: "Cedar",
    updatedAt: "2026-01-03T00:00:00Z",
    tags: ["Research"],
  },
  { id: "d", title: "Draft", tags: [] },
];
let maps: MapSummary[];
const server = setupServer();
const nativeFetch = globalThis.fetch;
const list = vi.fn(() => HttpResponse.json(maps));
const patch = vi.fn(async ({ request, params }: any) => {
  const { tags } = await request.json();
  const map = maps.find((map) => map.id === params.id)!;
  map.tags = tags;
  map.updatedAt = "2026-10-29T00:00:00Z";
  return HttpResponse.json(map);
});
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
  maps = structuredClone(originals);
  list.mockClear();
  patch.mockClear();
  useMapListStore.setState({
    maps: [],
    activeTags: [],
    searchQuery: "",
    sortOrder: "updatedAt_desc",
    loading: false,
    error: null,
  });
  server.use(
    http.get("*/api/maps", list),
    http.patch("*/api/maps/:id/tags", patch),
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
const app = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <MapListPage />
    </MemoryRouter>,
  );
const titles = () =>
  screen
    .queryAllByRole("article")
    .map((card) => card.querySelector("h2")?.textContent);
async function open(title = "Draft") {
  app();
  const button = await screen.findByRole("button", {
    name: `Manage tags for ${title}`,
  });
  const user = userEvent.setup();
  await user.click(button);
  return {
    user,
    dialog: screen.getByRole("dialog"),
    input: screen.getByRole("combobox", { name: "New tag" }),
  };
}
it("shares deterministic colors across cards, assigned tags and selected filter choices in both themes", async () => {
  app();
  await screen.findByRole("heading", { name: "Alpha plan" });
  const user = userEvent.setup();
  await user.click(screen.getByText("Filter by tags", { exact: true }));
  const chip = (title: string, tag: string) =>
    within(screen.getByRole("list", { name: `Tags for ${title}` })).getByText(
      tag,
    );
  function expectTagColor(element: HTMLElement, tag: string) {
    const { background, foreground } = tagColor(tag);
    expect(element).toHaveStyle({
      backgroundColor: background,
      color: foreground,
    });
  }
  const saved = structuredClone(useMapListStore.getState().maps);
  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset.theme = theme;
    expectTagColor(chip("Alpha plan", "work"), "work");
    expectTagColor(chip("Beta plan", "work"), "work");
    expectTagColor(chip("Alpha plan", "Research"), "Research");
    const filter = screen.getByRole("checkbox", { name: "work" });
    expectTagColor(filter.closest("label")!, "work");
    await user.click(filter);
    expect(filter).toBeChecked();
    expect(filter.closest("label")).toHaveClass("active");
    expectTagColor(filter.closest("label")!, "work");
    expect(titles()).toEqual(["Beta plan", "Alpha plan"]);
    await user.click(filter);
  }
  await user.click(
    screen.getByRole("button", { name: "Manage tags for Alpha plan" }),
  );
  for (const tag of ["work", "Research"])
    expectTagColor(
      within(screen.getByRole("list", { name: "Assigned tags" }))
        .getByText(tag)
        .closest("li")!,
      tag,
    );
  delete document.documentElement.dataset.theme;
  expect(useMapListStore.getState().maps).toEqual(saved);
  expect(list).toHaveBeenCalledTimes(1);
  expect(patch).not.toHaveBeenCalled();
});

it("derives sorted unique tags and combines AND filtering with search and all sort options without requests", () => {
  useMapListStore.setState({ maps });
  const s = useMapListStore.getState();
  expect(s.allTags()).toEqual(["home", "Research", "work"]);
  s.setActiveTags(["work", "Research", "work"]);
  expect(useMapListStore.getState().activeTags).toEqual(["work", "Research"]);
  expect(s.filteredAndSortedMaps().map((m) => m.id)).toEqual(["a"]);
  s.setActiveTags(["work"]);
  s.setSearchQuery("PLAN");
  for (const [order, ids] of [
    ["updatedAt_desc", ["b", "a"]],
    ["updatedAt_asc", ["a", "b"]],
    ["title_asc", ["a", "b"]],
    ["title_desc", ["b", "a"]],
  ] as const) {
    s.setSortOrder(order);
    expect(s.filteredAndSortedMaps().map((m) => m.id)).toEqual(ids);
  }
  s.setActiveTags([]);
  s.setSearchQuery("");
  expect(s.filteredAndSortedMaps()).toHaveLength(4);
  expect(useMapListStore.getState().maps).toEqual(originals);
  expect(list).not.toHaveBeenCalled();
  expect(patch).not.toHaveBeenCalled();
});
it("keeps exact case in tag matching and derives tags from the full loaded library", () => {
  useMapListStore.setState({ maps });
  const s = useMapListStore.getState();
  s.setActiveTags(["WORK"]);
  expect(s.filteredAndSortedMaps()).toEqual([]);
  s.setSearchQuery("missing");
  expect(s.allTags()).toEqual(["home", "Research", "work"]);
  useMapListStore.setState({ maps: [] });
  expect(s.allTags()).toEqual([]);
});
it("updates only the saved summary without a list request or changing filters", async () => {
  useMapListStore.setState({
    maps: structuredClone(maps),
    activeTags: ["Research"],
    searchQuery: "plan",
    sortOrder: "title_asc",
  });
  await useMapListStore.getState().updateTags("a", ["Research", "new"]);
  expect(useMapListStore.getState()).toMatchObject({
    activeTags: ["Research"],
    searchQuery: "plan",
    sortOrder: "title_asc",
  });
  expect(useMapListStore.getState().maps[0].tags).toEqual(["Research", "new"]);
  expect(useMapListStore.getState().maps.slice(1)).toEqual(originals.slice(1));
  expect(list).not.toHaveBeenCalled();
  expect(patch).toHaveBeenCalledTimes(1);
});
it("rejects invalid tags before requesting and retains summaries on save failure", async () => {
  useMapListStore.setState({ maps: structuredClone(maps) });
  await expect(
    useMapListStore.getState().updateTags("a", ["bad,tag"]),
  ).rejects.toThrow();
  expect(patch).not.toHaveBeenCalled();
  server.use(
    http.patch("*/api/maps/:id/tags", () =>
      HttpResponse.json(
        { error: "Disk full", code: "FAILED" },
        { status: 500 },
      ),
    ),
  );
  await expect(
    useMapListStore.getState().updateTags("a", ["new"]),
  ).rejects.toThrow("Disk full");
  expect(useMapListStore.getState().maps).toEqual(originals);
});
it("adds and removes tags, updates cards and autocomplete immediately, and preserves map navigation", async () => {
  const { user, dialog, input } = await open();
  const suggestions = () =>
    Array.from((input as HTMLInputElement).list!.options).map(
      (option) => option.value,
    );
  expect(suggestions()).toEqual(["home", "Research", "work"]);
  await user.type(input, "re");
  expect(suggestions()).toEqual(["Research"]);
  await user.clear(input);
  await user.type(input, "new topic");
  await user.click(within(dialog).getByRole("button", { name: "Add tag" }));
  await waitFor(() => expect(input).toHaveValue(""));
  const assigned = within(screen.getByRole("list", { name: "Assigned tags" }))
    .getByText("new topic")
    .closest("li")!;
  const card = within(
    screen.getByRole("list", { name: "Tags for Draft" }),
  ).getByText("new topic");
  const colors = tagColor("new topic");
  for (const chip of [assigned, card])
    expect(chip).toHaveStyle({
      backgroundColor: colors.background,
      color: colors.foreground,
    });
  expect(
    within(dialog).getByRole("button", { name: "Remove tag new topic" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("list", { name: "Tags for Draft" }),
  ).toHaveTextContent("new topic");
  expect(screen.getByRole("link", { name: /^Draft/ })).toHaveAttribute(
    "href",
    "/maps/d",
  );
  expect(suggestions()).not.toContain("new topic");
  await user.click(
    within(dialog).getByRole("button", { name: "Remove tag new topic" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("list", { name: "Tags for Draft" }),
    ).not.toBeInTheDocument(),
  );
  expect(within(dialog).getByText("No tags assigned.")).toBeInTheDocument();
  expect(patch).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenCalledTimes(1);
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Manage tags for Draft" }),
  ).toHaveFocus();
});
it("rejects an already assigned tag without saving", async () => {
  const { user, input, dialog } = await open("Alpha plan");
  await user.type(input, "work");
  await user.click(within(dialog).getByRole("button", { name: "Add tag" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "already assigned",
  );
  expect(patch).not.toHaveBeenCalled();
});
it("displays only five tags with an additional count and exposes all tags for removal", async () => {
  maps[3].tags = Array.from({ length: 8 }, (_, i) => `Tag ${i}`);
  const { dialog } = await open();
  const chips = within(
    screen.getByRole("list", { name: "Tags for Draft" }),
  ).getAllByRole("listitem");
  expect(chips).toHaveLength(6);
  expect(chips[5]).toHaveTextContent("+3");
  expect(chips[5].style.backgroundColor).toBe("");
  expect(chips[5].style.color).toBe("");
  expect(
    within(dialog).getAllByRole("button", { name: /^Remove tag/ }),
  ).toHaveLength(8);
});
it.each(["", "   ", "two,tags", "x".repeat(33)])(
  "rejects invalid input %j inline without saving",
  async (value) => {
    const { user, input, dialog } = await open();
    fireEvent.change(input, { target: { value } });
    await user.click(within(dialog).getByRole("button", { name: "Add tag" }));
    expect(within(dialog).getByRole("alert")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(patch).not.toHaveBeenCalled();
  },
);
it("rejects duplicates and a 21st tag, then allows removal and a new tag", async () => {
  maps[3].tags = Array.from({ length: 20 }, (_, i) => `Tag ${i}`);
  const { user, input, dialog } = await open();
  await user.type(input, "Extra");
  await user.click(within(dialog).getByRole("button", { name: "Add tag" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("at most 20");
  expect(patch).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole("button", {
      name: "Remove tag Tag 0",
      exact: true,
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("button", {
        name: "Remove tag Tag 0",
        exact: true,
      }),
    ).not.toBeInTheDocument(),
  );
  await user.click(within(dialog).getByRole("button", { name: "Add tag" }));
  await screen.findByRole("button", { name: "Remove tag Extra", exact: true });
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, "Extra");
  await user.click(within(dialog).getByRole("button", { name: "Add tag" }));
  expect(within(dialog).getByRole("alert")).toBeInTheDocument();
  expect(patch).toHaveBeenCalledTimes(2);
});
it("shows a failed add or removal without losing input/tags and supports retry", async () => {
  let fail = true;
  server.use(
    http.patch("*/api/maps/:id/tags", async (args) =>
      fail
        ? HttpResponse.json(
            { error: "Disk full", code: "FAILED" },
            { status: 500 },
          )
        : patch(args),
    ),
  );
  const { user, input, dialog } = await open("Alpha plan");
  await user.type(input, "retry");
  await user.click(within(dialog).getByRole("button", { name: "Add tag" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Disk full",
  );
  expect(input).toHaveValue("retry");
  expect(
    useMapListStore.getState().maps.find((m) => m.id === "a")!.tags,
  ).toEqual(["work", "Research"]);
  fail = false;
  await user.click(within(dialog).getByRole("button", { name: "Add tag" }));
  await screen.findByRole("button", { name: "Remove tag retry" });
  fail = true;
  await user.click(
    within(dialog).getByRole("button", { name: "Remove tag retry" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Disk full",
  );
  expect(
    within(dialog).getByRole("button", { name: "Remove tag retry" }),
  ).toBeInTheDocument();
});
it("blocks repeated add/remove and dismissal while saving", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.patch("*/api/maps/:id/tags", async (args) => {
      await held;
      return patch(args);
    }),
  );
  const { user, input, dialog } = await open();
  await user.type(input, "pending");
  await user.dblClick(within(dialog).getByRole("button", { name: "Add tag" }));
  expect(input).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Done" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(dialog).toBeInTheDocument();
  release();
  await screen.findByRole("button", { name: "Remove tag pending" });
  expect(patch).toHaveBeenCalledTimes(1);
});
it("combines filter checkboxes with search/sort and clears filters without further list requests", async () => {
  app();
  await screen.findByRole("heading", { name: "Alpha plan" });
  const user = userEvent.setup();
  await user.click(screen.getByText("Filter by tags", { exact: true }));
  await user.click(screen.getByRole("checkbox", { name: "work" }));
  expect(titles()).toEqual(["Beta plan", "Alpha plan"]);
  await user.click(screen.getByRole("checkbox", { name: "Research" }));
  expect(titles()).toEqual(["Alpha plan"]);
  await user.type(screen.getByRole("searchbox"), "beta");
  await screen.findByRole("heading", { name: "No results for “beta”" });
  await user.click(screen.getByRole("button", { name: "Clear tag filter" }));
  expect(titles()).toEqual(["Beta plan"]);
  await user.click(screen.getByRole("checkbox", { name: "work" }));
  await user.click(screen.getByRole("button", { name: "Clear all tags" }));
  expect(screen.getByRole("checkbox", { name: "work" })).not.toBeChecked();
  expect(list).toHaveBeenCalledTimes(1);
  expect(patch).not.toHaveBeenCalled();
});
it("keeps an active tag removable after its last map is retagged and shows the tag-only no-results state", async () => {
  app();
  await screen.findByRole("heading", { name: "Alpha plan" });
  const user = userEvent.setup();
  await user.click(screen.getByText("Filter by tags", { exact: true }));
  await user.click(screen.getByRole("checkbox", { name: "home" }));
  act(() =>
    useMapListStore.setState({
      maps: originals.map((map) => ({
        ...map,
        tags: map.tags.filter((tag) => tag !== "home"),
      })),
    }),
  );
  expect(
    screen.getByRole("heading", { name: "No maps match these tags" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "home" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Clear all tags" }));
  expect(titles()).toHaveLength(4);
});
it("removes the last occurrence of a selected tag without leaving a stale dialog", async () => {
  app();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Beta plan" });
  await user.click(screen.getByText("Filter by tags", { exact: true }));
  await user.click(screen.getByRole("checkbox", { name: "home" }));
  await user.click(
    screen.getByRole("button", { name: "Manage tags for Beta plan" }),
  );
  await user.click(screen.getByRole("button", { name: "Remove tag home" }));
  await screen.findByRole("heading", { name: "No maps match these tags" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "home" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Clear all tags" }));
  expect(titles()).toHaveLength(4);
  expect(patch).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledTimes(1);
});
it("explains an empty tag filter without hiding untagged maps", async () => {
  maps = [{ id: "d", title: "Draft", tags: [] }];
  app();
  await screen.findByRole("heading", { name: "Draft" });
  await userEvent.click(screen.getByText("Filter by tags", { exact: true }));
  expect(
    screen.getByText("No tags yet. Add tags from a map card."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clear all tags" })).toBeDisabled();
  expect(titles()).toEqual(["Draft"]);
});
it("disables management of corrupt maps and shows no chips on untagged cards", async () => {
  maps = [{ id: "bad", title: "broken.json", error: true, tags: [] }];
  app();
  expect(
    await screen.findByRole("button", { name: "Manage tags for broken.json" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("list", { name: "Tags for broken.json" }),
  ).not.toBeInTheDocument();
});
it("clears active tag filters on import so the imported map is visible", async () => {
  const summary = { id: "import", title: "Imported", tags: [] };
  server.use(
    http.post("*/api/maps/import", () =>
      HttpResponse.json(summary, { status: 201 }),
    ),
  );
  useMapListStore.setState({ maps, activeTags: ["work"], searchQuery: "plan" });
  expect(await useMapListStore.getState().importMap(fixture())).toEqual(
    summary,
  );
  expect(useMapListStore.getState()).toMatchObject({
    activeTags: [],
    searchQuery: "",
  });
  expect(useMapListStore.getState().filteredAndSortedMaps()).toContainEqual(
    summary,
  );
});
