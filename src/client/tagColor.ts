/** Stable display colors for an exact tag name, independent of theme or storage. */
export function tagColor(tag: string): {
  background: string;
  foreground: string;
} {
  let hash = 5381;
  for (let index = 0; index < tag.length; index++)
    hash = (Math.imul(hash, 33) + tag.charCodeAt(index)) >>> 0;
  const hue = hash % 360;
  const saturation = 0.6;
  const lightness = 0.45;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const channels =
    hue < 60
      ? [chroma, secondary, 0]
      : hue < 120
        ? [secondary, chroma, 0]
        : hue < 180
          ? [0, chroma, secondary]
          : hue < 240
            ? [0, secondary, chroma]
            : hue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const rgb = channels.map((channel) => Math.round((channel + offset) * 255));
  const background = `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  // Use the actual rounded sRGB values so contrast matches the rendered color.
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return {
    background,
    foreground: whiteContrast >= blackContrast ? "#ffffff" : "#000000",
  };
}
