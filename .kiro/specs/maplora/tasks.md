# Implementation Plan: Maplora

## Overview

This plan breaks Maplora into small, independently testable increments. Tasks are ordered so that each step produces a runnable, verifiable state of the application. The project is a TypeScript monorepo with a Vite-built React SPA served by a Hono API server inside a single Docker container. All data lives on the host filesystem as JSON files.

MVP requirements (Req 1–4, 6–9, 12–14, 16, 21–24) are required tasks. Post-MVP requirements (Req 5, 10–11, 15, 17–20, 25) are optional tasks marked with `*`.

---

## Tasks

- [ ] 1. Scaffold project structure, toolchain, and CI baseline
  - [ ] 1.1 Initialize monorepo with `package.json`, TypeScript config, Vite config, and Tailwind CSS v4
    - Create root `package.json` with workspaces for `src/client` and `src/server`
    - Add `tsconfig.json` (base), `tsconfig.client.json` (extends base, DOM lib), `tsconfig.server.json` (extends base, NodeNext module)
    - Configure Vite with `react-ts` template, output to `dist/public`
    - Configure Tailwind CSS v4 using `@tailwindcss/vite` plugin
    - _Requirements: 23.2_

  - [ ] 1.2 Set up Vitest, fast-check, React Testing Library, and MSW
    - Install `vitest`, `@vitest/coverage-v8`, `fast-check`, `@testing-library/react`, `@testing-library/user-event`, `msw`
    - Create `vitest.config.ts` with separate projects for client (jsdom) and server (node)
    - Add `npm test` script that runs `vitest --run`
    - _Requirements: 23.2_

  - [ ] 1.3 Scaffold Hono server entry point with static file serving and startup data-directory validation
    - Create `src/server/index.ts`: starts Hono, serves `dist/public` as static files, falls back to `index.html` for non-API routes
    - Implement `assertDataDir()`: checks `DATA_DIR` env var (default `/data`), verifies read/write access, creates `_trash` subdirectory; calls `process.exit(1)` on failure
    - Add `npm run build` script: runs `vite build` then `tsc -p tsconfig.server.json`
    - Add `npm run dev` script: runs `vite` and `tsx watch src/server/index.ts` concurrently
    - _Requirements: 23.1, 23.4, 23.5, 24.6_

  - [ ] 1.4 Add Dockerfile and docker-compose.yml
    - Multi-stage Dockerfile: `builder` stage (node:22-alpine, `npm ci`, `npm run build`), `runtime` stage (copies `dist/` and `node_modules`)
    - `docker-compose.yml` with `HOST_PORT` (default 3000) and `DATA_PATH` (default `./data`) env vars, bind mount to `/data`
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 24.1_

- [ ] 2. Map File schema, validation, and file I/O layer
  - [ ] 2.1 Define `MapFile` and `MapNode` Zod schemas and TypeScript types
    - Create `src/shared/schema.ts` with `MapFileSchema`, `MapNodeSchema`, `NodeStyleSchema`
    - Export inferred TypeScript types: `MapFile`, `MapNode`, `NodeStyle`, `MapSummary`
    - Schema fields per design: `schemaVersion: 1`, `revision ≥ 1`, UUID v4 `id`, `title` (1–100 chars), `createdAt`/`updatedAt` (ISO 8601), `root: MapNode`; `MapNode`: UUID v4 `id`, `text` (1–200 chars), `collapsed: boolean`, optional `style`, `children: MapNode[]`
    - _Requirements: 21.1, 21.2, 21.9_

  - [ ]* 2.2 Write property test for MapFile serialization round trip
    - **Property 17: Map File serialization round trip**
    - **Validates: Requirements 21.9**
    - Build a `fc.Arbitrary<MapFile>` using fast-check; assert that `MapFileSchema.parse(JSON.parse(JSON.stringify(map)))` deep-equals the original

  - [ ] 2.3 Implement `MapFileStore` with atomic writes, write-locking, and revision tracking
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

  - [ ]* 2.4 Write property tests for revision and stale-write detection
    - **Property 18: Revision increments monotonically on every write**
    - **Validates: Requirements 22.7**
    - **Property 19: Stale-write detection rejects outdated saves**
    - **Validates: Requirements 22.8**
    - Use a temp directory per test; assert revision after N sequential writes equals N; assert a save with `revision < currentRevision` returns a 409-equivalent error without modifying the file

  - [ ]* 2.5 Write unit tests for `MapFileStore`
    - Test `listMaps()` with 0, 1, N maps; verify sort order; verify corrupt-file fallback entry
    - Test `writeMap()` verifies temp file is cleaned up after failure
    - Test `trashMap()` / `restoreMap()` / `emptyTrash()` file movements
    - _Requirements: 1.3, 1.4, 1.6, 6.2, 6.5_

- [ ] 3. REST API endpoints
  - [ ] 3.1 Implement map CRUD API endpoints (`GET`, `POST`, `GET /:id`, `PUT /:id`, `PATCH /:id/title`, `DELETE /:id`)
    - `GET /api/maps`: calls `listMaps()`, returns `MapSummary[]`
    - `POST /api/maps`: validates title (1–100 chars, non-whitespace), creates root node with UUID v4, writes new `MapFile` with `revision=1`, returns `MapSummary`
    - `GET /api/maps/:mapId`: calls `readMap()`, returns full `MapFile`
    - `PUT /api/maps/:mapId`: validates body with `MapFileSchema`, checks `payload.revision < currentRevision` → 409, increments revision, atomic write, returns updated `MapFile`
    - `PATCH /api/maps/:mapId/title`: validates title, calls `renameMap()`, returns updated `MapSummary`
    - `DELETE /api/maps/:mapId`: calls `trashMap()`, returns 204
    - Attach `MapFileStore` instance to Hono app context via middleware
    - _Requirements: 1.1, 1.3, 1.5, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.2, 21.4, 21.5, 22.8_

  - [ ] 3.2 Implement trash API endpoints (`GET /api/trash`, `POST /api/trash/:mapId/restore`, `DELETE /api/trash`)
    - `GET /api/trash`: calls `listTrash()`, returns `MapSummary[]`
    - `POST /api/trash/:mapId/restore`: calls `restoreMap()`, returns 200
    - `DELETE /api/trash`: calls `emptyTrash()`, returns 204
    - _Requirements: 6.4, 6.5, 6.6_

  - [ ]* 3.3 Write integration tests for all API endpoints
    - Use a real temp directory per test suite; start Hono app in test; use `fetch` against the live port
    - Cover: list with 0/1/N maps, create + read back, put with valid revision, put with stale revision (expect 409), rename, delete (verify trash), restore, empty trash
    - _Requirements: 1.1, 2.2, 4.2, 6.2, 6.5, 22.7, 22.8_

- [ ] 4. Frontend routing, shell, and API client
  - [ ] 4.1 Set up React Router v6 with routes for `/`, `/maps/:mapId`, and `/trash`
    - Create `src/client/main.tsx` with `BrowserRouter`
    - Add stub page components: `MapListPage`, `EditorPage`, `TrashPage`
    - _Requirements: 3.1_

  - [ ] 4.2 Implement typed API client module
    - Create `src/client/api.ts` with functions matching all server endpoints
    - Functions: `fetchMaps()`, `createMap(title)`, `fetchMap(mapId)`, `saveMap(map)`, `renameMap(mapId, title)`, `deleteMap(mapId)`, `fetchTrash()`, `restoreMap(mapId)`, `emptyTrash()`
    - Each function throws a typed error object `{ status, code, message }` on non-2xx
    - _Requirements: 1.1, 2.2, 4.2, 6.2_

- [ ] 5. Map list screen (Requirement 1, 2, 4, 6)
  - [ ] 5.1 Implement `MapListPage` with map cards, empty state, and create action
    - `MapListPage` fetches maps on mount via `mapListStore`; renders `MapCard[]` or `EmptyState`
    - `MapCard`: displays title and formatted `updatedAt` (locale date/time); shows error indicator for corrupt entries
    - Empty state: message + "Create your first mind map" button
    - Create action: dialog with title input (1–100 chars, non-empty, non-whitespace validation); on success navigate to `/maps/:mapId`
    - Loading and error states
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.5, 2.6, 2.7_

  - [ ] 5.2 Implement rename and delete actions on `MapCard`
    - Rename: inline dialog pre-populated with current title; validates 1–100 chars; on success updates card immediately
    - Delete: confirmation dialog showing map name; on confirm calls `deleteMap()`; removes card from list immediately; shows error toast on failure
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 6.7, 6.8_

  - [ ] 5.3 Implement `mapListStore` Zustand store
    - State: `maps: MapSummary[]`, `loading: boolean`, `error: string | null`
    - Actions: `fetchMaps()`, `createMap(title)`, `deleteMap(mapId)`, `renameMap(mapId, title)`
    - _Requirements: 1.1, 2.2, 4.2, 6.2_

  - [ ]* 5.4 Write component tests for `MapListPage`
    - Use MSW to mock API; test renders card list, empty state, create dialog validation, rename dialog validation, delete confirmation
    - _Requirements: 1.1, 1.2, 2.6, 4.4, 6.7_

- [ ] 6. Checkpoint — MVP map management baseline
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Editor foundation: load map and canvas scaffold
  - [ ] 7.1 Implement `editorStore` Zustand store (load and save only)
    - State: `map: MapFile | null`, `selectedNodeId: string | null`, `saving: 'idle' | 'saving' | 'error'`
    - Actions: `loadMap(mapId)`, `saveMap()`
    - `saveMap()` sends `PUT /api/maps/:mapId`; handles 409 by re-fetching and retrying once
    - _Requirements: 3.1, 3.3, 3.5_

  - [ ] 7.2 Implement `EditorPage` with `MindMapCanvas` using React Flow
    - `EditorPage` calls `editorStore.loadMap()` on mount; shows loading spinner and error state
    - `MindMapCanvas` wraps `<ReactFlow>` with `minZoom={0.1}` and `maxZoom={2}`, `fitView` on initial load
    - Register custom `MindMapNode` component and `MindMapEdge` component (static rendering, no editing yet)
    - `MindMapNode`: renders node `text` as a styled `<div>`; shows selection ring when selected
    - `MindMapEdge`: SVG cubic bezier curve between parent and child
    - `EditorToolbar`: shows map title; zoom in/out buttons; fit-to-screen button
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 13.3, 13.4, 13.5, 13.6_

  - [ ]* 7.3 Write component tests for `EditorPage` load and error states
    - Mock API with MSW; assert nodes render after load; assert error navigates back to list
    - _Requirements: 3.5_

- [ ] 8. Bilateral layout algorithm
  - [ ] 8.1 Implement bilateral Reingold-Tilford layout using d3-flextree
    - Create `src/client/layout.ts`
    - `computeLayout(map: MapFile, nodeSizes: Map<string, {width: number, height: number}>): Map<string, {x: number, y: number}>`
    - Step 1: split root children alternately right/left (index 0 → right, 1 → left, …)
    - Step 2: run `d3-flextree` independently on each side
    - Step 3: negate x-coords of left-side nodes
    - Step 4: place root at (0, 0); compose final position map
    - Collapsed nodes contribute zero size; their children are excluded from layout
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ]* 8.2 Write property tests for layout algorithm
    - **Property 15: Bilateral split balance invariant**
    - **Validates: Requirements 14.2**
    - **Property 16: Layout produces no overlapping bounding boxes**
    - **Validates: Requirements 14.3**
    - Use fast-check to generate arbitrary `MapFile` trees; assert |left_count − right_count| ≤ 1; assert no pair of bounding boxes overlaps after applying the 8px gap

  - [ ] 8.3 Wire layout into `MindMapCanvas` with CSS transition animation
    - In `MindMapCanvas`, measure each rendered node's bounding box via a hidden measurement `<div>`; cache measurements; invalidate on text change
    - Call `computeLayout()` in a `useMemo` keyed on `map` and measurement cache
    - Pass computed positions as React Flow node positions
    - Apply `transition: transform 200ms ease-in-out` on node wrappers for animation
    - _Requirements: 14.1, 14.5_

  - [ ]* 8.4 Write unit tests for layout with edge cases
    - Test 0, 1, 2, 3, 4, 5 root children; test single-node map; test deep unbalanced tree; test all nodes collapsed
    - _Requirements: 14.2, 14.3_

- [ ] 9. Node editing — add, edit, and delete
  - [ ] 9.1 Add node mutation actions to `editorStore` and wire to canvas
    - Add to `editorStore`: `addNode(parentId)`, `editNodeText(nodeId, text)`, `deleteNode(nodeId)`, `toggleCollapse(nodeId)`
    - Each action: pushes snapshot to `undoStack` (cap 50), mutates `map`, calls `saveMap()`
    - `addNode`: assigns new UUID v4, creates node with `collapsed: false`, inserts as last child
    - `deleteNode`: removes node and all descendants from tree; root cannot be deleted
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 9.2, 9.3, 12.5_

  - [ ] 9.2 Implement inline node editing UI in `MindMapNode`
    - Double-click or F2 → replace text label with `<input>` in edit state
    - Enter or blur → `editNodeText()`; validate non-empty, non-whitespace (show inline error if invalid; do not dismiss edit)
    - Escape → revert to original text, exit edit state
    - New node (from `addNode`) → immediately enters edit state; cancel (Escape or empty text) → remove pending node, do not save
    - `editorStore.editNodeText` rejects empty/whitespace-only text and does not save
    - _Requirements: 7.1, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [ ] 9.3 Implement delete node UI with confirmation for non-leaf nodes
    - Add delete button / context menu item on `MindMapNode`
    - Leaf nodes: delete immediately on confirm, no prompt
    - Non-root nodes with children: show confirmation dialog with node label and descendant count; on confirm call `deleteNode()`; on cancel take no action
    - Root node: no delete option exposed
    - On server persistence failure: show error toast, restore deleted node and descendants
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ] 9.4 Implement collapse/expand toggle in `MindMapNode`
    - Show collapse control on non-root nodes with children that are expanded
    - Show expand control on collapsed nodes; no control on root or leaf nodes
    - Toggle calls `toggleCollapse(nodeId)`, persists to Map File
    - Expand reveals direct children in their previously persisted collapsed/expanded state
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 9.5 Write property tests for node operations
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

  - [ ]* 9.6 Write unit tests for `editorStore` node mutations
    - Test `addNode` appends child with unique ID; test `deleteNode` removes all descendants; test `editNodeText` rejects whitespace; test `toggleCollapse` persists state; test undo stack grows and is capped at 50
    - _Requirements: 7.2, 8.5, 9.2, 12.5, 25.4_

- [ ] 10. Keyboard shortcuts
  - [ ] 10.1 Implement keyboard shortcut handler in `EditorPage`
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

  - [ ]* 10.2 Write component tests for keyboard shortcuts
    - Use `@testing-library/user-event`; assert each shortcut triggers the expected store action; assert shortcuts do not fire when input is focused
    - _Requirements: 16.1, 16.3_

- [ ] 11. Checkpoint — MVP editor interactions complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Trash screen
  - [ ] 12.1 Implement `TrashPage` with restore and empty-trash actions
    - Fetches `GET /api/trash` on mount; renders `TrashCard[]` (title, restore button) or empty state
    - Restore: calls `restoreMap(mapId)`, removes card from list, shows success feedback
    - "Empty Trash" button: confirmation dialog; calls `emptyTrash()`; clears list
    - Link from `MapListPage` header to `/trash`
    - _Requirements: 6.4, 6.5, 6.6, 6.9, 6.10, 6.11_

  - [ ]* 12.2 Write component tests for `TrashPage`
    - Mock API; test renders trash cards and empty state; test restore removes card; test empty-trash confirmation
    - _Requirements: 6.4, 6.5, 6.6_

- [ ] 13. Schema versioning and migration infrastructure
  - [ ] 13.1 Implement schema version validation and migration pipeline in `MapFileStore`
    - On `readMap()`: after JSON parse, check `schemaVersion`; if version > server's max supported → reject with error (log version and max); if version < minimum migration version → reject with error (log "too old")
    - If version < current and ≥ minimum → run migration chain; overwrite file with migrated content
    - Migration registry: `migrations: Record<number, (old: unknown) => unknown>`; currently only version 1 → 1 (identity, no migration needed yet, but registry is in place)
    - All reads return Zod-validated `MapFile`; any validation failure logged and returned as error
    - _Requirements: 21.4, 21.5, 21.6, 21.7, 21.8_

  - [ ]* 13.2 Write unit tests for schema versioning
    - Test version-too-high rejection; test version-too-old rejection; test identity migration for v1 → v1; test that corrupt-field file is rejected with field-level error message
    - _Requirements: 21.4, 21.5, 21.6_

- [ ] 14. Checkpoint — MVP complete, all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Duplicate map (Post-MVP)
  - [ ]* 15.1 Implement duplicate map API endpoint and UI
    - `POST /api/maps/:mapId/duplicate`: deep-copies `MapFile`; assigns new Map ID and new Node IDs to every node; appends " (Copy)" to title; writes new file; returns new `MapSummary`
    - Add duplicate action to `MapCard`; on success append new card to list without page reload
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 15.2 Write unit tests for duplicate endpoint
    - Assert new Map ID is different; assert all Node IDs differ from source; assert title ends with " (Copy)"; assert `revision=1` on new file
    - _Requirements: 5.2, 5.3_

- [ ] 16. Rearrange sibling nodes (Post-MVP)
  - [ ]* 16.1 Implement `reorderNode` in `editorStore` and keyboard shortcuts
    - `reorderNode(nodeId, newIndex)`: changes sibling order under same parent; pushes snapshot; persists
    - Keyboard: `Alt+ArrowUp` / `Alt+ArrowDown` on selected node reorders among siblings
    - _Requirements: 10.1, 10.3, 10.4, 10.5_

  - [ ]* 16.2 Implement drag-to-reorder sibling UI in `MindMapCanvas`
    - Enable React Flow node drag within same parent; show position indicator during drag
    - On drop call `reorderNode()`; on Escape restore original order
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 17. Move branches (Post-MVP)
  - [ ]* 17.1 Implement `moveNode` in `editorStore`
    - `moveNode(nodeId, newParentId, index)`: validates no-cycle (not self, not descendant, not same parent); moves node and all descendants under new parent; pushes snapshot; persists
    - _Requirements: 11.1, 11.3, 11.5, 11.6_

  - [ ]* 17.2 Implement drag-to-reparent UI in `MindMapCanvas`
    - On node drag-and-drop onto another node (not self/descendant/same parent): call `moveNode()`; animate layout change within 300ms
    - On invalid target: show inline error indicator, reject move
    - On server failure: revert to previous parent, show auto-dismiss toast (3s)
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6_

- [ ] 18. Visual customization (Post-MVP)
  - [ ]* 18.1 Add `NodeStyle` persistence and rendering
    - `editorStore`: add `updateNodeStyle(nodeId, style: Partial<NodeStyle>)` action; pushes snapshot, persists
    - `MindMapNode`: apply `backgroundColor`, `textColor` from `node.style` if present; fall back to theme defaults
    - `MindMapEdge`: apply `connectorColor`, `connectorStyle`, `connectorWidth` from source node's `style`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [ ]* 18.2 Implement color picker UI in `NodeContextMenu`
    - Color picker panel: background color, text color, connector color (full hue range)
    - Line style selector: solid / dashed / dotted; thickness slider 1–8px
    - _Requirements: 15.1, 15.2, 15.3, 15.5_

- [ ] 19. Light and dark theme (Post-MVP)
  - [ ]* 19.1 Implement theme toggle with localStorage persistence
    - Add theme toggle control to `MapListPage` header and `EditorToolbar`
    - Apply theme via CSS custom properties on `<html>` element before first render (read from `localStorage`); fall back to `prefers-color-scheme`; final fallback is light theme
    - Persist selected theme in `localStorage`; apply within 300ms of toggle
    - Handle `localStorage` unavailable: apply for session only
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

- [ ] 20. JSON export and import (Post-MVP)
  - [ ]* 20.1 Implement JSON export (client-side download)
    - Export action in `EditorToolbar`: serializes in-memory `MapFile` with `JSON.stringify`, creates `Blob`, triggers download as `{sanitizedTitle}.json`
    - Exported file conforms to current `MapFileSchema`; no server-side paths or host identifiers
    - On failure: show error toast, cancel download
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [ ]* 20.2 Implement JSON import API endpoint and UI
    - `POST /api/maps/import`: Zod-validates body against supported schema versions; discards incoming `id`, assigns new Map ID; checks Node ID conflicts across all existing files, replaces conflicts with new UUIDs; runs migration if older schema; writes file; returns new `MapSummary`
    - Import action in `MapListPage`: `<input type="file" accept=".json">`; reads with `FileReader`; POSTs; on success appends to map list without reload
    - Error cases: invalid JSON → error dialog; unsupported schema version → error dialog with detected version
    - _Requirements: 19.1, 19.2, 19.3, 19.3a, 19.4, 19.5, 19.6_

  - [ ]* 20.3 Write integration tests for import endpoint
    - Test valid v1 import; test Node ID conflict replacement; test invalid JSON rejection; test unsupported schema version rejection
    - _Requirements: 19.1, 19.3, 19.4, 19.5_

- [ ] 21. PNG export (Post-MVP)
  - [ ]* 21.1 Implement PNG export using html-to-image
    - Export action in `EditorToolbar`: create local copy of tree with all nodes expanded; re-run layout; call `toPng` on React Flow container with `pixelRatio: 2`; download as `{sanitizedTitle}.png`
    - Restore collapsed state after export; export uses white background, no UI chrome
    - On failure: show error toast, cancel download
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

- [ ] 22. Undo and redo (Post-MVP)
  - [ ]* 22.1 Extend `editorStore` with full undo/redo and keyboard shortcuts
    - Add `undoStack: MapFile[]`, `redoStack: MapFile[]` to `editorStore`
    - All existing node mutation actions already push snapshots (from task 9.1); add `undo()` and `redo()` actions
    - `undo()`: pops snapshot from `undoStack`, pushes current state to `redoStack`, sets as live map, calls `saveMap()`; no-op if stack empty
    - `redo()`: pops from `redoStack`, pushes to `undoStack`, sets as live map, calls `saveMap()`; no-op if stack empty
    - Cap `undoStack` at 50; clear `redoStack` on any new operation
    - `Ctrl+Z` / `Cmd+Z`: `undo()`; `Ctrl+Shift+Z` / `Ctrl+Y` / `Cmd+Shift+Z`: `redo()`
    - Undo/redo buttons in `EditorToolbar`; disable when respective stack is empty
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7, 25.8, 16.1_

  - [ ]* 22.2 Write property tests for undo/redo correctness
    - **Property 20: Undo reverses the most recent operation**
    - **Validates: Requirements 25.2**
    - **Property 21: Undo then redo is an identity operation**
    - **Validates: Requirements 25.3**
    - Use fast-check to generate sequences of node operations; assert undo returns prior state; assert undo+redo is identity

  - [ ]* 22.3 Write unit tests for undo/redo boundary conditions
    - Test 50-op cap (oldest dropped); test undo no-op when stack empty; test redo no-op when stack empty; test redo stack cleared on new operation
    - _Requirements: 25.4, 25.7, 25.8_

- [ ] 23. Final checkpoint — all tests pass, Docker build verified
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP delivery
- Each task references specific requirements for traceability
- Checkpoints (tasks 6, 11, 14, 23) are natural integration points to verify the running application
- Property tests validate universal correctness properties across many generated inputs; unit tests validate specific examples and edge cases
- The undo/redo snapshot infrastructure (task 9.1) is wired in during MVP so post-MVP task 22.1 only needs to add the keyboard shortcuts and UI controls — the stack mechanics are already present
- `npm run dev` (not `vitest --watch`) should be run manually in a terminal for local development; use `npm test` (runs `vitest --run`) for CI and automated verification

---

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
    { "id": 24, "tasks": ["22.2", "22.3"] }
  ]
}
```
