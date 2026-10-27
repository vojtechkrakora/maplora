# Project Structure

- `src/client/` — React SPA, typed API client, styles, canvas and pages.
- `src/client/stores/` — Zustand list and editor stores; serialized automatic-save queue.
- `src/client/components/` — shared UI, dialogs, custom React Flow nodes and edges.
- `src/client/pages/` — home, editor and trash routes.
- `src/server/` — Hono app, startup validation and atomic JSON file store.
- `src/shared/` — Zod file schemas, types and tree traversal utilities.
- `tests/client/` — React Testing Library/MSW and editor-store tests (jsdom).
- `tests/server/` — filesystem, schema, layout and live HTTP tests (Node).
- `scripts/verify-compose.mjs` — isolated deployment verification and cleanup.
- `dist/public/` and `dist/server/` — generated production output; not committed.
- `data/` — default host data directory; not committed.
- `.kiro/specs/maplora/` — requirements, architecture and task checklist.

Shared/server TypeScript imports use `.js` extensions for NodeNext output. File operations stay in `MapFileStore`; route handlers validate input and delegate. Use stable UUID filenames and validate IDs before forming paths. Keep revision comparisons and writes inside the same per-map lock. Client mutations remain operation-based so stale-write recovery preserves unrelated remote changes.
