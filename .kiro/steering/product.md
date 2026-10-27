# Product

Maplora is a self-hosted, single-user hierarchical mind-map editor for organizing thoughts, planning and brainstorming.

The browser renders a tree with one central root, branches on both sides, inline node editing, keyboard navigation, sibling reordering with shortcuts or dragging, branch moves by dragging onto a new parent, node options on selection with per-node colors and connector styling, collapse/expand and pan/zoom. Light/dark controls persist the browser preference and otherwise default to the system scheme at startup. Map management includes creation, renaming, duplication, trash and restoration. The library filters titles locally as you type and offers date/title sorting with a browser-persisted preference. Changes save automatically as versioned JSON files on the host filesystem.

The MVP has no database, accounts, authentication or external services. Deployment is one Docker Compose service. Data remains portable by copying the complete data directory, including trash.

The authoritative scope is `.kiro/specs/maplora/requirements.md`, with architecture in `design.md` and implementation progress in `tasks.md`. Post-MVP duplication, sibling reordering, branch moves, visual customization, light/dark themes and library search/sorting are implemented. Import/export and undo/redo remain planned enhancements.
