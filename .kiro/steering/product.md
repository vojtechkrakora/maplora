# Product

Maplora is a self-hosted, single-user hierarchical mind-map editor for organizing thoughts, planning and brainstorming.

The browser renders a tree with one central root, branches on both sides, inline node editing, keyboard navigation, collapse/expand and pan/zoom. Map management includes creation, renaming, trash and restoration. Changes save automatically as versioned JSON files on the host filesystem.

The MVP has no database, accounts, authentication or external services. Deployment is one Docker Compose service. Data remains portable by copying the complete data directory, including trash.

The authoritative scope is `.kiro/specs/maplora/requirements.md`, with architecture in `design.md` and implementation progress in `tasks.md`. Duplication, rearranging/reparenting, custom styling, manual theme switching, import/export and undo/redo remain post-MVP.
