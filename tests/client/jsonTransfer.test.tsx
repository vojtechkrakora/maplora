import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  downloadMapJson,
  jsonFilename,
  parseMapJson,
  readMapJson,
} from "../../src/client/jsonTransfer";
import { ExportJsonButton } from "../../src/client/components/ExportJsonButton";
import { fixture } from "../fixtures";

const objectUrl = vi.fn(() => "blob:map-export"),
  revoke = vi.fn();
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = objectUrl;
      static revokeObjectURL = revoke;
    },
  );
  click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  objectUrl.mockClear();
  revoke.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const blobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
it("downloads the complete current in-memory map, including hidden nodes and styles, without a request", async () => {
  const map = fixture();
  map.title = "Garden / 🌿";
  map.root.text = "Unsaved local change";
  map.root.children.push({
    id: "12345678-1234-4234-8234-123456789014",
    text: "Hidden",
    collapsed: true,
    style: { backgroundColor: "#abcdef", connectorStyle: "dashed" },
    children: [],
  });
  const before = structuredClone(map);
  const fetch = vi.spyOn(globalThis, "fetch");
  let filename = "";
  click.mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download;
    expect(this.isConnected).toBe(true);
  });
  downloadMapJson(map);
  expect(filename).toBe("Garden _ 🌿.json");
  expect(objectUrl).toHaveBeenCalledTimes(1);
  const blob = objectUrl.mock.calls[0][0] as Blob;
  expect(blob.type).toBe("application/json");
  expect(JSON.parse(await blobText(blob))).toEqual(map);
  expect(map).toEqual(before);
  expect(document.querySelector("a[download]")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  ['  ../bad\\name:*?<>|". ', "_bad_name_______.json"],
  ["...", "mind-map.json"],
  ["CON", "_CON.json"],
  ["lpt1.plan", "_lpt1.plan.json"],
  ["český 🌿 plán", "český 🌿 plán.json"],
  ["a\nb", "a_b.json"],
])("sanitizes a portable filename for %s", (title, expected) =>
  expect(jsonFilename(title)).toBe(expected),
);
it("revokes successful download URLs after the browser can consume them", () => {
  vi.useFakeTimers();
  downloadMapJson(fixture());
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(revoke).toHaveBeenCalledWith("blob:map-export");
});
it("does not start a download for invalid data or a failed Blob URL", () => {
  expect(() => downloadMapJson({ ...fixture(), title: "" })).toThrow();
  expect(objectUrl).not.toHaveBeenCalled();
  objectUrl.mockImplementationOnce(() => {
    throw new Error("Unavailable");
  });
  expect(() => downloadMapJson(fixture())).toThrow("Unavailable");
  expect(click).not.toHaveBeenCalled();
});
it("cleans up the anchor and URL when starting a download fails", () => {
  click.mockImplementationOnce(() => {
    throw new Error("Download blocked");
  });
  expect(() => downloadMapJson(fixture())).toThrow("Download blocked");
  expect(document.querySelector("a[download]")).toBeNull();
  expect(revoke).toHaveBeenCalledWith("blob:map-export");
});
it("reads a BOM-prefixed UTF-8 JSON file through FileReader", async () => {
  const map = fixture();
  map.root.text = "Žluťoučký 🌿";
  expect(
    await readMapJson(
      new File(["\uFEFF" + JSON.stringify(map)], "portable.json"),
    ),
  ).toEqual(map);
});
it.each([
  ["{", "parsed as JSON"],
  [JSON.stringify({ ...fixture(), schemaVersion: 23 }), "23"],
  [JSON.stringify({ ...fixture(), root: null }), "map schema"],
])("rejects invalid file content with a useful message", (content, message) =>
  expect(() => parseMapJson(content)).toThrow(message),
);
it("reports FileReader errors", async () => {
  vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (
    this: FileReader,
  ) {
    this.dispatchEvent(new ProgressEvent("error"));
  });
  await expect(readMapJson(new File(["{}"], "map.json"))).rejects.toThrow(
    "could not be read",
  );
});
it("shows an export error, retains editing focus and supports retry via keyboard", async () => {
  const user = userEvent.setup();
  render(
    <>
      <input aria-label="Node text" />
      <ExportJsonButton map={fixture()} />
    </>,
  );
  const input = screen.getByRole("textbox"),
    button = screen.getByRole("button", { name: "Export JSON" });
  input.focus();
  objectUrl.mockImplementationOnce(() => {
    throw new Error("Unavailable");
  });
  await user.click(button);
  expect(input).toHaveFocus();
  expect(screen.getByRole("alert")).toHaveTextContent("Could not export JSON");
  expect(click).not.toHaveBeenCalled();
  button.focus();
  await user.keyboard("{Enter}");
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("exports updated map props rather than a stale snapshot", () => {
  const map = fixture();
  const view = render(<ExportJsonButton map={map} />);
  view.rerender(<ExportJsonButton map={{ ...map, title: "Current title" }} />);
  click.mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe("Current title.json");
  });
  fireEvent.click(screen.getByRole("button"));
  expect(click).toHaveBeenCalledTimes(1);
});
