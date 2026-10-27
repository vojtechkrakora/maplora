import { expect, it } from "vitest";
import { nodeAppearance } from "../../src/client/nodeStyle";

it.each([
  [0, 0],
  [1, 1],
  [3, 3],
  [5, 5],
  [6, 0],
  [11, 5],
  [12, 0],
])("uses the theme palette for depth %i (slot %i)", (depth, slot) => {
  expect(nodeAppearance(undefined, depth).backgroundColor).toBe(
    `var(--node-bg-depth-${slot})`,
  );
  expect(nodeAppearance({ textColor: "red" }, depth)).toEqual({
    backgroundColor: `var(--node-bg-depth-${slot})`,
    color: "red",
    borderColor: undefined,
  });
});
it.each(["#abcdef", "rebeccapurple", "rgba(10, 20, 30, 0.5)", "transparent"])(
  "preserves the custom background %s at every depth",
  (backgroundColor) => {
    const style = {
      backgroundColor,
      textColor: "white",
      borderColor: "#123456",
    };
    for (const depth of [0, 1, 3, 6, 12])
      expect(nodeAppearance(style, depth)).toEqual({
        backgroundColor,
        color: "white",
        borderColor: "#123456",
      });
    expect(style.backgroundColor).toBe(backgroundColor);
  },
);
it("returns to the current depth's theme color after a background override is removed", () => {
  expect(
    nodeAppearance({ backgroundColor: undefined, connectorWidth: 4 }, 3)
      .backgroundColor,
  ).toBe("var(--node-bg-depth-3)");
});
