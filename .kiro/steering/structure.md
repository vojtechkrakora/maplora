# Project Structure

- `src/client/` — React SPA, typed API client, styles, canvas and pages.
- `src/client/stores/` — Zustand list and editor stores; serialized automatic-save queue.
- `src/client/subtreeClipboard.ts` — versioned subtree envelope, recursive validation/snapshots, fresh-ID materialization and captured-content comparison; no clipboard cache.
- `src/client/subtreeEvents.ts` — synchronous native clipboard routing and focus/state guards; canvas React handlers own listener lifecycle and route-scoped feedback.
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

Complete subtree cuts and pastes each use one queued mutation and history snapshot. Cut verifies its captured source on initial application and conflict retry; paste validates every inserted ID and retains its materialized IDs on retry/redo. Clipboard content stays outside stores/history, and transfers between maps use independent saves. Properties 22–25 and native clipboard component tests live alongside the editor-store tests.
