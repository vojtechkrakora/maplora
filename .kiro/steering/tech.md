# Tech Stack

Maplora follows the approved mind-map architecture in `.kiro/specs/maplora/`.

- TypeScript npm workspace with client, server, and shared schema/tree utilities.
- React 18, React Router v6, Zustand, React Flow, d3-flextree bilateral layout.
- Vite and Tailwind CSS v4; system color scheme and system fonts.
- Hono on Node.js 22; Zod validates requests and versioned JSON files.
- No database, authentication, external APIs, or runtime cloud services.
- One Docker container serves both the compiled SPA and REST API. All map data lives in the bind-mounted `DATA_DIR`.

## Commands

- `npm ci` — install the locked dependencies (Node 22.12+).
- `DATA_DIR=./data npm run dev` — Vite on 5173 and API on 3000; create the local data directory first.
- `npm test` — Vitest server/client tests, fast-check properties, and live HTTP integration tests.
- `npm run test:coverage` — run tests with V8 coverage.
- `npm run build` — check client types, bundle SPA, compile server.
- `npm run verify:compose` — isolated Docker build/run/persistence verification.
- `docker compose up --build -d` — production deployment on port 3000 by default.

MVP scope ends at task 14, with deployment verification at task 23. Keep post-MVP feature tasks unchecked until separately requested. Preserve optional style fields in the file schema, but do not add customization UI.
