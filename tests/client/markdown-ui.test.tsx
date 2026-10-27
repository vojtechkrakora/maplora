import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyMarkdownButton } from "../../src/client/components/CopyMarkdownButton";
import { fixture } from "../fixtures";

const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function setup(write = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  const view = render(<CopyMarkdownButton map={fixture()} />);
  const button = screen.getByRole("button", { name: "Copy as Markdown" });
  return { ...view, button, write };
}
async function click(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}
it("copies the in-memory tree without requests and confirms only after the write succeeds", async () => {
  let resolve!: () => void;
  const write = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const fetch = vi.spyOn(globalThis, "fetch");
  const { button } = setup(write);
  expect(button).toBeEnabled();
  await click(button);
  expect(write).toHaveBeenCalledExactlyOnceWith("# Garden of ideas");
  expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument();
  await act(async () => resolve());
  expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
  act(() => vi.advanceTimersByTime(1999));
  expect(screen.getByRole("status")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
it("reports rejected writes and lets the user retry", async () => {
  const { button, write } = setup(
    vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
  );
  await click(button);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Could not copy to clipboard",
  );
  expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument();
  write.mockResolvedValue(undefined);
  await click(button);
  expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it.each([undefined, {}])(
  "reports unavailable clipboard support (%s) without throwing",
  async (unavailable) => {
    const { button } = setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: unavailable,
    });
    await click(button);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not copy to clipboard",
    );
  },
);
it("restarts the two-second timeout for repeated copies and ignores older pending results", async () => {
  let reject!: (reason: Error) => void;
  const write = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue(undefined);
  const { button } = setup(write);
  await click(button);
  await click(button);
  await act(async () => reject(new Error("Old failure")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1500));
  await click(button);
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("uses updated map contents and discards a previous map's pending feedback", async () => {
  let resolve!: () => void;
  const write = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(undefined);
  const { button, rerender } = setup(write);
  await click(button);
  const map = fixture();
  map.id = "another-map";
  map.root.text = "Updated root";
  rerender(<CopyMarkdownButton map={map} />);
  await act(async () => resolve());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await click(button);
  expect(write).toHaveBeenLastCalledWith("# Updated root");
  map.root.text = "Another edit";
  rerender(<CopyMarkdownButton map={{ ...map }} />);
  await click(button);
  expect(write).toHaveBeenLastCalledWith("# Another edit");
});
it("supports keyboard activation and keeps an editing input focused on pointer down", async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  const { button, write } = setup();
  const input = document.createElement("input");
  document.body.prepend(input);
  try {
    input.focus();
    await user.click(button);
    expect(input).toHaveFocus();
    expect(write).toHaveBeenCalledTimes(1);
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(write).toHaveBeenCalledTimes(3);
  } finally {
    input.remove();
  }
});
