import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { ZodError, z } from "zod";
import {
  MapFileSchema,
  TitleSchema,
  UUIDSchema,
  summarize,
} from "../shared/schema.js";
import { MapFileStore } from "./MapFileStore.js";
import { AppError } from "./errors.js";
import { SchemaVersionError } from "../shared/mapValidation.js";
export function createApp(store: MapFileStore, publicDir = "./dist/public") {
  const app = new Hono<{ Variables: { store: MapFileStore } }>();
  app.use("/api/*", async (c, next) => {
    c.set("store", store);
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ZodError)
      return c.json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          code: "VALIDATION_ERROR",
          details: error.issues,
        },
        400,
      );
    if (error instanceof AppError || error instanceof SchemaVersionError)
      return c.json({ error: error.message, code: error.code }, error.status);
    if (error instanceof SyntaxError)
      return c.json(
        { error: "Invalid JSON request", code: "INVALID_JSON" },
        400,
      );
    console.error(error);
    return c.json(
      {
        error: "The file operation failed. Please try again.",
        code: "INTERNAL_ERROR",
      },
      500,
    );
  });
  app.get("/api/maps", async (c) => c.json(await c.get("store").listMaps()));
  app.post("/api/maps", async (c) => {
    const { title } = z
      .object({ title: TitleSchema })
      .parse(await c.req.json());
    return c.json(summarize(await c.get("store").createMap(title)), 201);
  });
  app.post("/api/maps/import", async (c) =>
    c.json(summarize(await c.get("store").importMap(await c.req.json())), 201),
  );
  app.get("/api/maps/:mapId", async (c) =>
    c.json(
      await c.get("store").readMap(UUIDSchema.parse(c.req.param("mapId"))),
    ),
  );
  app.put("/api/maps/:mapId", async (c) => {
    const id = UUIDSchema.parse(c.req.param("mapId")),
      map = MapFileSchema.parse(await c.req.json());
    if (map.id !== id)
      throw new AppError(
        400,
        "ID_MISMATCH",
        "Map ID does not match the request",
      );
    return c.json(await c.get("store").writeMap(map));
  });
  app.patch("/api/maps/:mapId/title", async (c) => {
    const id = UUIDSchema.parse(c.req.param("mapId")),
      { title } = z.object({ title: TitleSchema }).parse(await c.req.json());
    return c.json(summarize(await c.get("store").renameMap(id, title)));
  });
  app.delete("/api/maps/:mapId", async (c) => {
    await c.get("store").trashMap(UUIDSchema.parse(c.req.param("mapId")));
    return c.body(null, 204);
  });
  app.post("/api/maps/:mapId/duplicate", async (c) =>
    c.json(
      summarize(
        await c
          .get("store")
          .duplicateMap(UUIDSchema.parse(c.req.param("mapId"))),
      ),
      201,
    ),
  );
  app.get("/api/trash", async (c) => c.json(await c.get("store").listTrash()));
  app.post("/api/trash/:mapId/restore", async (c) => {
    await c.get("store").restoreMap(UUIDSchema.parse(c.req.param("mapId")));
    return c.json({ restored: true });
  });
  app.delete("/api/trash", async (c) => {
    await c.get("store").emptyTrash();
    return c.body(null, 204);
  });
  app.all("/api/*", (c) =>
    c.json({ error: "API endpoint not found", code: "NOT_FOUND" }, 404),
  );
  app.use("*", serveStatic({ root: publicDir }));
  app.get("*", serveStatic({ path: `${publicDir}/index.html` }));
  return app;
}
