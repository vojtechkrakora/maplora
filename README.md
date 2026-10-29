# Maplora

A self-hosted, single-user mind map editor. React and React Flow run in the browser; one Hono/Node.js server serves the application and stores each map as a JSON file. No database, accounts, cloud services, or internet connection are needed during use.

## Run with Docker Compose

Install Docker Engine with the Compose plugin (or Docker Desktop), then run from this repository:

```sh
docker compose up --build -d
```

Open **http://localhost:3000**. Compose creates `./data` and bind-mounts it at `/data` inside the container. The image builds the frontend and backend together and runs one Node.js 22 process.

Optional configuration:

```sh
cp .env.example .env
# Edit HOST_PORT and DATA_PATH in .env, then:
docker compose up --build -d
```

`HOST_PORT` defaults to `3000`; `DATA_PATH` defaults to `./data`. The host data directory must be readable and writable by the container. For a Synology deployment, set `DATA_PATH` to an existing shared-folder location with suitable permissions. No separate web server is required.

```sh
docker compose logs -f maplora
docker compose stop                 # Stop; retain all data
docker compose up -d                # Start again
docker compose up --build -d        # Rebuild and recreate; retain the bind mount
```

The application has no authentication. Deploy it within a trusted private network or behind your own access-controlled reverse proxy. Run only one Maplora server against a given data directory; file locks serialize requests within that process.

## Editing

- Create, rename, duplicate, and open maps from the home screen. Titles accept 1–100 characters.
- Search the library by a case-insensitive part of a title. Results update as you type; **Clear search** restores the full list when there are no matches. Sort by last edited (newest or oldest first) or title (A → Z or Z → A). The browser remembers the sort order; missing, invalid, or unavailable storage defaults to newest first. If saving the preference fails, sorting still works for the current app session. Filtering and sorting use the loaded list without additional server requests. Unreadable files remain searchable by filename and appear last in date sorts.
- Choose **Tags** on a library card to add or remove tags; each change saves automatically. Tags accept 1–32 characters, cannot be all whitespace or contain commas, and are limited to 20 per map. Existing tags are suggested alphabetically as you type. Tags retain their exact spelling and case; the editor prevents adding the same tag twice. Cards show the first five tags and a “+N” count for the rest. **Filter by tags** matches every selected tag and combines with title search and sorting, entirely in browser memory. **Clear all tags** clears the selection.
- **Duplicate** creates an independent copy with fresh map and node IDs, a new creation time, and revision 1. Its title ends in “ (Copy)”; long source titles are shortened to keep the result within 100 characters. Labels, branch order, collapse states, tags, and stored styles are preserved.
- Select a node and use the floating toolbar, double-click, or keyboard shortcuts. Node labels accept 1–200 characters.
- Changes save automatically. The toolbar reports saving, saved, and failed states. Failed mutations roll back and offer **Retry change**, except branch moves, which show a temporary error and can be dragged again.
- **Undo / Redo** in the editor toolbar restores the last 50 node changes, including additions, deletions, text edits, branch moves, sibling order, styling and collapse state. Each undo or redo saves automatically. New changes clear redo; failed saves restore the canvas and history and offer retry. Finish or cancel text editing before using the buttons; text fields retain native undo shortcuts. History resets when you reopen or reload a map.
- A new node is a local draft until you confirm its text. Escape or an empty draft cancels it without a write.
- Branches arrange themselves on both sides of the root. Collapse controls hide descendants while preserving their individual collapse states.
- Reorder a selected sibling with **Alt+Up / Alt+Down**, or drag it onto the top/bottom quarter of another sibling to insert before/after it. A line marks the insertion point. A failed save restores the previous order and offers retry.
- Sibling reordering preserves each branch's contents and parent. Reordering root children can switch their side because the layout alternates right and left.
- Move a branch by dragging onto the centre of its new parent. A highlighted outline marks the destination, which expands after the move. The complete subtree, IDs, and stored styles are preserved. The root cannot be moved; self, descendant, and current-parent targets show an inline error. Escape or a drop outside valid targets cancels without saving. A failed save restores the previous tree and shows an error for three seconds or until the next interaction; drag again to retry.
- Click a node to open its options panel and customize its background and text colors. Connector settings control lines from that node to its children: color, solid/dashed/dotted pattern, and 1–8px thickness. The panel also opens on right-click. Native color pickers cover the full hue range. Preview changes in the panel, then choose **Apply style** to save. **Reset** removes an individual override; **Restore theme defaults** clears all styling on that node. Cancel, Escape, clicking the canvas, or selecting another node discards unapplied changes. The canvas stays interactive; double-click edits text and dragging closes the options panel.
- Default node backgrounds follow tree depth, using six distinct colors in each theme and repeating after depth 5. Nodes at the same depth share a color on both sides of the map. Branch moves update these defaults automatically. Custom backgrounds override the palette; resetting a background or restoring theme defaults brings back the current depth's color. The picker and preview show the same default as the node.
- Switch between light and dark using the moon/sun button in the library header or editor toolbar. The choice is saved in this browser and applied before the app renders on later visits. Without a saved choice, startup follows the system color scheme, falling back to light when it cannot be detected. If browser storage is blocked, the toggle works for the current app session. Theme changes keep custom node and connector colors intact.
- Use **Copy as Markdown** in the editor toolbar (the copy icon on narrow screens) to share the current map as text: the root label becomes a heading, and descendants become nested bullets, including collapsed branches in their stored order. Special characters are preserved verbatim. Copying does not save or change the map; unconfirmed draft nodes and text still being typed are excluded. Success shows a two-second confirmation. If the browser cannot access the clipboard or denies the write, an error appears and you can retry.
- **Export JSON** in the editor toolbar downloads the current in-memory map as a portable file named after its title (the download icon on narrow screens). It includes all nodes, including collapsed descendants, IDs, timestamps, tags and styles. Export does not save or change the map; unconfirmed drafts and text still being typed are excluded. Download failures show an error and allow retry.
- **Export PNG** in the editor toolbar downloads the complete map as an image named after its title (the picture icon on narrow screens). It renders all collapsed descendants in a separate copy, preserving the current theme's node colors, custom styling, connectors, text and emoji on a white background. The image uses twice the map's natural pixel dimensions, independently of your screen size or zoom, and omits toolbars, collapse buttons, selection outlines and other controls. Export preserves the live editor's collapse state, selection, viewport, active text input and drafts without saving. A progress message appears during rendering; failures show an error and allow retry. Leaving the editor cancels an unfinished export.
- **Import JSON** in the library opens a file picker. Valid Maplora files appear as new cards without reloading the list; search and tag filters clear so the imported map is visible, while your sort preference is retained. Each import gets a new map ID and revision 1, preserving timestamps, labels, branch order, collapse states, tags and styles. Node IDs are preserved unless they conflict with IDs in existing maps, including trash; only conflicts receive new IDs. Import leaves existing files unchanged. Invalid JSON, invalid map data and unsupported schema versions show an error dialog without creating a file. You can close the dialog and retry the same file. Schema v1 is currently the only supported format.
- Drag the canvas to pan. Scroll to zoom around the cursor. Zoom buttons adjust by 10 percentage points, bounded at 10%–200%; **Fit to screen** adjusts the viewport.

| Key | Action |
| --- | --- |
| Tab / Insert | Add child |
| Enter | Add sibling after selection (except the root) |
| F2 / double-click | Edit node |
| Delete / Backspace | Delete branch; confirm if it contains descendants |
| Space | Collapse / expand (except the root) |
| Up / Down | Previous / next sibling |
| Alt + Up / Down | Move selected sibling earlier / later |
| Left / Right | Parent / first visible child |
| Ctrl+Z / Cmd+Z | Undo |
| Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y | Redo |
| Escape | Cancel editing or close a dialog |
| ? | Shortcut reference |

Node shortcuts do not run while typing in a text field. The root cannot be deleted or collapsed. Map title and root label can be edited independently.

## Storage, trash, and backups

Maps are `DATA_PATH/{uuid}.json` files using schema version 1. Each file includes a stable map ID, node IDs, timestamps, revision, title, ordered tags, and hierarchical root node. Older schema v1 files without tags load with an empty tag list; reading them does not rewrite or migrate them. Newly created maps store `tags: []`. Renaming preserves its filename. Files are validated when loaded. Corrupt files remain visible as error entries without preventing other maps from loading.

Each save writes a temporary file in the same directory, syncs and closes it, then atomically renames it over the original. Failed writes clean up temporary files and preserve the previous file. Stale revisions return HTTP 409; the client fetches the latest map, reapplies the pending operation, and retries once. Unrelated changes from another tab are retained.

Deleting a map moves it into `DATA_PATH/_trash`. Open **Trash** to confirm restoration or permanently empty it. Maps in trash cannot be opened in the editor. If another tab deletes the current map, its next save returns you to the list.

For a consistent full backup, stop the application and copy the entire host data directory, including `_trash`, then restart it. To restore, stop the application, restore that directory, keep `DATA_PATH` pointing to it, and restart. Nothing else contains persistent map state. Use a filesystem supporting atomic rename within a directory; both files in a save are on the same mount. Interrupted saves may leave unused `.tmp.*` files, which are ignored by the map list.

## Local development

Use Node.js 22.12 or newer (Node 22 is the deployment target):

```sh
npm ci
mkdir -p data
DATA_DIR=./data npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to the Hono server on port 3000. The production server reads `DATA_DIR` (default `/data`) and `PORT` (default `3000`). It refuses to start if its data directory is unavailable; it never falls back to another location.

```sh
npm test                     # Vitest: server, client, property and live HTTP tests
npm run test:coverage        # V8 coverage report
npm run build               # Client type check, Vite bundle, server TypeScript build
DATA_DIR=./data npm start    # Serve the production build at localhost:3000
npm run verify:compose      # Build, run and verify an isolated Compose deployment
```

The Compose verification requires a working local Docker daemon. It uses a separate project, a free local port and a temporary directory in this repository, checks static assets (including the PNG export module) and the API, updates tags, imports a map with conflicting IDs, restarts and recreates the container, and verifies persisted original, duplicate and imported map data before cleanup.

## Scope and limitations

This implements MVP tasks 1–14, post-MVP tasks 15–22 (duplicate maps, reorder siblings, move branches, visual customization, light/dark themes, JSON export/import, PNG export, and undo/redo), tasks 24–27 (library search/sorting, Copy as Markdown, depth-based node colors, and map tags), and the Docker verification checkpoint in the Kiro plan. Tasks and test coverage are tracked in `.kiro/specs/maplora/tasks.md`.

Root prominence and re-centering (task 28) remain unimplemented. Tag filters last for the current app session; import clears them to reveal the imported map. Tag changes in another tab become visible after reloading the library.

Undo/redo history is kept in browser memory for the current map session. History restores the complete node tree while retaining current map metadata and increasing the revision. On a stale revision, undo/redo retries the snapshot against the latest file; this can replace tree changes made in another tab, so use one editor tab per map. Theme preferences are local to each browser; map files retain only per-node styling. Schema v1 is the only supported version; loading and importing share a migration registry ready for future versions, but no fictional older format is accepted. Import scans existing active and trashed files for node ID conflicts; malformed JSON has no usable tree and is skipped, while IDs in parseable invalid maps are still reserved. An unreadable existing file aborts import so it cannot silently miss conflicts.

PNG export uses the architecture's `html-to-image` library, loaded on demand. Version 1.11.11 is pinned following the [React Flow export example](https://reactflow.dev/examples/misc/download-image), which documents problems in later releases. The application uses system fonts and no external image assets. Large exports are rejected if their 2× image would exceed 32,767 pixels on either side or 64 million pixels in total; browser-specific canvas limits may be lower. An error is shown instead of downloading a silently reduced or clipped image. Rendering also fails visibly if the complete flow cannot initialize within 15 seconds.

Maps above 500 nodes show a performance warning. Measurements and layout run synchronously as specified by the approved `useMemo` implementation; unusually large maps can exceed the stated responsiveness targets. Multi-tab edits retry once; an operation whose target was deleted in another tab fails visibly rather than recreating it. Multi-process writers and external edits during use are unsupported.

The architecture specifies React Router v6. `npm audit` currently reports two moderate advisories in `react-router` / `react-router-dom`; their offered fixes require Router v7. The application uses fixed local navigation targets and client-only rendering; it does not use SSR hydration. Router v6 is retained to honor the approved architecture. The initial Node.js image and npm dependencies require internet access to build; the deployed application loads all assets locally.
