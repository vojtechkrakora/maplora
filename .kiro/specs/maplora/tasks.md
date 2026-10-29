# Implementation Plan: Maplora

## Overview

This plan breaks Maplora into small, independently testable increments. Tasks are ordered so that each step produces a runnable, verifiable state of the application. The project is a TypeScript monorepo with a Vite-built React SPA served by a Hono API server inside a single Docker container. All data lives on the host filesystem as JSON files.

MVP requirements (Req 1–4, 6–9, 12–14, 16, 21–24) are required tasks. Post-MVP requirements (Req 5, 10–11, 15, 17–20, 25–29) are optional tasks marked with `*`.

---

## Tasks

- [x] 1. Scaffold project structure, toolchain, and CI baseline
  - [x] 1.1 Initialize monorepo with `package.json`, TypeScript config, Vite config, and Tailwind CSS v4
    - Create root `package.json` with workspaces for `src/client` and `src/server`
    - Add `tsconfig.json` (base), `tsconfig.client.json` (extends base, DOM lib), `tsconfig.server.json` (extends base, NodeNext module)
    - Configure Vite with `react-ts` template, output to `dist/public`
    - Configure Tailwind CSS v4 using `@tailwindcss/vite` plugin
    - _Requirements: 23.2_

  - [x] 1.2 Set up Vitest, fast-check, React Testing Library, and MSW
    - Install `vitest`, `@vitest/coverage-v8`, `fast-check`, `@testing-library/react`, `@testing-library/user-event`, `msw`
    - Create `vitest.config.ts` with separate projects for client (jsdom) and server (node)
    - Add `npm test` script that runs `vitest --run`
    - _Requirements: 23.2_

  - [x] 1.3 Scaffold Hono server entry point with static file serving and startup data-directory validation
    - Create `src/server/index.ts`: starts Hono, serves `dist/public` as static files, falls back to `index.html` for non-API routes
    - Implement `assertDataDir()`: checks `DATA_DIR` env var (default `/data`), verifies read/write access, creates `_trash` subdirectory; calls `process.exit(1)` on failure
    - Add `npm run build` script: runs `vite build` then `tsc -p tsconfig.server.json`
    - Add `npm run dev` script: runs `vite` and `tsx watch src/server/index.ts` concurrently
    - _Requirements: 23.1, 23.4, 23.5, 24.6_

  - [x] 1.4 Add Dockerfile and docker-compose.yml
    - Multi-stage Dockerfile: `builder` stage (node:22-alpine, `npm ci`, `npm run build`), `runtime` stage (copies `dist/` and `node_modules`)
    - `docker-compose.yml` with `HOST_PORT` (default 3000) and `DATA_PATH` (default `./data`) env vars, bind mount to `/data`
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 24.1_

- [x] 2. Map File schema, validation, and file I/O layer
  - [x] 2.1 Define `MapFile` and `MapNode` Zod schemas and TypeScript types
    - Create `src/shared/schema.ts` with `MapFileSchema`, `MapNodeSchema`, `NodeStyleSchema`
    - Export inferred TypeScript types: `MapFile`, `MapNode`, `NodeStyle`, `MapSummary`
    - Schema fields per design: `schemaVersion: 1`, `revision ≥ 1`, UUID v4 `id`, `title` (1–100 chars), `createdAt`/`updatedAt` (ISO 8601), `root: MapNode`; `MapNode`: UUID v4 `id`, `text` (1–200 chars), `collapsed: boolean`, optional `style`, `children: MapNode[]`
    - _Requirements: 21.1, 21.2, 21.9_

  - [x]* 2.2 Write property test for MapFile serialization round trip
    - **Property 17: Map File serialization round trip**
    - **Validates: Requirements 21.9**
    - Build a `fc.Arbitrary<MapFile>` using fast-check; assert that `MapFileSchema.parse(JSON.parse(JSON.stringify(map)))` deep-equals the original

  - [x] 2.3 Implement `MapFileStore` with atomic writes, write-locking, and revision tracking
    - Create `src/server/MapFileStore.ts`
    - `listMaps()`: reads `*.json` in `dataDir` (excludes `_trash`), returns `MapSummary[]` sorted by `updatedAt` descending; on parse failure returns fallback entry with filename as title, no timestamp, error flag
    - `readMap(mapId)`: reads and Zod-validates the file; throws on missing or invalid
    - `writeMap(map)`: per-Map-ID write-lock via Promise chaining; calls `_doAtomicWrite`
    - `_doAtomicWrite(map)`: writes temp file (`{mapId}.json.tmp.{Date.now()}`), `fsync`, `rename`; deletes temp on failure; increments `revision` and updates `updatedAt` before writing
    - `renameMap(mapId, title)`: reads, updates `title` and `updatedAt`, calls `writeMap`
    - `trashMap(mapId)`: moves file to `_trash/`
    - `listTrash()`: reads `_trash/*.json`, returns `MapSummary[]`
    - `restoreMap(mapId)`: moves file from `_trash/` back to `dataDir`
    - `emptyTrash()`: deletes all `_trash/*.json`
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 21.3, 24.1, 24.5_

  - [x]* 2.4 Write property tests for revision and stale-write detection
    - **Property 18: Revision increments monotonically on every write**
    - **Validates: Requirements 22.7**
    - **Property 19: Stale-write detection rejects outdated saves**
    - **Validates: Requirements 22.8**
    - Use a temp directory per test; assert revision after N sequential writes equals N; assert a save with `revision < currentRevision` returns a 409-equivalent error without modifying the file

  - [x]* 2.5 Write unit tests for `MapFileStore`
    - Test `listMaps()` with 0, 1, N maps; verify sort order; verify corrupt-file fallback entry
    - Test `writeMap()` verifies temp file is cleaned up after failure
    - Test `trashMap()` / `restoreMap()` / `emptyTrash()` file movements
    - _Requirements: 1.3, 1.4, 1.6, 6.2, 6.5_

- [x] 3. REST API endpoints
  - [x] 3.1 Implement map CRUD API endpoints (`GET`, `POST`, `GET /:id`, `PUT /:id`, `PATCH /:id/title`, `DELETE /:id`)
    - `GET /api/maps`: calls `listMaps()`, returns `MapSummary[]`
    - `POST /api/maps`: validates title (1–100 chars, non-whitespace), creates root node with UUID v4, writes new `MapFile` with `revision=1`, returns `MapSummary`
    - `GET /api/maps/:mapId`: calls `readMap()`, returns full `MapFile`
    - `PUT /api/maps/:mapId`: validates body with `MapFileSchema`, checks `payload.revision < currentRevision` → 409, increments revision, atomic write, returns updated `MapFile`
    - `PATCH /api/maps/:mapId/title`: validates title, calls `renameMap()`, returns updated `MapSummary`
    - `DELETE /api/maps/:mapId`: calls `trashMap()`, returns 204
    - Attach `MapFileStore` instance to Hono app context via middleware
    - _Requirements: 1.1, 1.3, 1.5, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.2, 21.4, 21.5, 22.8_

  - [x] 3.2 Implement trash API endpoints (`GET /api/trash`, `POST /api/trash/:mapId/restore`, `DELETE /api/trash`)
    - `GET /api/trash`: calls `listTrash()`, returns `MapSummary[]`
    - `POST /api/trash/:mapId/restore`: calls `restoreMap()`, returns 200
    - `DELETE /api/trash`: calls `emptyTrash()`, returns 204
    - _Requirements: 6.4, 6.5, 6.6_

  - [x]* 3.3 Write integration tests for all API endpoints
    - Use a real temp directory per test suite; start Hono app in test; use `fetch` against the live port
    - Cover: list with 0/1/N maps, create + read back, put with valid revision, put with stale revision (expect 409), rename, delete (verify trash), restore, empty trash
    - _Requirements: 1.1, 2.2, 4.2, 6.2, 6.5, 22.7, 22.8_

- [x] 4. Frontend routing, shell, and API client
  - [x] 4.1 Set up React Router v6 with routes for `/`, `/maps/:mapId`, and `/trash`
    - Create `src/client/main.tsx` with `BrowserRouter`
    - Add stub page components: `MapListPage`, `EditorPage`, `TrashPage`
    - _Requirements: 3.1_

  - [x] 4.2 Implement typed API client module
    - Create `src/client/api.ts` with functions matching all server endpoints
    - Functions: `fetchMaps()`, `createMap(title)`, `fetchMap(mapId)`, `saveMap(map)`, `renameMap(mapId, title)`, `deleteMap(mapId)`, `fetchTrash()`, `restoreMap(mapId)`, `emptyTrash()`
    - Each function throws a typed error object `{ status, code, message }` on non-2xx
    - _Requirements: 1.1, 2.2, 4.2, 6.2_

- [x] 5. Map list screen (Requirement 1, 2, 4, 6)
  - [x] 5.1 Implement `MapListPage` with map cards, empty state, and create action
    - `MapListPage` fetches maps on mount via `mapListStore`; renders `MapCard[]` or `EmptyState`
    - `MapCard`: displays title and formatted `updatedAt` (locale date/time); shows error indicator for corrupt entries
    - Empty state: message + "Create your first mind map" button
    - Create action: dialog with title input (1–100 chars, non-empty, non-whitespace validation); on success navigate to `/maps/:mapId`
    - Loading and error states
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.5, 2.6, 2.7_

  - [x] 5.2 Implement rename and delete actions on `MapCard`
    - Rename: inline dialog pre-populated with current title; validates 1–100 chars; on success updates card immediately
    - Delete: confirmation dialog showing map name; on confirm calls `deleteMap()`; removes card from list immediately; shows error toast on failure
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 6.7, 6.8_

  - [x] 5.3 Implement `mapListStore` Zustand store
    - State: `maps: MapSummary[]`, `loading: boolean`, `error: string | null`
    - Actions: `fetchMaps()`, `createMap(title)`, `deleteMap(mapId)`, `renameMap(mapId, title)`
    - _Requirements: 1.1, 2.2, 4.2, 6.2_

  - [x]* 5.4 Write component tests for `MapListPage`
    - Use MSW to mock API; test renders card list, empty state, create dialog validation, rename dialog validation, delete confirmation
    - _Requirements: 1.1, 1.2, 2.6, 4.4, 6.7_

- [x] 6. Checkpoint — MVP map management baseline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Editor foundation: load map and canvas scaffold
  - [x] 7.1 Implement `editorStore` Zustand store (load and save only)
    - State: `map: MapFile | null`, `selectedNodeId: string | null`, `saving: 'idle' | 'saving' | 'error'`
    - Actions: `loadMap(mapId)`, `saveMap()`
    - `saveMap()` sends `PUT /api/maps/:mapId`; handles 409 by re-fetching and retrying once
    - _Requirements: 3.1, 3.3, 3.5_

  - [x] 7.2 Implement `EditorPage` with `MindMapCanvas` using React Flow
    - `EditorPage` calls `editorStore.loadMap()` on mount; shows loading spinner and error state
    - `MindMapCanvas` wraps `<ReactFlow>` with `minZoom={0.1}` and `maxZoom={2}`, `fitView` on initial load
    - Register custom `MindMapNode` component and `MindMapEdge` component (static rendering, no editing yet)
    - `MindMapNode`: renders node `text` as a styled `<div>`; shows selection ring when selected
    - `MindMapEdge`: SVG cubic bezier curve between parent and child
    - `EditorToolbar`: shows map title; zoom in/out buttons; fit-to-screen button
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 13.3, 13.4, 13.5, 13.6_

  - [x]* 7.3 Write component tests for `EditorPage` load and error states
    - Mock API with MSW; assert nodes render after load; assert error navigates back to list
    - _Requirements: 3.5_

- [x] 8. Bilateral layout algorithm
  - [x] 8.1 Implement bilateral Reingold-Tilford layout using d3-flextree
    - Create `src/client/layout.ts`
    - `computeLayout(map: MapFile, nodeSizes: Map<string, {width: number, height: number}>): Map<string, {x: number, y: number}>`
    - Step 1: split root children alternately right/left (index 0 → right, 1 → left, …)
    - Step 2: run `d3-flextree` independently on each side
    - Step 3: negate x-coords of left-side nodes
    - Step 4: place root at (0, 0); compose final position map
    - Collapsed nodes contribute zero size; their children are excluded from layout
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x]* 8.2 Write property tests for layout algorithm
    - **Property 15: Bilateral split balance invariant**
    - **Validates: Requirements 14.2**
    - **Property 16: Layout produces no overlapping bounding boxes**
    - **Validates: Requirements 14.3**
    - Use fast-check to generate arbitrary `MapFile` trees; assert |left_count − right_count| ≤ 1; assert no pair of bounding boxes overlaps after applying the 8px gap

  - [x] 8.3 Wire layout into `MindMapCanvas` with CSS transition animation
    - In `MindMapCanvas`, measure each rendered node's bounding box via a hidden measurement `<div>`; cache measurements; invalidate on text change
    - Call `computeLayout()` in a `useMemo` keyed on `map` and measurement cache
    - Pass computed positions as React Flow node positions
    - Apply `transition: transform 200ms ease-in-out` on node wrappers for animation
    - _Requirements: 14.1, 14.5_

  - [x]* 8.4 Write unit tests for layout with edge cases
    - Test 0, 1, 2, 3, 4, 5 root children; test single-node map; test deep unbalanced tree; test all nodes collapsed
    - _Requirements: 14.2, 14.3_

- [x] 9. Node editing — add, edit, and delete
  - [x] 9.1 Add node mutation actions to `editorStore` and wire to canvas
    - Add to `editorStore`: `addNode(parentId)`, `editNodeText(nodeId, text)`, `deleteNode(nodeId)`, `toggleCollapse(nodeId)`
    - Each action: pushes snapshot to `undoStack` (cap 50), mutates `map`, calls `saveMap()`
    - `addNode`: assigns new UUID v4, creates node with `collapsed: false`, inserts as last child
    - `deleteNode`: removes node and all descendants from tree; root cannot be deleted
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 9.2, 9.3, 12.5_

  - [x] 9.2 Implement inline node editing UI in `MindMapNode`
    - Double-click or F2 → replace text label with `<input>` in edit state
    - Enter or blur → `editNodeText()`; validate non-empty, non-whitespace (show inline error if invalid; do not dismiss edit)
    - Escape → revert to original text, exit edit state
    - New node (from `addNode`) → immediately enters edit state; cancel (Escape or empty text) → remove pending node, do not save
    - `editorStore.editNodeText` rejects empty/whitespace-only text and does not save
    - _Requirements: 7.1, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 9.3 Implement delete node UI with confirmation for non-leaf nodes
    - Add delete button / context menu item on `MindMapNode`
    - Leaf nodes: delete immediately on confirm, no prompt
    - Non-root nodes with children: show confirmation dialog with node label and descendant count; on confirm call `deleteNode()`; on cancel take no action
    - Root node: no delete option exposed
    - On server persistence failure: show error toast, restore deleted node and descendants
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 9.4 Implement collapse/expand toggle in `MindMapNode`
    - Show collapse control on non-root nodes with children that are expanded
    - Show expand control on collapsed nodes; no control on root or leaf nodes
    - Toggle calls `toggleCollapse(nodeId)`, persists to Map File
    - Expand reveals direct children in their previously persisted collapsed/expanded state
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x]* 9.5 Write property tests for node operations
    - **Property 9: Adding a child node assigns a unique Node ID**
    - **Validates: Requirements 7.2**
    - **Property 10: Node text edit round trip**
    - **Validates: Requirements 8.2, 8.3**
    - **Property 11: Node text validation rejects whitespace-only input**
    - **Validates: Requirements 8.5**
    - **Property 12: Node deletion removes node and all descendants**
    - **Validates: Requirements 9.2**
    - **Property 13: Collapse state persists across save and reload**
    - **Validates: Requirements 12.5**

  - [x]* 9.6 Write unit tests for `editorStore` node mutations
    - Test `addNode` appends child with unique ID; test `deleteNode` removes all descendants; test `editNodeText` rejects whitespace; test `toggleCollapse` persists state; test undo stack grows and is capped at 50
    - _Requirements: 7.2, 8.5, 9.2, 12.5, 25.4_

- [x] 10. Keyboard shortcuts
  - [x] 10.1 Implement keyboard shortcut handler in `EditorPage`
    - Add `keydown` listener on the canvas container; fire only when no text input is focused
    - `Tab` / `Insert`: `addNode(selectedNodeId)`
    - `Enter`: add sibling after selected node (no-op on root)
    - `Delete` / `Backspace`: `deleteNode(selectedNodeId)` (with confirmation if has children)
    - `F2`: enter edit mode on selected node
    - `Escape`: cancel current edit or close dialog
    - `Space`: `toggleCollapse(selectedNodeId)`
    - `ArrowUp` / `ArrowDown`: move selection to previous/next sibling
    - `ArrowLeft`: move selection to parent
    - `ArrowRight`: move selection to first child
    - `?`: open keyboard shortcut reference panel
    - _Requirements: 16.1, 16.2, 16.3_

  - [x]* 10.2 Write component tests for keyboard shortcuts
    - Use `@testing-library/user-event`; assert each shortcut triggers the expected store action; assert shortcuts do not fire when input is focused
    - _Requirements: 16.1, 16.3_

- [x] 11. Checkpoint — MVP editor interactions complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Trash screen
  - [x] 12.1 Implement `TrashPage` with restore and empty-trash actions
    - Fetches `GET /api/trash` on mount; renders `TrashCard[]` (title, restore button) or empty state
    - Restore: calls `restoreMap(mapId)`, removes card from list, shows success feedback
    - "Empty Trash" button: confirmation dialog; calls `emptyTrash()`; clears list
    - Link from `MapListPage` header to `/trash`
    - _Requirements: 6.4, 6.5, 6.6, 6.9, 6.10, 6.11_

  - [x]* 12.2 Write component tests for `TrashPage`
    - Mock API; test renders trash cards and empty state; test restore removes card; test empty-trash confirmation
    - _Requirements: 6.4, 6.5, 6.6_

- [x] 13. Schema versioning and migration infrastructure
  - [x] 13.1 Implement schema version validation and migration pipeline in `MapFileStore`
    - On `readMap()`: after JSON parse, check `schemaVersion`; if version > server's max supported → reject with error (log version and max); if version < minimum migration version → reject with error (log "too old")
    - If version < current and ≥ minimum → run migration chain; overwrite file with migrated content
    - Migration registry: `migrations: Record<number, (old: unknown) => unknown>`; currently only version 1 → 1 (identity, no migration needed yet, but registry is in place)
    - All reads return Zod-validated `MapFile`; any validation failure logged and returned as error
    - _Requirements: 21.4, 21.5, 21.6, 21.7, 21.8_

  - [x]* 13.2 Write unit tests for schema versioning
    - Test version-too-high rejection; test version-too-old rejection; test identity migration for v1 → v1; test that corrupt-field file is rejected with field-level error message
    - _Requirements: 21.4, 21.5, 21.6_

- [x] 14. Checkpoint — MVP complete, all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Duplicate map (Post-MVP)
  - [x]* 15.1 Implement duplicate map API endpoint and UI
    - `POST /api/maps/:mapId/duplicate`: deep-copies `MapFile`; assigns new Map ID and new Node IDs to every node; appends " (Copy)" to title; writes new file; returns new `MapSummary`
    - Add duplicate action to `MapCard`; on success append new card to list without page reload
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x]* 15.2 Write unit tests for duplicate endpoint
    - Assert new Map ID is different; assert all Node IDs differ from source; assert title ends with " (Copy)"; assert `revision=1` on new file
    - _Requirements: 5.2, 5.3_

- [x] 16. Rearrange sibling nodes (Post-MVP)
  - [x]* 16.1 Implement `reorderNode` in `editorStore` and keyboard shortcuts
    - `reorderNode(nodeId, newIndex)`: changes sibling order under same parent; pushes snapshot; persists
    - Keyboard: `Alt+ArrowUp` / `Alt+ArrowDown` on selected node reorders among siblings
    - _Requirements: 10.1, 10.3, 10.4, 10.5_

  - [x]* 16.2 Implement drag-to-reorder sibling UI in `MindMapCanvas`
    - Enable React Flow node drag within same parent; show position indicator during drag
    - On drop call `reorderNode()`; on Escape restore original order
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 17. Move branches (Post-MVP)
  - [x]* 17.1 Implement `moveNode` in `editorStore`
    - `moveNode(nodeId, newParentId, index)`: validates no-cycle (not self, not descendant, not same parent); moves node and all descendants under new parent; pushes snapshot; persists
    - _Requirements: 11.1, 11.3, 11.5, 11.6_

  - [x]* 17.2 Implement drag-to-reparent UI in `MindMapCanvas`
    - On node drag-and-drop onto another node (not self/descendant/same parent): call `moveNode()`; animate layout change within 300ms
    - On invalid target: show inline error indicator, reject move
    - On server failure: revert to previous parent, show auto-dismiss toast (3s)
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6_

- [x] 18. Visual customization (Post-MVP)
  - [x]* 18.1 Add `NodeStyle` persistence and rendering
    - `editorStore`: add `updateNodeStyle(nodeId, style: Partial<NodeStyle>)` action; pushes snapshot, persists
    - `MindMapNode`: apply `backgroundColor`, `textColor` from `node.style` if present; fall back to theme defaults
    - `MindMapEdge`: apply `connectorColor`, `connectorStyle`, `connectorWidth` from source node's `style`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x]* 18.2 Implement color picker UI in `NodeContextMenu`
    - Color picker panel: background color, text color, connector color (full hue range)
    - Line style selector: solid / dashed / dotted; thickness slider 1–8px
    - _Requirements: 15.1, 15.2, 15.3, 15.5_

- [x] 19. Light and dark theme (Post-MVP)
  - [x]* 19.1 Implement theme toggle with localStorage persistence
    - Add theme toggle control to `MapListPage` header and `EditorToolbar`
    - Apply theme via CSS custom properties on `<html>` element before first render (read from `localStorage`); fall back to `prefers-color-scheme`; final fallback is light theme
    - Persist selected theme in `localStorage`; apply within 300ms of toggle
    - Handle `localStorage` unavailable: apply for session only
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

- [x] 20. JSON export and import (Post-MVP)
  - [x]* 20.1 Implement JSON export (client-side download)
    - Export action in `EditorToolbar`: serializes in-memory `MapFile` with `JSON.stringify`, creates `Blob`, triggers download as `{sanitizedTitle}.json`
    - Exported file conforms to current `MapFileSchema`; no server-side paths or host identifiers
    - On failure: show error toast, cancel download
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [x]* 20.2 Implement JSON import API endpoint and UI
    - `POST /api/maps/import`: Zod-validates body against supported schema versions; discards incoming `id`, assigns new Map ID; checks Node ID conflicts across all existing files, replaces conflicts with new UUIDs; runs migration if older schema; writes file; returns new `MapSummary`
    - Import action in `MapListPage`: `<input type="file" accept=".json">`; reads with `FileReader`; POSTs; on success appends to map list without reload
    - Error cases: invalid JSON → error dialog; unsupported schema version → error dialog with detected version
    - _Requirements: 19.1, 19.2, 19.3, 19.3a, 19.4, 19.5, 19.6_

  - [x]* 20.3 Write integration tests for import endpoint
    - Test valid v1 import; test Node ID conflict replacement; test invalid JSON rejection; test unsupported schema version rejection
    - _Requirements: 19.1, 19.3, 19.4, 19.5_

- [x] 21. PNG export (Post-MVP)
  - [x]* 21.1 Implement PNG export using html-to-image
    - Export action in `EditorToolbar`: create local copy of tree with all nodes expanded; re-run layout; call `toPng` on React Flow container with `pixelRatio: 2`; download as `{sanitizedTitle}.png`
    - Restore collapsed state after export; export uses white background, no UI chrome
    - On failure: show error toast, cancel download
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

- [x] 22. Undo and redo (Post-MVP)
  - [x]* 22.1 Extend `editorStore` with full undo/redo and keyboard shortcuts
    - Add `undoStack: MapFile[]`, `redoStack: MapFile[]` to `editorStore`
    - All existing node mutation actions already push snapshots (from task 9.1); add `undo()` and `redo()` actions
    - `undo()`: pops snapshot from `undoStack`, pushes current state to `redoStack`, sets as live map, calls `saveMap()`; no-op if stack empty
    - `redo()`: pops from `redoStack`, pushes to `undoStack`, sets as live map, calls `saveMap()`; no-op if stack empty
    - Cap `undoStack` at 50; clear `redoStack` on any new operation
    - `Ctrl+Z` / `Cmd+Z`: `undo()`; `Ctrl+Shift+Z` / `Ctrl+Y` / `Cmd+Shift+Z`: `redo()`
    - Undo/redo buttons in `EditorToolbar`; disable when respective stack is empty
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7, 25.8, 16.1_

  - [x]* 22.2 Write property tests for undo/redo correctness
    - **Property 20: Undo reverses the most recent operation**
    - **Validates: Requirements 25.2**
    - **Property 21: Undo then redo is an identity operation**
    - **Validates: Requirements 25.3**
    - Use fast-check to generate sequences of node operations; assert undo returns prior state; assert undo+redo is identity

  - [x]* 22.3 Write unit tests for undo/redo boundary conditions
    - Test 50-op cap (oldest dropped); test undo no-op when stack empty; test redo no-op when stack empty; test redo stack cleared on new operation
    - _Requirements: 25.4, 25.7, 25.8_

- [x] 24. Map library search and sorting (Post-MVP)
  - [x]* 24.1 Add search and sort state to `mapListStore` and implement client-side filtering and sorting
    - Extend `mapListStore` with: `searchQuery: string`, `sortOrder: SortOrder` (type: `'updatedAt_desc' | 'updatedAt_asc' | 'title_asc' | 'title_desc'`)
    - Add actions: `setSearchQuery(query: string)`, `setSortOrder(order: SortOrder)`
    - Add derived selector `filteredAndSortedMaps()`: filters `maps` by case-insensitive substring match on `title`, then sorts by the active `sortOrder`
    - Default `sortOrder` is `'updatedAt_desc'`
    - All filtering and sorting operates on the in-memory `maps` array; no additional API calls
    - _Requirements: 26.1, 26.2, 26.3, 26.8, 26.9, 26.10_

  - [x]* 24.2 Persist sort order preference in localStorage
    - On `setSortOrder()`: write the selected sort order to `localStorage` under key `maplora:sortOrder`
    - On `mapListStore` initialization: read `maplora:sortOrder` from `localStorage`; validate against known values; fall back to `'updatedAt_desc'` if missing, invalid, or `localStorage` unavailable
    - _Requirements: 26.6, 26.7_

  - [x]* 24.3 Implement search input and sort control UI in `MapListPage`
    - Add a search input field to `MapListHeader`; bind to `mapListStore.searchQuery` via `setSearchQuery`; debounced at 50ms (well within the 100ms requirement)
    - Add a sort dropdown/select to `MapListHeader` with the four sort options; bind to `mapListStore.sortOrder` via `setSortOrder`; display current sort as selected option
    - `MapListPage` renders `filteredAndSortedMaps()` instead of raw `maps`
    - WHEN search produces no results: show a "no results" message containing the query text and a "Clear search" button that calls `setSearchQuery('')`
    - Search and sort controls remain mounted and responsive regardless of list size
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.10_

  - [x]* 24.4 Write unit tests for search and sort logic
    - Test `filteredAndSortedMaps()` with: empty query returns all maps; query matches substring case-insensitively; query with no match returns empty array; all four sort orders produce correct ordering; combined filter+sort applies filter first then sorts
    - Test `setSortOrder` persists to localStorage; test initialization reads and validates persisted value; test fallback on missing/invalid value
    - _Requirements: 26.2, 26.3, 26.6, 26.7, 26.8_

  - [x]* 24.5 Write component tests for `MapListPage` search and sort UI
    - Use MSW + React Testing Library; test: search input filters displayed cards; no-results state shows query and clear button; clear button resets search; sort dropdown re-orders cards; sort selection persists across remount (mocked localStorage)
    - _Requirements: 26.1, 26.3, 26.4, 26.5, 26.6_

- [x] 25. Copy as Markdown (Post-MVP)
  - [x]* 25.1 Implement `mapToMarkdown()` conversion function
    - Create `src/client/markdownExport.ts`
    - `mapToMarkdown(map: MapFile): string` — pure function, no side effects
    - Root node rendered as `# {root.text}`
    - Each child node rendered as a Markdown bullet `- {node.text}` with 2-space indentation per depth level (depth 1 = `- `, depth 2 = `  - `, depth 3 = `    - `, etc.)
    - Traversal is depth-first, preserving sibling order from `node.children`
    - All nodes included regardless of `collapsed` state — full logical structure exported
    - _Requirements: 27.2, 27.3, 27.4, 27.5_

  - [x]* 25.2 Implement "Copy as Markdown" action in `EditorToolbar`
    - Add "Copy as Markdown" button to `EditorToolbar`; always visible while a map is open
    - On click: call `mapToMarkdown(editorStore.map)`, write result to clipboard via `navigator.clipboard.writeText()`
    - On success: show a brief "Copied to clipboard" toast that auto-dismisses after 2 seconds
    - IF `navigator.clipboard` is unavailable or the write rejects: show an error toast "Could not copy to clipboard"
    - Button remains enabled regardless of selected node or editing state
    - _Requirements: 27.1, 27.6, 27.7, 27.8_

  - [x]* 25.3 Write unit tests for `mapToMarkdown()`
    - Test single root node (no children) produces `# {title}` with no bullet lines
    - Test one level of children: root + 3 children produces `# root\n- a\n- b\n- c`
    - Test two levels of nesting: child with grandchildren uses 2-space indented bullets
    - Test deep nesting (5 levels): verify indentation multiplies correctly at each depth
    - Test collapsed node: collapsed branch still appears fully in output
    - Test sibling order: children appear in the order defined in `node.children`
    - Test special characters in node text (e.g. `#`, `-`, `*`): output is not escaped (plain text export)
    - _Requirements: 27.3, 27.4, 27.5_

  - [x]* 25.4 Write component tests for the "Copy as Markdown" toolbar button
    - Mock `navigator.clipboard.writeText` as a spy
    - Assert button is present and enabled while a map is loaded
    - Assert clicking the button calls `navigator.clipboard.writeText` with output that starts with `# {map root text}`
    - Assert "Copied to clipboard" toast appears after a successful write
    - Assert error toast appears when `navigator.clipboard.writeText` rejects
    - _Requirements: 27.1, 27.6, 27.7, 27.8_

- [x] 26. Depth-based node background colors (Post-MVP)
  - [x]* 26.1 Define depth-based background color palettes in the theme CSS custom properties
    - In the existing theme definition (light and dark), add a set of CSS custom properties for depth levels 0 through 5: e.g. `--node-bg-depth-0` through `--node-bg-depth-5` for each theme
    - Light theme palette: distinct, visually harmonious pastel/muted colors at each depth level
    - Dark theme palette: distinct, visually legible darker-tinted colors at each depth level
    - Nodes deeper than depth 5 cycle through the palette using `depth % 6`
    - The palette values are pure CSS custom properties — no JavaScript logic required for the palette itself
    - _Requirements: 15.6, 17.8_

  - [x]* 26.2 Apply depth-based background color to `MindMapNode` when no custom background is set
    - In `MindMapNode`, compute the node's depth from the map tree (or receive it as a prop passed down from `MindMapCanvas`)
    - WHERE `node.style?.backgroundColor` is not set, apply `var(--node-bg-depth-{depth % 6})` as the node's background
    - WHERE `node.style?.backgroundColor` is set, use the stored custom color instead — depth-based default is fully overridden
    - The "Restore theme defaults" action in the style panel (task 18) removes the stored `backgroundColor`, which causes the depth-based color to reappear automatically
    - _Requirements: 15.6_

  - [x]* 26.3 Write unit tests for depth-based color application logic
    - Test that a node at depth 0 with no `style.backgroundColor` receives `var(--node-bg-depth-0)`
    - Test that a node at depth 3 with no `style.backgroundColor` receives `var(--node-bg-depth-3)`
    - Test that a node at depth 6 (beyond palette length) receives `var(--node-bg-depth-0)` (cycles)
    - Test that a node with `style.backgroundColor` set to any value uses that value and ignores depth-based default
    - _Requirements: 15.6, 17.8_

- [x] 27. Map Tags (Post-MVP)
  - [x]* 27.1 Extend `MapFile` schema and `MapSummary` to include `tags`
    - Add `tags: z.array(z.string()).default([])` to `MapFileSchema` in `src/shared/schema.ts`
    - Add `tags: string[]` to `MapSummary` type
    - Tag validation rules (enforce in schema and API): 1–32 characters, not all-whitespace, no commas, max 20 tags per map
    - WHEN the Server reads a Map File that does not contain a `tags` field (legacy file), treat it as an empty array without rejecting or migrating the file
    - Update `listMaps()` in `MapFileStore` to include `tags` in the returned `MapSummary` objects
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.14, 28.15_

  - [x]* 27.2 Implement tag save API endpoint
    - Add `PATCH /api/maps/:mapId/tags` endpoint: accepts `{ tags: string[] }`, validates per tag rules (1–32 chars, no commas, no all-whitespace, max 20), updates `tags` field in Map File via `MapFileStore.renameMap`-style atomic write, returns updated `MapSummary`
    - Add `updateTags(mapId, tags)` function to `src/client/api.ts`
    - _Requirements: 28.3, 28.4, 28.6, 28.7_

  - [x]* 27.3 Extend `mapListStore` with tag state and filtering
    - Add `activeTags: string[]` to `mapListStore` state
    - Add action `setActiveTags(tags: string[])`: replaces the active tag filter
    - Extend `filteredAndSortedMaps()` selector: after text-search filtering, additionally filter to maps that contain ALL tags in `activeTags` (AND logic); empty `activeTags` disables tag filtering
    - Add derived selector `allTags(): string[]`: returns all unique tags across all loaded `MapSummary` objects, sorted alphabetically
    - _Requirements: 28.10, 28.11, 28.12, 28.13_

  - [x]* 27.4 Implement tag management UI on `MapCard`
    - Add a tag management control to `MapCard` that allows adding and removing tags
    - Tag input with autocomplete: suggest tags from `mapListStore.allTags()` filtered by current input; show alphabetically sorted suggestions; allow free-text entry for new tags
    - Display up to 5 tags directly on the card as chips/badges; show "+N" count badge when more than 5 tags are assigned
    - Add/remove calls `updateTags(mapId, newTags)` and updates the card immediately on success without page reload
    - Enforce validation constraints (1–32 chars, no commas, no all-whitespace, max 20 tags) inline in the input with error messages
    - _Requirements: 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9_

  - [x]* 27.5 Implement tag filter control in `MapListPage`
    - Add a tag filter panel/dropdown to `MapListHeader` showing all unique tags from `mapListStore.allTags()`
    - Selecting a tag adds it to `activeTags`; deselecting removes it; selected tags are visually distinguished
    - Active tag filter combines with the existing text search and sort order (search first, then tag filter, then sort)
    - Tag filter panel shows a "Clear all" control that resets `activeTags` to `[]`
    - _Requirements: 28.10, 28.11, 28.12_

  - [x]* 27.6 Write unit and component tests for tag feature
    - Unit: tag schema validation accepts valid tags; rejects all-whitespace, commas, >32 chars, and >20 tags; missing `tags` field in legacy file parsed as empty array
    - Unit: `filteredAndSortedMaps()` with active tags applies AND logic; empty `activeTags` returns all; combined text + tag filter works correctly
    - Unit: `allTags()` returns sorted unique tags across all summaries
    - Component (MSW): tag management control adds/removes tags; autocomplete shows existing tags; "+N" badge appears when >5 tags; tag filter filters map cards; clear-all resets filter
    - _Requirements: 28.3, 28.4, 28.11, 28.12, 28.13, 28.14, 28.15_

- [x] 28. Root node prominence and re-centre (Post-MVP)
  - [x]* 28.1 Apply visually distinct styling to the root node in `MindMapNode`
    - In `MindMapNode`, detect whether the node is the root (depth 0 or an `isRoot` prop passed from `MindMapCanvas`)
    - Root node CSS: larger minimum width and padding than non-root nodes, bolder font weight, a prominent themed accent border (e.g. 2–3px solid using `--color-accent` or `--node-root-border`), and a dedicated root background color defined as a CSS custom property in both light and dark theme palettes (`--node-bg-root`)
    - Root node styling overrides the depth-0 palette color set in task 26 — the root gets its own distinct `--node-bg-root` value that stands apart from the depth-based palette
    - WHERE `node.style?.backgroundColor` is set by the user, that custom color takes precedence over `--node-bg-root`, consistent with the existing customization override rules (Req 15.6)
    - _Requirements: 3.6_

  - [x]* 28.2 Add "Re-centre root" toolbar button and `Home` keyboard shortcut
    - Add a "Re-centre root" button to `EditorToolbar` (e.g. a target/crosshair icon with tooltip)
    - On activation: call React Flow's `setCenter(rootX, rootY, { duration: 200 })` to pan the canvas so the root node is at the centre of the viewport, without changing the zoom level
    - Register `Home` key in the existing keyboard shortcut handler in `EditorPage`; fire the re-centre action when no text input is focused
    - Add `Home` → "Re-centre root" to the keyboard shortcut reference panel
    - _Requirements: 14.6, 16.1_

  - [x]* 28.3 Write unit and component tests
    - Unit: `isRoot` / depth-0 detection returns `true` for the root node and `false` for all others
    - Component: root node has a CSS class or inline style that differs from a depth-1 node; non-root nodes are unaffected
    - Component: "Re-centre root" button is present in the toolbar; clicking it calls the React Flow `setCenter` API with the root node's coordinates
    - Component: pressing `Home` while a non-input element is focused triggers re-centre; pressing `Home` while a text input is focused does not
    - _Requirements: 3.6, 14.6, 16.1_

- [ ] 29. Ctrl+S global save shortcut (Post-MVP)
  - [ ]* 29.1 Register global Ctrl+S / Cmd+S handler in `EditorPage`
    - Add a `keydown` event listener on `document` (not the canvas container) in `EditorPage` that fires for `Ctrl+S` (Windows/Linux) and `Cmd+S` (macOS) at all times while the Editor is mounted, including when a text input has focus
    - Call `event.preventDefault()` unconditionally to suppress the browser "Save page" dialog
    - Trigger `editorStore.saveMap()` on each activation; if a save is already in progress, skip the duplicate (debounce guard already present in the save queue)
    - Remove the listener when `EditorPage` unmounts
    - _Requirements: 16.1, 16.4_

  - [ ]* 29.2 Write component tests for Ctrl+S behaviour
    - Assert `event.preventDefault()` is called when `Ctrl+S` is fired in the canvas area
    - Assert `event.preventDefault()` is called when `Ctrl+S` is fired while a text input is focused
    - Assert `editorStore.saveMap()` is called on each activation
    - Assert the listener is removed on unmount (no save triggered after unmount)
    - _Requirements: 16.4_

- [ ] 30. Colored tags (Post-MVP)
  - [ ]* 30.1 Implement deterministic tag color derivation
    - Create `src/client/tagColor.ts`
    - `tagColor(tag: string): { background: string; foreground: string }` — pure function, no side effects
    - Derive a hue value (0–359) by hashing the tag string (e.g. djb2 or a simple sum-of-char-codes with modulo); use fixed saturation and lightness values that produce visually distinct, mid-range colors suitable for both light and dark card backgrounds
    - Compute foreground color (black or white) based on the derived background color's relative luminance (WCAG formula): use white for dark backgrounds, black for light backgrounds
    - The same tag string SHALL always produce the same `{ background, foreground }` pair regardless of session, device, or theme
    - _Requirements: 28.16, 28.17, 28.18_

  - [ ]* 30.2 Apply tag colors to tag chips in `MapCard` and tag filter controls
    - In `MapCard`, apply `tagColor(tag).background` and `tagColor(tag).foreground` as inline styles on each tag chip/badge
    - In the tag filter panel (`MapListPage`), apply the same tag colors to the clickable tag options
    - The color derivation is purely client-side — no schema changes, no server calls
    - _Requirements: 28.16, 28.17, 28.18_

  - [ ]* 30.3 Write unit tests for `tagColor()`
    - Test that the same tag string always returns the same `{ background, foreground }` pair (determinism)
    - Test that two different tag strings with different names produce different hues (distinctness — use a set of at least 10 varied tag names)
    - Test that the foreground is `#ffffff` for a dark background and `#000000` for a light background (luminance check)
    - Test that the background and foreground values are valid CSS color strings
    - _Requirements: 28.16, 28.17, 28.18_

- [ ] 31. Recently opened maps bar (Post-MVP)
  - [ ]* 31.1 Implement recently opened maps tracking in a session store
    - Create `src/client/recentMapsStore.ts` (a Zustand store or a simple module-level array)
    - `addRecentMap(summary: MapSummary)`: prepends the map to the list; removes any existing entry with the same Map ID; truncates the list to 5 entries; does not persist to localStorage or sessionStorage
    - `getRecentMaps(currentMapId: string): MapSummary[]`: returns the list with the current map excluded
    - The store is reset on page reload (session-scoped, module-level state)
    - WHEN a map is opened in `EditorPage` (on `loadMap()` success), call `addRecentMap()` with the loaded map's summary
    - _Requirements: 29.1, 29.2, 29.3, 29.5, 29.8_

  - [ ]* 31.2 Render the recently opened maps bar in `EditorToolbar`
    - Display `getRecentMaps(currentMapId)` as a horizontal list of clickable map title chips in `EditorToolbar`
    - WHEN the user clicks a recent map chip, navigate to `/maps/{mapId}` (React Router `navigate`)
    - IF the list is empty, hide the bar entirely (no placeholder text in the toolbar)
    - Truncate long titles with an ellipsis (`text-overflow: ellipsis`) to prevent toolbar overflow
    - IF a map in the recent list is opened and then deleted, it will be absent from the list on the next render because the store is not updated on deletion (the entry is simply stale; navigating to a deleted map will show the existing "map not found" error and return to the list)
    - _Requirements: 29.4, 29.5, 29.6, 29.7, 29.9_

  - [ ]* 31.3 Write unit and component tests for the recently opened maps bar
    - Unit (`recentMapsStore`): adding 6 maps keeps only the 5 most recent; adding a duplicate Map ID moves it to the front; `getRecentMaps` excludes the current map; store resets between test runs (module re-import)
    - Component: after opening map A then map B, the toolbar shows map A as a recent chip; current map B is not shown; clicking map A chip triggers navigation; bar is hidden when no recent maps exist
    - _Requirements: 29.1, 29.3, 29.4, 29.5, 29.9_

- [x] 23. Final checkpoint — all tests pass, Docker build verified
  - Ensure all tests pass, ask the user if questions arise.

---

## MVP Implementation Notes

Verification completed on 2026-10-27: 60 Vitest tests passed across 9 files, with 100 runs per property test; client/server production build and clean dependency installation passed. Browser checks passed on localhost and plain HTTP over the LAN. A 500-node map rendered in 619ms with 499 connectors and no measured label overlaps. Docker Compose built and ran the final image, served static assets and SPA routes, persisted JSON on the host, and preserved identical map data across restart and container recreation. Trash and restoration passed in the container. The production Compose service was left running on port 3000.

- Tasks 1–14 and their optional MVP test tasks are implemented. Post-MVP progress is recorded below. Task 23 is used only for final deployment verification.
- The snapshot stacks requested by task 9.1 are bounded at 50. Task 22 now adds complete undo/redo actions, controls, shortcuts and save-queue history reconciliation, including the entries in Requirement 16.1.
- Collapsed node labels retain their measured dimensions; only their descendants are excluded from layout. Giving the visible label a zero-size box would violate Requirement 14.3's non-overlap constraint.
- Saves use a serialized operation queue, reapply the pending operation to the latest map on a 409, and retry once. Failed operations roll back and can be retried from the error banner. Late responses from previously opened maps are ignored.
- New nodes stay as unsaved drafts until confirmed. UUID v4 creation also supports plain HTTP LAN deployments through Web Crypto's random-value API.
- Schema version 1 is the sole supported format; the migration registry is present for future version increments.
- `npm run verify:compose` builds and exercises an isolated single-container deployment, including bind-mounted file contents, static assets, restart and recreation. See README.md for exact run and backup instructions and known limitations.

---

## Post-MVP Implementation Notes

Task 15 completed on 2026-10-27: map cards offer Duplicate, which calls `POST /api/maps/:mapId/duplicate` and inserts the returned card without a list reload or navigation. The file store creates a deep copy through the existing atomic write path, replaces every map/node ID, resets revision to 1, and sets fresh timestamps. Branch order, labels, collapse state and optional style fields are preserved. The source file remains unchanged. To reconcile the required " (Copy)" suffix with the schema's 100-character title limit, the source title is shortened only as needed, without splitting a surrogate pair.

All 66 tests passed across 9 files, including six new duplication tests covering live HTTP, independent nested copies, title boundaries, invalid sources, write-failure cleanup, UI failure/retry and prevention of repeated in-flight requests. The production build passed. Docker Compose verification passed duplication, persisted JSON checks, restart/recreation, static assets, SPA routing, trash and restoration.

Task 16 implemented on 2026-10-27: Alt+Up/Down reorders the selected sibling. Dragging onto a sibling's upper/lower half previews insertion before/after it, with a visible marker. The tree remains unchanged until a valid drop; Escape, an invalid/outside drop, window blur or a map change cancels the preview. Root nodes and single children cannot be dragged for reordering. Text editing and in-flight saves disable dragging. Save failures roll back through the existing queue and offer retry. Reorders retain all subtree data and use a stable sibling anchor for stale-revision recovery; changed parents or removed anchors fail visibly. React Flow remeasures connector handles when the bilateral layout switches a branch's side.

All 81 automated tests passed across 10 files, including 100 generated reorder cases and tests for keyboard routing, insertion geometry, preview/cancellation, failure rollback/retry and concurrent saves. Real Chrome checks passed root and nested sibling reordering, both sides of the tree, insertion markers, Escape, invalid/outside drops, reload persistence, failure rollback/retry, editing guards and connector attachment after side changes. A 500-node map with all 499 connectors rendered in 428ms with no measured label overlaps. The production build and Docker Compose verification passed, including sibling order in bind-mounted JSON after restart and recreation, duplication, static assets, SPA routing, trash and restoration. Tasks 17–22 remained deferred at this checkpoint.

Task 17 implemented on 2026-10-27: dragging onto the centre of a node moves the complete branch under that parent, preserving IDs, labels, styles and descendant collapse states. The destination expands so the result remains visible. A highlighted outline previews the new parent; self, descendant and current-parent targets show inline errors and reject the drop. Sibling top/bottom quarters retain insertion markers for reordering. Root dragging remains disabled, while single children can now move. Escape, outside drops, blur and map changes cancel previews. Layout transitions take 200ms, and connectors reattach when branches switch sides. Moves push a snapshot and use the existing serialized save queue with stable insertion anchors and one stale-revision retry. Failed moves restore the persisted tree and show a toast for three seconds or until the next interaction; dragging again retries the operation. Deleted-map errors retain the existing navigation behavior.

All 100 automated tests passed across 11 files, including 100 generated branch moves, invalid targets, snapshot/subtree preservation, conflict rebasing, concurrent saves, rollback, inline indicators and exact toast dismissal timing. Real Chrome checks passed root and singleton destinations, collapsed-parent expansion, invalid targets, cancellation, JSON persistence after reload, connector placement, save failure rollback and stale-revision recovery, plus the sibling-reordering regression checks. A 500-node map with all 499 connectors rendered in 352ms with no measured label overlaps. The production build passed. Docker Compose verification passed the build, static assets, SPA routing, API, duplication, sibling order, moved subtree in bind-mounted JSON after restart/recreation, trash and restoration. Tasks 18–22 remained deferred at this checkpoint.

Task 18 implemented on 2026-10-27: a single node click opens a nonmodal options panel without an extra Style action; right-click opens the same panel with native color inputs for background, text and outgoing connector colors, a solid/dashed/dotted selector and a 1–8px thickness slider. A local preview shows unapplied changes; Apply submits one patch through the existing save queue and snapshot path. Cancel/Escape, clicking the canvas or selecting another node discards local changes. The panel leaves canvas focus intact, switches on node clicks and closes for double-click editing or dragging. Individual resets and Restore theme defaults remove overrides rather than storing theme colors. Node rendering applies stored background, text and border colors; SVG connectors use their source node's color, pattern and width, with round caps for dotted lines. Styling stays independent per node and disappears with a deleted subtree. Partial patches preserve unrelated remote style fields on a 409 retry; failed saves roll back and remain available to retry. No schema version, dependency or server endpoint changed.

All 121 automated tests passed across 13 files, including 100 generated style cases, partial updates, reset serialization, per-node isolation, snapshot preservation, conflict recovery, deletion, failure rollback/retry, native controls, local previews, single-click opening, selection switching, dismissal, preserved canvas/keyboard interaction and SVG rendering. The production build passed. Real Chrome checks passed single-click opening, switching options between nodes, canvas/Escape dismissal, double-click editing, dragging, native color controls, local preview, node isolation, source-node connector styling, solid/dashed/dotted lines, 1–8px widths, reload persistence, conflict merging, failure rollback/retry, defaults, cancellation, dark-mode defaults and a phone-sized panel. Branch-moving and sibling-reordering regression checks passed; a 500-node map with all 499 connectors rendered in 345ms without measured label overlaps. Docker Compose verification passed the build, static assets, SPA routing, API, persisted custom styles, duplication, sibling order, branch moves, bind-mounted JSON after restart/recreation, trash and restoration. After the single-click options update, the Docker image was rebuilt and the Compose service refreshed successfully. Tasks 19–22 remained deferred at this checkpoint.

Task 19 implemented on 2026-10-27: the map library header and editor toolbar offer an accessible light/dark toggle. A synchronous head script reads the browser's saved `maplora-theme` preference before any UI renders; absent or invalid preferences use the detected operating-system scheme, with light as the final fallback. CSS custom properties on the document element style the library, editor, trash, dialogs and native controls. React Flow receives the selected mode explicitly, and open node options refresh theme-default picker values while preserving custom colors. Theme changes update browser chrome color and save locally without modifying map files. If localStorage cannot be read or written, startup still resolves a usable theme and manual choices remain active throughout the current app session. No dependencies or server endpoints changed.

All 135 automated tests passed across 14 files, including the actual head bootstrap, stored/system/default precedence, blocked storage, keyboard activation, shared controls and editor color mode. The production build passed. Real Chrome checks passed the head bootstrap with the main bundle blocked, saved/system/light fallbacks, reload persistence, library/editor/trash/dialog palettes, native picker defaults, custom style preservation, blocked-storage session behavior, mobile controls, and no map writes or page errors. Theme changes took 23–178ms, including 97ms on a 500-node canvas, within the 300ms target. The single-click options and styling regression checks also passed. Docker Compose verification passed the build, static assets, theme bootstrap before the body, SPA routing, API, duplication, sibling order, branch moves, custom styles, bind-mounted JSON after restart/recreation, trash and restoration. Tasks 20–22 remain deferred.

---

**Requirement 26 Implementation Notes**

Task 24 implemented on 2026-10-27: the library offers a labeled search input with a 50ms trailing debounce and a native sort select for newest/oldest edited and title A → Z/Z → A. `mapListStore` owns the query and sort order and derives a filtered, sorted copy of its loaded summaries without mutating the source or requesting more data. Case-insensitive substring search includes unreadable files' filename fallbacks. Missing/invalid timestamps sort last in either date direction; equal values preserve the loaded order. Empty search restores all maps. No matches shows the query as escaped text with Clear search, which also cancels pending input. Controls remain mounted through loading, empty states and results, and use the existing light/dark colors and responsive layout.

Sort changes persist under `maplora:sortOrder`; initialization validates all four supported values and defaults to newest first when missing, invalid or unreadable. Blocked reads and writes never prevent searching or sorting; a choice that cannot be saved remains usable in the app session and reload uses the default. Search is session state, not a stored preference. No schema, API or dependency changes were needed. Tasks 20–22 remain deferred.

All 158 automated tests passed across 16 files, including 23 new store and MSW/component cases for filtering, all sort directions, combined operations, immutable source data, timestamp edge cases, persistence initialization, unavailable storage, exact debounce timing, pending-input cancellation, no-results clearing, remounts and in-memory list changes. The existing create-navigation test now waits for navigation before looking for a root label also present on a transient library card. The production build and formatting checks passed. Real Chrome verified 500 and 750 maps, all sort options, persistence after reload, invalid/blocked storage, mobile light/dark controls, no additional list requests and no page errors or map writes. Search updates with 500 maps took 56–67ms, including the debounce, below the 100ms target. Docker Compose verification passed the image build, assets, SPA routing, API and persisted JSON across restart/recreation, duplication, reordering, branch moves, custom styles, trash and restoration.

**Requirement 27 Implementation Notes**

Task 25 implemented on 2026-10-27: Copy as Markdown in the editor toolbar converts the current `editorStore.map` into plain Markdown and writes it with the browser clipboard API. The pure converter uses iterative depth-first traversal, emits the root label as a level-one heading and descendants as bullets with two spaces per additional depth, preserves sibling order and special characters verbatim, and includes all collapsed descendants. It does not mutate the map, make requests or use the map title in place of the root label. Unconfirmed draft nodes and text still being typed are not part of the stored map state and are not exported.

The button remains enabled during selection changes, editing, drafts, saving and save errors. Pointer activation retains input focus so copying does not trigger blur-based saving. The native button supports Enter and Space, has a full accessible name and tooltip, and shows a compact copy icon on narrow screens. Success appears only after the clipboard write resolves; confirmation dismisses after exactly two seconds. Unavailable or rejected clipboard writes show Could not copy to clipboard and allow retry. Repeated copies restart the timer, and outdated asynchronous results after a newer copy, map change or unmount are ignored. No dependencies, schemas or server endpoints changed; tasks 20–22 remain deferred.

All 176 automated tests passed across 18 files, including 18 new conversion, clipboard and toolbar-state cases. The production build and formatting checks passed. Real Chrome verified actual clipboard text, collapsed descendants, automatic confirmation dismissal, editing and draft focus without saves, keyboard activation, dark theme, 320px/390px toolbar layout, unavailable/rejected clipboard errors and no page errors or map writes. Browser tests used isolated temporary map data. Docker Compose verification passed the image build, static assets, SPA routing, API, map operations and persisted JSON across restart/recreation, trash and restoration.

**Task 26 Implementation Notes**

Task 26 implemented on 2026-10-27: six CSS custom properties per theme define distinct backgrounds for depths 0–5, with deeper nodes cycling by depth modulo six. Light mode uses muted green, blue, rose, sand, teal and lavender; dark mode uses corresponding darker tints. The canvas computes logical depths once per in-memory tree change and passes them to nodes and node options. Both sides use the same palette, and collapse state does not change depth. Drafts receive their parent's depth plus one; moving a branch recomputes the whole subtree's default colors without writing color values to the map.

`nodeAppearance` uses a stored custom background whenever present and otherwise selects the depth's CSS variable. The native background picker and preview use the same fallback, including after a theme change or Reset. Restore theme defaults continues to remove overrides, automatically revealing the current depth color. Default root text now uses the theme text color for contrast against its muted background; its accent border, larger type and padding remain. Explicit text, border and connector styles remain unchanged. No dependencies, schema changes or server endpoints were added; tasks 20–22 remain deferred.

All 189 automated tests passed across 19 files, including 13 new cases for depth slots, cycling, custom backgrounds, resets, logical depths on both sides, collapse/expansion, drafts and branch moves. Existing style preview/reset assertions now expect the depth fallback. The production build and formatting checks passed. Real Chrome verified depths 0–8, six distinct colors and text contrast of at least 4.5:1 in both themes, custom background precedence, individual reset/full restore/reload, native picker and preview synchronization, collapse/expansion and branch-move recoloring. A 500-node map rendered with all 499 connectors in 286ms, without overlapping labels or page errors. Palette/theme changes did not write map data. Browser checks used isolated temporary map data. Docker Compose verification passed the image build, static assets, SPA routing, API, custom styles and map operations, bind-mounted JSON across restart/recreation, trash and restoration.

**Task 20 Implementation Notes**

Task 20 implemented on 2026-10-27: Export JSON in the editor downloads the current in-memory map through a validated JSON Blob, using a portable title-derived filename. It includes the complete tree, collapsed descendants, IDs, timestamps, revision and styles without server paths or configuration. Pointer activation retains editing focus, so unconfirmed drafts and text still being typed are excluded without triggering a save. Downloads clean up temporary links and object URLs; failures show a retryable error toast. Native keyboard activation and narrow-screen icon controls remain available.

Import JSON in the library reads a selected file through FileReader and validates it before POSTing to `/api/maps/import`. The client and server share the same version validation and migration registry as regular map loading. The endpoint assigns a new map ID and revision 1, retaining timestamps and tree data. It preserves nonconflicting node IDs and replaces conflicts found in active or trashed maps, including case variants. Parseable invalid files still reserve known node IDs; malformed JSON files are skipped because they have no usable tree, and other file-read failures abort the import. Imports serialize conflict scanning and writing against other imports and use the existing atomic write path. Existing files are unchanged; failed writes remove temporary files and permit retry. Schema v1 remains the only supported version, with no invented older format or new dependencies.

The returned summary updates the library without refetching or navigation. Successful imports clear search and cancel any pending search debounce while retaining the sort preference. Import is disabled during the initial library fetch and during an import; cancelled pickers have no effect. Invalid JSON, invalid map data, unsupported versions (including the detected version), file-read failures and server errors show a dialog. The same file can be retried after closing the error.

All 231 automated tests passed across 22 files, including 42 new transfer and import cases covering live HTTP, full v1 data preservation, partial conflicts across active/trash files, concurrent imports, corrupt existing files, rejected JSON/schema/versions, atomic failure cleanup, Blob contents and filenames, URL cleanup, FileReader errors, keyboard/focus behavior, pending-search cancellation, in-flight guards, initial-fetch ordering and UI error/retry. Production build and formatting checks passed. Real Chrome verified actual downloads and the native file chooser, full hidden subtree/styles, exports during editing/drafts without map writes, keyboard activation, dark theme, responsive controls from 320–850px, fresh imported IDs, unchanged source data, library updates without refetching, validation dialogs, export failure/retry and server failure/retry, with no page exceptions. Browser checks used isolated temporary map data. Docker Compose verification passed the image build, static assets, SPA routing, API, JSON import with conflict replacement, imported and existing bind-mounted data after restart/recreation, map operations, trash and restoration. Tasks 21–22 remain deferred.

**Task 21 Implementation Notes**

Task 21 implemented on 2026-10-27: Export PNG in the editor toolbar validates and snapshots the current in-memory map, expands every node in an independent copy, measures all labels with the existing node CSS, and reruns the bilateral layout. A separate offscreen React Flow instance renders the complete tree using static labels, the existing depth palette and custom styles, and the shared SVG connector renderer. Export waits for node/handle initialization and all expected nodes and connector paths before calling `html-to-image.toPng` with `pixelRatio: 2`, a white background and automatic downscaling disabled. The image excludes attribution, handles, interaction paths, collapse buttons, editor controls and selection outlines. Title-derived PNG filenames use the same sanitization as JSON exports.

The editor's map, collapse states, selection, viewport, drafts, input text and save/history state are never changed. Pointer activation retains focus; native Enter/Space activation remains available. Only one export runs per button, with visible progress. Navigation or a map change aborts pending initialization/rasterization immediately and prevents stale downloads. Failures clean up temporary DOM, React roots, frames, timers and listeners, show an error toast and permit retry. Rendering times out after 15 seconds if the complete graph cannot initialize. Exports exceeding 32,767 pixels per side or 64 million pixels total at 2× resolution fail visibly instead of downloading clipped or downsampled output; browser canvas limits can be lower.

The specified `html-to-image` dependency is pinned to 1.11.11 following React Flow's official download example, which warns of broken exports in later versions. The module loads only on demand; system fonts require no external requests. No server API, storage schema or data migration changed. Toolbar spacing was adjusted on narrow screens to fit the additional action, and SVG edge rendering and filename/download helpers are shared with existing features. Undo/redo (task 22) remains deferred.

All 258 automated tests passed across 25 files, including 27 new cases for independent expansion, full bilateral layout/depths/source styles, padded bounds, root-only maps, invalid measurements, large-image rejection, UI filtering, 2×/white-background capture options, invalid raster output, download errors, cleanup, render timeouts, cancellation during initialization/rasterization, progress and repeated-click guards, keyboard/focus behavior, retries and map changes. Existing canvas tests now verify all three map export actions during editing, drafts, saving and save failures. Production build and formatting checks passed. Real Chrome verified actual PNG downloads, exact 2× dimensions, white opaque corner pixels, hidden styled leaves and colored solid/dashed/dotted connectors in raster pixels, Unicode/emoji, both themes, no UI/selection/handles, active editing/drafts without blur or writes, 320–1024px toolbar layout, raster failure/retry, native keyboard export, root-only maps, and an 80-node/79-edge multiline image in 1,286ms with unchanged live zoom/collapse state. Navigation cancelled real in-flight rasterization without a stale download, and an oversized map produced an error with cleanup. JSON transfer regression checks passed. Browser checks used isolated temporary data, with no browser exceptions or map writes. Docker Compose verification passed the image build, static assets including the lazy PNG module, SPA routing, API, JSON import, map operations, persisted JSON after restart/recreation, trash and restoration.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP delivery
- Each task references specific requirements for traceability
- Checkpoints (tasks 6, 11, 14, 23) are natural integration points to verify the running application
- Property tests validate universal correctness properties across many generated inputs; unit tests validate specific examples and edge cases
- The undo/redo snapshot infrastructure (task 9.1) is wired in during MVP; task 22 completes actions, controls, shortcuts and reconciliation with queued saves.
- `npm run dev` (not `vitest --watch`) should be run manually in a terminal for local development; use `npm test` (runs `vitest --run`) for CI and automated verification

---

**Task 22 Implementation Notes**

Task 22 implemented on 2026-10-27: the editor offers Undo and Redo toolbar buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y shortcuts. Full MapFile snapshots retain the last 50 operations, covering additions, branch deletion, text edits, branch moves, sibling order, styling and collapse state. Undo/redo restores the complete tree, preserving node IDs and current map metadata, and saves through the existing revision-checked atomic write path. New valid changes clear redo; no-op/invalid changes and cancelled drafts do not. History resets when loading a map, and empty stacks disable their controls without making requests. Finish or cancel text editing before using history; native text-field shortcuts and dialogs retain their own behavior. Controls return focus to the canvas, close unapplied options and remain usable while saves are queued. The toolbar wraps on narrow screens.

The save queue now projects history alongside pending operations from the last committed state. This keeps rapid edit/undo/redo sequences ordered and removes failed changes from history while preserving later valid operations. Failed undo/redo restores the canvas and both stacks and offers Retry change. A stale-revision retry uses current revision/metadata and records the actual pre-save tree for the opposite action. Because history uses complete snapshots, undo/redo can replace tree edits from another tab; one editor tab per map is recommended. Invalid selections fall back to the root when history removes their node, and late saves cannot modify another map session. No dependency, schema or endpoint changed.

All 280 automated tests passed across 26 files, including 22 new cases for history, keyboard/toolbar controls and a live HTTP/filesystem round trip. Properties 20 and 21 each ran 100 generated sequences of node operations. Tests cover the 50-operation cap, full redo, empty stacks, invalid/no-op edits, redo clearing, save failure/retry, queued actions and rollback, conflict recovery, deleted maps, selection and session isolation. Real Chrome passed toolbar and Ctrl/Cmd shortcuts, exact subtree/style/ID restoration, text and draft guards, persistence with increasing revisions, failure/retry, queued edit/undo/redo, 409 metadata preservation, reload reset and 320–1440px layouts without page errors. On a 500-node canvas, persisted undo completed in 271ms and redo in 301ms with all nodes retained. The production build and isolated Docker Compose verification passed, including static assets, API, bind-mounted JSON, restart and recreation, trash and restoration. Map tags (task 27) and root prominence/re-centering (task 28) remain deferred.

**Task 27 Implementation Notes**

Task 27 implemented on 2026-10-29: maps and library summaries include ordered tags, defaulting to an empty array. Shared validation and the tag API enforce 1–32 characters, no all-whitespace values or commas, and at most 20 tags. Schema v1 files missing tags load as empty without migration or read-time writes. Newly created files store `tags: []`; corrupt-file summaries expose empty tags. Tags retain exact case, spelling, whitespace and order. The UI prevents duplicate additions.

`PATCH /api/maps/:mapId/tags` validates the complete tag array, acquires the existing map lock, reads the latest map, increments revision/update time and saves through the existing atomic write path. It returns the updated summary. Library cards offer a Tags dialog with native datalist autocomplete from alphabetically sorted unique tags across the full loaded library, immediate add/remove saves, inline validation, busy guards and retryable failures without losing input or saved tags. Cards show the first five chips followed by a +N badge. The library tag dropdown matches all selected tags and combines with title search and sorting without further requests. A selected tag remains removable if its last matching map disappears. Import clears search/tag filters to keep the imported card visible. Duplication, JSON transfer, trash/restoration and editor revision-conflict recovery preserve tags. No new dependencies were added. Root prominence and re-centering (task 28) remain deferred.

All 315 automated tests passed across 28 files, including 35 new cases for schema limits, legacy files remaining byte/mtime identical, live HTTP persistence, invalid routes/payloads, concurrent metadata changes, stale revisions, write failure/retry and temporary-file cleanup, duplication/import/trash, editor saves/undo/redo retaining tags, local AND/search/sort filtering, sorted unique suggestions, first-five/+N chips, inline validation, repeated-click guards, failure recovery, focus, empty filters and removing a filtered card. The existing generated map round-trip property now includes tags. Real Chrome passed add/remove, autocomplete, exact limits, duplicate prevention, failed-save retry, focus restoration, local filtering, disappearing cards, unchanged legacy files, reload/duplication persistence and 320–1440px light/dark layouts without page errors. Filtering a 500-map library rendered in 16ms. Production build, formatting and isolated Docker Compose verification passed, including tags in original/duplicate/imported JSON after restart and container recreation, plus trash/restoration.

**Task 28 Implementation Notes**

Task 28 implemented on 2026-10-29: the root has a 160px minimum width, larger padding, bold text, a 2px themed accent border and a dedicated `--node-bg-root` background in both light and dark themes. Depth-zero detection selects the root background; descendants continue cycling through the six-color depth palette, including the separate depth-0 palette slot at depths 6, 12 and beyond. Custom background, text and border colors retain precedence. Resetting the root background restores its theme accent. The live canvas, hidden size measurement, node options/color picker/preview and PNG export share the same appearance and root class, keeping rendering and layout consistent. No stored map data or schema changes are required.

The existing editor toolbar offers a target icon labeled Re-centre root with a Home tooltip. Unmodified Home uses the existing keyboard handler and also works from toolbar buttons and without a selected node. Both paths pan to the root center over 200ms through React Flow's `setCenter()`, explicitly retaining the current zoom and using linear interpolation to avoid temporary scaling during the animation. Coordinates use the current absolute root position and rendered dimensions converted by zoom, with React Flow/hidden-measurement fallbacks. Rendered bounds keep an active text field centered when it outgrows the cached label size. The action retains selection, history, collapse state and unfinished edits/drafts, and makes no save request. Pointer activation preserves text-input focus. Native Home behavior remains in inputs, textareas, selects, editable content and dialogs; modified Home combinations are not intercepted. Branch dragging disables the toolbar action and ignores Home. The shortcut reference and README include the new action.

All 333 automated tests passed across 28 files. Coverage includes unique root/depth detection, custom color precedence/reset, unchanged descendant palette cycles, root preview and PNG styles, toolbar/keyboard routing, exact measured center/current zoom/linear interpolation, live editor bounds, unselected/editing/draft/saving/error states, loading another map, measurement fallback, dragging guards and native Home behavior. Real Chrome verified both themes' root size, weight, padding, border and background; toolbar and Home centering after pan/zoom; frame-by-frame constant zoom; accurate centering during text editing and drafts without losing input/focus or writing files; shortcut reference/dialog guards; 320–1440px layouts; the root accent in exported PNG raster pixels; and custom root color/theme/reset behavior. No browser errors occurred. Production build and formatting checks passed. Isolated Docker Compose verification passed the image build, static assets/API, bind-mounted JSON, duplication/import, restart/recreation and trash/restoration. All tasks in the current plan are complete.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5", "3.1"] },
    { "id": 5, "tasks": ["3.2", "4.1"] },
    { "id": 6, "tasks": ["3.3", "4.2"] },
    { "id": 7, "tasks": ["5.1", "5.3"] },
    { "id": 8, "tasks": ["5.2", "5.4", "7.1"] },
    { "id": 9, "tasks": ["7.2", "13.1"] },
    { "id": 10, "tasks": ["7.3", "8.1", "13.2"] },
    { "id": 11, "tasks": ["8.2", "8.3"] },
    { "id": 12, "tasks": ["8.4", "9.1"] },
    { "id": 13, "tasks": ["9.2", "9.3", "9.4"] },
    { "id": 14, "tasks": ["9.5", "9.6", "10.1"] },
    { "id": 15, "tasks": ["10.2", "12.1"] },
    { "id": 16, "tasks": ["12.2", "15.1"] },
    { "id": 17, "tasks": ["15.2", "16.1"] },
    { "id": 18, "tasks": ["16.2", "17.1"] },
    { "id": 19, "tasks": ["17.2", "18.1"] },
    { "id": 20, "tasks": ["18.2", "19.1", "20.1"] },
    { "id": 21, "tasks": ["20.2"] },
    { "id": 22, "tasks": ["20.3", "21.1"] },
    { "id": 23, "tasks": ["22.1"] },
    { "id": 24, "tasks": ["22.2", "22.3"] },
    { "id": 25, "tasks": ["24.1"] },
    { "id": 26, "tasks": ["24.2", "24.3"] },
    { "id": 27, "tasks": ["24.4", "24.5"] },
    { "id": 28, "tasks": ["25.1"] },
    { "id": 29, "tasks": ["25.2", "25.3"] },
    { "id": 30, "tasks": ["25.4"] },
    { "id": 31, "tasks": ["26.1"] },
    { "id": 32, "tasks": ["26.2", "26.3"] },
    { "id": 33, "tasks": ["27.1"] },
    { "id": 34, "tasks": ["27.2", "27.3"] },
    { "id": 35, "tasks": ["27.4", "27.5"] },
    { "id": 36, "tasks": ["27.6"] },
    { "id": 37, "tasks": ["28.1"] },
    { "id": 38, "tasks": ["28.2", "28.3"] },
    { "id": 39, "tasks": ["29.1"] },
    { "id": 40, "tasks": ["29.2", "30.1"] },
    { "id": 41, "tasks": ["30.2", "31.1"] },
    { "id": 42, "tasks": ["30.3", "31.2"] },
    { "id": 43, "tasks": ["31.3"] }
  ]
}
```
