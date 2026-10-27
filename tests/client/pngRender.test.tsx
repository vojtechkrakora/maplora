import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { toPng } from "html-to-image";
import { downloadMapPng } from "../../src/client/pngExport";
import { fixture } from "../fixtures";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ReactFlowProvider: ({ children }: any) => children,
  Handle: () => null,
  useNodesInitialized: () => true,
  ReactFlow: ({ nodes, edges, nodeTypes, children }: any) => {
    const Node = nodeTypes.mindmap;
    return (
      <div className="react-flow">
        {nodes.map((node: any) => (
          <div className="react-flow__node" key={node.id}>
            <Node data={node.data} />
          </div>
        ))}
        <svg>
          {edges.map((edge: any) => (
            <path key={edge.id} className="react-flow__edge-path" />
          ))}
        </svg>
        {children}
      </div>
    );
  },
}));
const rasterize = vi.mocked(toPng);
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  rasterize.mockReset().mockResolvedValue("data:image/png;base64,iVBORw0KGgo=");
  click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 200, 80),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function begin(controller = new AbortController()) {
  let result!: Promise<void>;
  await act(async () => {
    result = downloadMapPng(fixture(), controller.signal);
    void result.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await waitFor(() => expect(rasterize).toHaveBeenCalled());
  return { result, controller };
}
it("captures the React Flow container at 2× with white background and no webfont requests, then cleans up", async () => {
  let filename = "";
  click.mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download;
  });
  rasterize.mockImplementationOnce(async (element, options) => {
    expect(element.classList.contains("react-flow")).toBe(true);
    expect(element.querySelectorAll(".react-flow__node")).toHaveLength(1);
    expect(element.querySelector("input, button")).toBeNull();
    expect(element.textContent).toContain(fixture().root.text);
    expect(options).toMatchObject({
      width: 264,
      height: 144,
      pixelRatio: 2,
      skipAutoScale: true,
      backgroundColor: "#ffffff",
      fontEmbedCSS: "",
    });
    expect(document.querySelector(".png-export-host")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    return "data:image/png;base64,iVBORw0KGgo=";
  });
  const { result } = await begin();
  await act(async () => result);
  expect(filename).toBe("Garden of ideas.png");
  expect(click).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".png-export-host")).toBeNull();
  expect(document.querySelector("a[download]")).toBeNull();
});
it.each(["error", "empty canvas"])(
  "cancels download and cleans up a rasterization failure: %s",
  async (scenario) => {
    if (scenario === "error")
      rasterize.mockRejectedValueOnce(new Error("Rasterization failed"));
    else rasterize.mockResolvedValueOnce("data:,");
    const { result } = await begin();
    await act(async () => {
      await expect(result).rejects.toThrow();
    });
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector(".png-export-host")).toBeNull();
  },
);
it("cancels a pending rasterization immediately and ignores late results without downloading", async () => {
  let finish!: (url: string) => void;
  rasterize.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result, controller } = await begin();
  expect(rasterize).toHaveBeenCalledTimes(1);
  await act(async () => {
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(document.querySelector(".png-export-host")).toBeNull();
  await act(async () => finish("data:image/png;base64,iVBORw0KGgo="));
  expect(click).not.toHaveBeenCalled();
});
it("cleans up a link click failure rather than leaving hidden DOM behind", async () => {
  click.mockImplementationOnce(() => {
    throw new Error("Download blocked");
  });
  const { result } = await begin();
  await act(async () => {
    await expect(result).rejects.toThrow("Download blocked");
  });
  expect(document.querySelector(".png-export-host")).toBeNull();
  expect(document.querySelector("a[download]")).toBeNull();
});
it("times out an unfinished render without downloading and removes the temporary canvas", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  let result!: Promise<void>;
  await act(async () => {
    result = downloadMapPng(fixture(), new AbortController().signal);
    void result.catch(() => {});
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
    await expect(result).rejects.toThrow("render the complete map");
  });
  expect(rasterize).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  expect(document.querySelector(".png-export-host")).toBeNull();
});
it("cancels during render initialization without waiting for the timeout", async () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  const controller = new AbortController();
  let result!: Promise<void>;
  await act(async () => {
    result = downloadMapPng(fixture(), controller.signal);
    void result.catch(() => {});
  });
  await act(async () => {
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(rasterize).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  expect(document.querySelector(".png-export-host")).toBeNull();
});
