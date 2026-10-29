import { expect, it } from "vitest";
import fc from "fast-check";
import { tagColor } from "../../src/client/tagColor";

function luminance(hex: string) {
  const [red, green, blue] = hex.match(/[\da-f]{2}/g)!.map((byte) => {
    const value = parseInt(byte, 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

it.each([
  ["work", { background: "#532eb8", foreground: "#ffffff" }],
  ["Research", { background: "#aab82e", foreground: "#000000" }],
  ["home", { background: "#b82ea1", foreground: "#ffffff" }],
])("keeps the same stable display colors for %s", (tag, colors) => {
  expect(tagColor(tag)).toEqual(colors);
  expect(tagColor(tag)).toEqual(colors);
});

it("distinguishes the hues of at least ten varied tag names", () => {
  const tags = [
    "work",
    "Research",
    "home",
    "planning",
    "ideas",
    "urgent",
    "personal",
    "travel",
    "finance",
    "learning",
    "health",
  ];
  const colors = tags.map((tag) => tagColor(tag).background);
  // Fixed saturation/lightness means distinct backgrounds have distinct hues.
  expect(new Set(colors).size).toBe(tags.length);
});

it("hashes the exact case, whitespace and Unicode spelling without normalization", () => {
  const variants = [
    "work",
    "Work",
    " work",
    "work ",
    "Café",
    "Cafe\u0301",
    "家庭",
    "🌿",
    "W".repeat(32),
  ];
  const before = variants.map(tagColor);
  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset.theme = theme;
    expect(variants.map(tagColor)).toEqual(before);
  }
  delete document.documentElement.dataset.theme;
  expect(
    new Set(variants.slice(0, 4).map((tag) => tagColor(tag).background)).size,
  ).toBe(4);
  expect(tagColor("Café")).not.toEqual(tagColor("Cafe\u0301"));
});

it("returns deterministic valid CSS colors for generated names", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 32 }), (tag) => {
      const color = tagColor(tag);
      expect(tagColor(tag)).toEqual(color);
      expect(color.background).toMatch(/^#[\da-f]{6}$/);
      expect(["#ffffff", "#000000"]).toContain(color.foreground);
      const element = document.createElement("span");
      element.style.backgroundColor = color.background;
      element.style.color = color.foreground;
      expect(element.style.backgroundColor).not.toBe("");
      expect(element.style.color).not.toBe("");
    }),
    { numRuns: 100 },
  );
});

it("chooses the higher WCAG contrast and meets 4.5:1 for the entire hue range", () => {
  const colors = new Map(
    Array.from({ length: 10000 }, (_, index) => {
      const color = tagColor(`tag-${index}`);
      return [color.background, color.foreground];
    }),
  );
  expect(colors.size).toBe(360);
  const foregrounds = new Set<string>();
  for (const [background, foreground] of colors) {
    const backgroundLuminance = luminance(background);
    const white = 1.05 / (backgroundLuminance + 0.05);
    const black = (backgroundLuminance + 0.05) / 0.05;
    foregrounds.add(foreground);
    expect(foreground).toBe(white >= black ? "#ffffff" : "#000000");
    expect(foreground === "#ffffff" ? white : black).toBeGreaterThanOrEqual(
      4.5,
    );
  }
  expect(foregrounds).toEqual(new Set(["#ffffff", "#000000"]));
});
