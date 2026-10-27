import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "../../src/client/components/ThemeToggle";
import { useThemeStore } from "../../src/client/stores/themeStore";

const html = readFileSync("index.html", "utf8");
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1];
function initialize(saved: string | null, dark = false, blocked = false) {
  document.documentElement.removeAttribute("data-theme");
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  document.head.append(meta);
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    if (blocked) throw new DOMException("Storage denied", "SecurityError");
    return saved;
  });
  const media = vi.fn().mockReturnValue({ matches: dark });
  vi.stubGlobal("matchMedia", media);
  // Exercise the actual synchronous head script, before mounting any UI.
  window.eval(bootstrap);
  return { read, media, meta };
}
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  useThemeStore.setState({ theme: "light" });
});
afterEach(() => {
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((el) => el.remove());
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(["light", "dark"] as const)(
  "applies persisted %s before rendering and gives it precedence over the system",
  (theme) => {
    const { media, meta } = initialize(theme, theme !== "dark");
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(media).not.toHaveBeenCalled();
    expect(meta.content).toBe(theme === "dark" ? "#19221e" : "#f7f8f5");
    expect(html.indexOf(bootstrap)).toBeLessThan(html.indexOf("<body>"));
  },
);
it.each([null, "invalid", "Dark", ""])(
  "uses the system preference when the stored choice is %s",
  (saved) => {
    const { media } = initialize(saved, true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(media).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
  },
);
it("defaults to light when system preferences cannot be detected", () => {
  initialize(null, false);
  vi.stubGlobal("matchMedia", undefined);
  window.eval(bootstrap);
  expect(document.documentElement.dataset.theme).toBe("light");
});
it("uses the system preference even when localStorage cannot be read", () => {
  initialize(null, true, true);
  expect(document.documentElement.dataset.theme).toBe("dark");
});
it("initializes the reactive store from the bootstrapped theme", async () => {
  initialize("dark");
  vi.resetModules();
  const { useThemeStore: fresh } =
    await import("../../src/client/stores/themeStore");
  expect(fresh.getState().theme).toBe("dark");
});
it("toggles the document and every control together, persists the preference and updates browser chrome", async () => {
  initialize(null);
  const write = vi.spyOn(Storage.prototype, "setItem");
  render(
    <>
      <ThemeToggle />
      <ThemeToggle />
    </>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getAllByRole("button", { name: "Switch to dark theme" })[0],
  );
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(
    screen.getAllByRole("button", { name: "Switch to light theme" }),
  ).toHaveLength(2);
  expect(write).toHaveBeenLastCalledWith("maplora-theme", "dark");
  expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#19221e",
  );
  await user.click(
    screen.getAllByRole("button", { name: "Switch to light theme" })[1],
  );
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(write).toHaveBeenLastCalledWith("maplora-theme", "light");
});
it("keeps a selected theme in memory when persistence fails", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  const user = userEvent.setup();
  const view = render(<ThemeToggle />);
  await user.click(
    screen.getByRole("button", { name: "Switch to dark theme" }),
  );
  expect(document.documentElement.dataset.theme).toBe("dark");
  view.unmount();
  render(<ThemeToggle />);
  expect(
    screen.getByRole("button", { name: "Switch to light theme" }),
  ).toBeInTheDocument();
});
it("supports keyboard activation", async () => {
  render(<ThemeToggle />);
  const user = userEvent.setup();
  await user.tab();
  await user.keyboard(" ");
  expect(useThemeStore.getState().theme).toBe("dark");
  await user.keyboard("{Enter}");
  expect(useThemeStore.getState().theme).toBe("light");
});
