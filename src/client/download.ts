export function exportFilename(
  title: string,
  extension: "json" | "png",
): string {
  let name =
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
      .replace(/^[. ]+|[. ]+$/g, "") || "mind-map";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = `_${name}`;
  return `${name}.${extension}`;
}

export function downloadUrl(url: string, filename: string): void {
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
  }
}
