import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportPngButton } from "../../src/client/components/ExportPngButton";
import { downloadMapPng } from "../../src/client/pngExport";
import { fixture } from "../fixtures";

vi.mock("../../src/client/pngExport", () => ({ downloadMapPng: vi.fn() }));
const download = vi.mocked(downloadMapPng);
beforeEach(() => download.mockReset().mockResolvedValue());
afterEach(() => vi.useRealTimers());
it("exports the current map with native keyboard activation", async () => {
  const user = userEvent.setup(),
    map = fixture();
  const view = render(<ExportPngButton map={map} />);
  const latest = { ...map, title: "Current title" };
  view.rerender(<ExportPngButton map={latest} />);
  screen.getByRole("button", { name: "Export PNG" }).focus();
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith(latest, expect.any(AbortSignal)),
  );
  await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
  await user.keyboard(" ");
  await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
});
it("retains editing focus and blocks duplicate requests while showing progress", async () => {
  let finish!: () => void;
  download.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  render(
    <>
      <input aria-label="Node text" />
      <ExportPngButton map={fixture()} />
    </>,
  );
  const input = screen.getByRole("textbox"),
    button = screen.getByRole("button", { name: "Export PNG" });
  input.focus();
  await user.click(button);
  expect(input).toHaveFocus();
  expect(button).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Preparing PNG");
  fireEvent.click(button);
  expect(download).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(button).toBeEnabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("shows a render failure with no success feedback and allows retry", async () => {
  download.mockRejectedValueOnce(new Error("Canvas is unavailable"));
  const user = userEvent.setup();
  render(<ExportPngButton map={fixture()} />);
  await user.click(screen.getByRole("button"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not export PNG. Canvas is unavailable",
  );
  await user.click(screen.getByRole("button"));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("cancels an export on unmount without stale error feedback", async () => {
  let fail!: (error: Error) => void;
  download.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  const user = userEvent.setup(),
    view = render(<ExportPngButton map={fixture()} />);
  await user.click(screen.getByRole("button"));
  const signal = download.mock.calls[0][1];
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => fail(new Error("Late error")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("cancels an old map's export and ignores its completion after a new export starts", async () => {
  let finish!: () => void;
  download.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup(),
    map = fixture(),
    view = render(<ExportPngButton map={map} />);
  await user.click(screen.getByRole("button"));
  const signal = download.mock.calls[0][1];
  view.rerender(
    <ExportPngButton
      map={{ ...map, id: "12345678-1234-4234-8234-123456789017" }}
    />,
  );
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("button")).toBeEnabled();
  let finishNew!: () => void;
  download.mockReturnValueOnce(
    new Promise((resolve) => {
      finishNew = resolve;
    }),
  );
  await user.click(screen.getByRole("button"));
  await act(async () => finish());
  expect(screen.getByRole("button")).toBeDisabled();
  await act(async () => finishNew());
  expect(screen.getByRole("button")).toBeEnabled();
});
