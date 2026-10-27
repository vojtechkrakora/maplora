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
- **Duplicate** creates an independent copy with fresh map and node IDs, a new creation time, and revision 1. Its title ends in “ (Copy)”; long source titles are shortened to keep the result within 100 characters. Labels, branch order, collapse states, and stored styles are preserved.
- Select a node and use the floating toolbar, double-click, or keyboard shortcuts. Node labels accept 1–200 characters.
- Changes save automatically. The toolbar reports saving, saved, and failed states. Failed mutations roll back and offer **Retry change**.
- A new node is a local draft until you confirm its text. Escape or an empty draft cancels it without a write.
- Branches arrange themselves on both sides of the root. Collapse controls hide descendants while preserving their individual collapse states.
- Drag the canvas to pan. Scroll to zoom around the cursor. Zoom buttons adjust by 10 percentage points, bounded at 10%–200%; **Fit to screen** adjusts the viewport.

| Key | Action |
| --- | --- |
| Tab / Insert | Add child |
| Enter | Add sibling after selection (except the root) |
| F2 / double-click | Edit node |
| Delete / Backspace | Delete branch; confirm if it contains descendants |
| Space | Collapse / expand (except the root) |
| Up / Down | Previous / next sibling |
| Left / Right | Parent / first visible child |
| Escape | Cancel editing or close a dialog |
| ? | Shortcut reference |

Node shortcuts do not run while typing in a text field. The root cannot be deleted or collapsed. Map title and root label can be edited independently.

## Storage, trash, and backups

Maps are `DATA_PATH/{uuid}.json` files using schema version 1. Each file includes a stable map ID, node IDs, timestamps, revision, title, and hierarchical root node. Renaming preserves its filename. Files are validated when loaded. Corrupt files remain visible as error entries without preventing other maps from loading.

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

The Compose verification requires a working local Docker daemon. It uses a separate project, a free local port and a temporary directory in this repository, checks static assets and the API, restarts and recreates the container, and verifies persisted map data before cleanup.

## Scope and limitations

This implements MVP tasks 1–14, post-MVP task 15 (duplicate maps), and the Docker verification checkpoint in the Kiro plan. Tasks and test coverage are tracked in `.kiro/specs/maplora/tasks.md`. The bounded snapshot infrastructure requested by task 9.1 is present; undo/redo controls and shortcuts are intentionally deferred with task 22.

Drag-to-reorder/reparent, custom styles, manual theme switching, import/export, PNG export, and undo/redo remain deferred to tasks 16–22. The UI follows the system color scheme. Schema v1 is the only supported version; a migration registry is ready for future versions, but no fictional older format is accepted.

Maps above 500 nodes show a performance warning. Measurements and layout run synchronously as specified by the approved `useMemo` implementation; unusually large maps can exceed the stated responsiveness targets. Multi-tab edits retry once; an operation whose target was deleted in another tab fails visibly rather than recreating it. Multi-process writers and external edits during use are unsupported.

The architecture specifies React Router v6. `npm audit` currently reports two moderate advisories in `react-router` / `react-router-dom`; their offered fixes require Router v7. The application uses fixed local navigation targets and client-only rendering; it does not use SSR hydration. Router v6 is retained to honor the approved architecture. The initial Node.js image and npm dependencies require internet access to build; the deployed application loads all assets locally.
