import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { assertDataDir, MapFileStore } from "./MapFileStore.js";
const dataDir = process.env.DATA_DIR ?? "/data";
try {
  await assertDataDir(dataDir);
  const app = createApp(new MapFileStore(dataDir));
  const server = serve(
    {
      fetch: app.fetch,
      port: Number(process.env.PORT ?? 3000),
      hostname: "0.0.0.0",
    },
    (info) => console.log(`Maplora listening on port ${info.port}`),
  );
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
} catch (error) {
  console.error("FATAL:", error instanceof Error ? error.message : error);
  process.exit(1);
}
