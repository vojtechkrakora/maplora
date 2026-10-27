import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  MIN_SCHEMA_VERSION,
  MapFileSchema,
  TitleSchema,
  UUIDSchema,
  summarize,
  type MapFile,
  type MapSummary,
} from "../shared/schema.js";
import { AppError } from "./errors.js";

// Each future version registers a pure migration from that version to the next.
export const migrations: Record<number, (old: unknown) => unknown> = {};
export function validateAndMigrate(input: unknown): MapFile {
  let value = input as Record<string, unknown>;
  const version = value?.schemaVersion;
  if (!Number.isInteger(version))
    throw new AppError(
      400,
      "INVALID_SCHEMA",
      "schemaVersion must be an integer",
    );
  if (Number(version) > CURRENT_SCHEMA_VERSION)
    throw new AppError(
      400,
      "UNSUPPORTED_VERSION",
      `Schema version ${version} exceeds supported maximum ${CURRENT_SCHEMA_VERSION}`,
    );
  if (Number(version) < MIN_SCHEMA_VERSION)
    throw new AppError(
      400,
      "UNSUPPORTED_VERSION",
      `Schema version ${version} is too old to migrate; minimum is ${MIN_SCHEMA_VERSION}`,
    );
  for (let v = Number(version); v < CURRENT_SCHEMA_VERSION; v++) {
    if (!migrations[v])
      throw new AppError(
        400,
        "UNSUPPORTED_VERSION",
        `No migration from schema version ${v}`,
      );
    value = migrations[v](value) as Record<string, unknown>;
  }
  return MapFileSchema.parse(value);
}
export async function assertDataDir(dataDir: string) {
  try {
    if (!(await fs.stat(dataDir)).isDirectory())
      throw new Error("Not a directory");
    await fs.access(dataDir, constants.R_OK | constants.W_OK);
    await fs.mkdir(path.join(dataDir, "_trash"), { recursive: true });
    const probe = path.join(dataDir, `.write-check-${randomUUID()}`);
    await fs.writeFile(probe, "", { flag: "wx" });
    await fs.unlink(probe);
  } catch (cause) {
    throw new Error(
      `Data directory '${dataDir}' is unavailable or not writable`,
      { cause },
    );
  }
}
export class MapFileStore {
  private writeLocks = new Map<string, Promise<unknown>>();
  constructor(private dataDir: string) {}
  private file(id: string, trash = false) {
    UUIDSchema.parse(id);
    return path.join(this.dataDir, ...(trash ? ["_trash"] : []), `${id}.json`);
  }
  private async locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeLocks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.writeLocks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.writeLocks.get(id) === next) this.writeLocks.delete(id);
    }
  }
  private async read(id: string, trash = false): Promise<MapFile> {
    const file = this.file(id, trash);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!trash) {
        try {
          await fs.access(this.file(id, true));
        } catch {
          throw new AppError(
            404,
            "NOT_FOUND",
            "Map could not be read: it was not found",
          );
        }
        throw new AppError(410, "MAP_TRASHED", "This map is in the trash");
      }
      throw new AppError(404, "NOT_FOUND", "Map was not found");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError(
        400,
        "INVALID_FILE",
        "Map file could not be parsed as JSON",
      );
    }
    try {
      const map = validateAndMigrate(parsed);
      if (map.id !== id)
        throw new AppError(
          400,
          "INVALID_FILE",
          "Map ID does not match filename",
        );
      return map;
    } catch (error) {
      console.error(
        "Map validation failed:",
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  }
  async readMap(id: string) {
    return this.locked(id, async () => {
      const map = await this.read(id);
      // At v1 no migration is needed. Future migrations overwrite through the atomic path.
      const raw = JSON.parse(await fs.readFile(this.file(id), "utf8"));
      if (raw.schemaVersion !== map.schemaVersion) {
        map.revision++;
        map.updatedAt = new Date().toISOString();
        await this.atomicWrite(map);
      }
      return map;
    });
  }
  private async list(trash = false): Promise<MapSummary[]> {
    const dir = path.join(this.dataDir, ...(trash ? ["_trash"] : []));
    const names = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((f) => f.isFile() && f.name.endsWith(".json"))
      .map((f) => f.name);
    const entries = await Promise.all(
      names.map(async (name) => {
        const id = name.slice(0, -5);
        try {
          return summarize(await this.read(id, trash));
        } catch {
          return { id, title: name, error: true } as MapSummary;
        }
      }),
    );
    return entries.sort((a, b) =>
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
  }
  listMaps() {
    return this.list();
  }
  listTrash() {
    return this.list(true);
  }
  async createMap(title: string): Promise<MapFile> {
    TitleSchema.parse(title);
    const now = new Date().toISOString();
    const map: MapFile = {
      schemaVersion: 1,
      revision: 1,
      id: randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
      root: { id: randomUUID(), text: title, collapsed: false, children: [] },
    };
    return this.locked(map.id, async () => {
      await this.atomicWrite(map);
      return map;
    });
  }
  async writeMap(input: MapFile): Promise<MapFile> {
    const map = MapFileSchema.parse(input);
    return this.locked(map.id, async () => {
      const current = await this.read(map.id);
      if (map.revision < current.revision)
        throw new AppError(
          409,
          "STALE_WRITE",
          "A newer revision is already saved",
        );
      const saved: MapFile = {
        ...map,
        createdAt: current.createdAt,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await this.atomicWrite(saved);
      return saved;
    });
  }
  async duplicateMap(id: string): Promise<MapFile> {
    const map = structuredClone(await this.readMap(id));
    const now = new Date().toISOString();
    map.id = randomUUID();
    // Leave room for the suffix without splitting a UTF-16 surrogate pair.
    const suffix = " (Copy)";
    map.title =
      map.title.slice(0, 100 - suffix.length).replace(/[\uD800-\uDBFF]$/, "") +
      suffix;
    map.revision = 1;
    map.createdAt = now;
    map.updatedAt = now;
    const nodes = [map.root];
    while (nodes.length) {
      const node = nodes.pop()!;
      node.id = randomUUID();
      nodes.push(...node.children);
    }
    return this.locked(map.id, async () => {
      await this.atomicWrite(map);
      return map;
    });
  }
  async renameMap(id: string, title: string) {
    TitleSchema.parse(title);
    return this.locked(id, async () => {
      const map = await this.read(id);
      const saved = {
        ...map,
        title,
        revision: map.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await this.atomicWrite(saved);
      return saved;
    });
  }
  private async atomicWrite(map: MapFile) {
    MapFileSchema.parse(map);
    const target = this.file(map.id),
      temporary = `${target}.tmp.${randomUUID()}`;
    try {
      const handle = await fs.open(temporary, "wx");
      try {
        await handle.writeFile(JSON.stringify(map, null, 2), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, target);
    } catch (error) {
      try {
        await fs.rm(temporary, { force: true });
      } catch {
        throw new AppError(
          500,
          "CLEANUP_FAILED",
          "Save failed and its temporary file could not be cleaned up",
        );
      }
      throw error;
    }
  }
  async trashMap(id: string) {
    return this.locked(id, async () => {
      // Do not parse the file: corrupt maps can still be moved to trash.
      await this.move(id, false);
    });
  }
  async restoreMap(id: string) {
    return this.locked(id, () => this.move(id, true));
  }
  private async move(id: string, restore: boolean) {
    const source = this.file(id, restore),
      target = this.file(id, !restore);
    try {
      await fs.access(target);
      throw new AppError(
        409,
        "DESTINATION_EXISTS",
        "A map with this ID already exists at the destination",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await fs.rename(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new AppError(404, "NOT_FOUND", "Map was not found");
      throw error;
    }
  }
  async emptyTrash() {
    const dir = path.join(this.dataDir, "_trash");
    const files = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(
      files
        .filter((f) => f.isFile() && f.name.endsWith(".json"))
        .map((f) =>
          this.locked(f.name.slice(0, -5), () =>
            fs.rm(path.join(dir, f.name), { force: true }),
          ),
        ),
    );
  }
}
