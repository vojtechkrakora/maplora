import { ZodError } from "zod";
import { MapFileSchema, type MapFile } from "../shared/schema.js";
import { validateAndMigrate } from "../shared/mapValidation.js";

export function parseMapJson(text: string): MapFile {
  let input: unknown;
  try {
    input = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The file could not be parsed as JSON.");
  }
  try {
    return validateAndMigrate(input);
  } catch (error) {
    if (error instanceof ZodError)
      throw new Error(
        `The file does not match the map schema: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
    throw error;
  }
}

export function readMapJson(file: File): Promise<MapFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseMapJson(String(reader.result)));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reader.onabort = () =>
      reject(new Error("The selected file could not be read. Try again."));
    reader.readAsText(file);
  });
}

export function jsonFilename(title: string): string {
  let name =
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
      .replace(/^[. ]+|[. ]+$/g, "") || "mind-map";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = `_${name}`;
  return `${name}.json`;
}

export function downloadMapJson(map: MapFile): void {
  const data = MapFileSchema.parse(map);
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(blob);
  let started = false;
  try {
    anchor.href = url;
    anchor.download = jsonFilename(data.title);
    document.body.append(anchor);
    anchor.click();
    started = true;
  } finally {
    anchor.remove();
    if (started) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    else URL.revokeObjectURL(url);
  }
}
