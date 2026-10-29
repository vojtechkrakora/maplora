# Requirements Document

## Introduction

Maplora is a self-hosted, single-user mind mapping web application. It provides an intuitive visual workspace for organizing thoughts, planning projects, brainstorming, and exploring complex topics. Mind maps follow a strict hierarchical tree structure, with a single central root node from which branches and sub-branches grow outward. All data is persisted as files on the host filesystem with no database dependency. The application is deployed via Docker and accessed through a standard web browser.

## Glossary

- **Mind Map**: A hierarchical tree structure consisting of a single root node and zero or more descendant nodes organized as branches and sub-branches.
- **Node**: A single element in a mind map containing a text label. Every node except the root has exactly one parent.
- **Root Node**: The unique central node of a mind map from which all branches originate. A mind map contains exactly one root node.
- **Branch**: A subtree consisting of a node and all of its descendants.
- **Parent Node**: A node that has one or more direct child nodes.
- **Child Node**: A node that is directly connected to and descends from another node.
- **Canvas**: The visual workspace area in the browser where the mind map is rendered and interacted with.
- **Map File**: A JSON file on the host filesystem that stores all data for a single mind map.
- **Data Directory**: The host filesystem directory where all Map Files are stored, mounted into the container via a Docker bind mount.
- **Schema Version**: An integer embedded in every Map File that identifies the file format version.
- **Map ID**: A stable, globally unique identifier (UUID v4) assigned to a mind map at creation time and never changed.
- **Node ID**: A stable, globally unique identifier (UUID v4) assigned to a node at creation time and never changed.
- **Editor**: The in-browser visual component used to view and edit a mind map.
- **Application**: The Maplora web application as a whole.
- **Server**: The backend process that serves the Application and manages Map Files.
- **API**: The HTTP interface exposed by the Server for map management and persistence operations.
- **Trash Directory**: A subdirectory named `_trash` within the Data Directory where Map Files are moved when a user deletes a mind map. Files in the Trash Directory are not shown in the main map list.
- **Revision**: A monotonically increasing integer stored in every Map File and incremented on every successful write, used to detect and reject stale save requests.

---

## MVP Requirements

The following requirements constitute the Minimum Viable Product (MVP) and must be satisfied before the application is considered functionally usable.

### MVP — Core Editing

| Requirement | Description |
|---|---|
| 1 | Mind Map List |
| 2 | Create Mind Map |
| 3 | Open and Edit a Mind Map |
| 4 | Rename a Mind Map |
| 6 | Delete a Mind Map (trash-based) |
| 7 | Add Nodes |
| 8 | Edit Node Text |
| 9 | Delete Nodes |
| 12 | Collapse and Expand Branches |
| 13 | Canvas Navigation — Zoom and Pan |
| 14 | Automatic Layout |
| 16 | Keyboard Shortcuts |

### MVP — Persistence and Deployment

| Requirement | Description |
|---|---|
| 21 | Map File Schema and Versioning |
| 22 | Safe File Writes |
| 23 | Docker Deployment |
| 24 | Data Persistence and Backup |

### Post-MVP Enhancements

The following requirements are planned enhancements to be implemented after the MVP is stable:

| Requirement | Description | Notes |
|---|---|---|
| 5 | Duplicate a Mind Map | Useful but not essential for initial use |
| 10 | Rearrange Nodes | Drag-to-reorder sibling ordering |
| 11 | Move Branches | Drag-to-reparent; complex interaction |
| 15 | Visual Customization | Node and branch color/style |
| 17 | Light and Dark Theme | Defaults to system preference in MVP |
| 18 | Export to JSON | Import/export pair |
| 19 | Import from JSON | Import/export pair |
| 20 | Export to PNG | Image sharing |
| 25 | Undo and Redo | History depth ≥ 50 operations |
| 26 | Map Library Search and Sorting | Client-side filtering and sort persistence |
| 27 | Copy as Markdown | Clipboard export for sharing via chat or email |
| 28 | Map Tags | Tag assignment, autocomplete, AND-filter in map library |
| 29 | Recently Opened Maps Bar | Quick switching between maps from within the editor |

---

## Requirements

### Requirement 1: Mind Map List

**User Story:** As a user, I want to view a list of all my existing mind maps, so that I can find and open any map quickly.

#### Acceptance Criteria

1. WHEN the user navigates to the home screen, THE Application SHALL display a list of all mind maps found in the Data Directory.
2. WHEN the Data Directory contains no Map Files, THE Application SHALL display an empty-state message prompting the user to create a new mind map.
3. THE Application SHALL display each mind map's title and last-modified timestamp in the list, with the timestamp formatted as a human-readable date and time using the user's locale.
4. THE Application SHALL sort mind maps in the list by last-modified timestamp in descending order by default.
5. WHEN the user opens the Application, THE Application SHALL load and display the mind map list within 1 second for up to 500 maps.
6. IF a Map File in the Data Directory cannot be parsed, THEN THE Application SHALL display that entry in the list using the filename as a title fallback, omit the timestamp, show a visual error indicator, and SHALL NOT prevent other maps from loading.

---

### Requirement 2: Create Mind Map

**User Story:** As a user, I want to create a new mind map with a title, so that I can start organizing a new idea.

#### Acceptance Criteria

1. WHEN the user initiates the create action, THE Application SHALL prompt the user to enter a title for the new mind map.
2. WHEN the user confirms creation with a non-empty title of 1 to 100 characters, THE Server SHALL create a new Map File in the Data Directory containing a single root node labeled with the provided title, a Map ID, a root Node ID, a schemaVersion, and created and last-modified timestamps.
3. THE Server SHALL assign a unique Map ID (UUID v4) to the new mind map at creation time.
4. THE Server SHALL assign a unique Node ID (UUID v4) to the root node at creation time.
5. WHEN the Map File is successfully created, THE Application SHALL open the Editor for the new mind map within 2 seconds.
6. IF the user submits an empty, whitespace-only, or greater-than-100-character title, THEN THE Application SHALL display a validation error and SHALL NOT create the map.
7. IF the Server fails to write the Map File, THEN THE Application SHALL display an error message and SHALL NOT navigate away from the list screen.

---

### Requirement 3: Open and Edit a Mind Map

**User Story:** As a user, I want to open an existing mind map in the Editor, so that I can view and modify it.

#### Acceptance Criteria

1. WHEN the user selects a mind map from the list, THE Application SHALL open the Editor and render the selected mind map with all nodes and connections visible.
2. WHILE the Editor is displaying a mind map, THE Editor SHALL display the mind map as a hierarchical tree layout with the root node positioned at the center of the visible viewport.
3. WHEN the Editor opens a mind map containing up to 500 nodes, THE Application SHALL complete loading and rendering all nodes within 2 seconds.
4. WHEN the Editor opens a mind map containing more than 500 nodes, THE Application SHALL display a performance warning and SHALL still render the map, though response time is not guaranteed.
5. IF the Map File cannot be read when opening a map, THEN THE Application SHALL display an error message indicating the file could not be read and SHALL return the user to the list screen.
6. THE Editor SHALL render the root node in a visually distinct style from all other nodes, using a larger size, stronger visual weight (e.g. bolder text, more prominent border), or a dedicated accent color, so that the root node is immediately recognizable as the centre of the map regardless of the tree's shape or size.

---

### Requirement 4: Rename a Mind Map

**User Story:** As a user, I want to rename an existing mind map, so that I can keep my maps organized with accurate titles.

#### Acceptance Criteria

1. WHEN the user initiates the rename action on a mind map, THE Application SHALL present an input field pre-populated with the current title, accepting a title of 1 to 100 characters.
2. WHEN the user confirms a non-empty title (via button click or Enter key), THE Server SHALL update the mind map's title in the Map File and update the last-modified timestamp, and THE Application SHALL update the displayed title immediately.
3. THE Server SHALL NOT change the Map File's filename or the mind map's Map ID when renaming.
4. IF the user submits an empty, whitespace-only, or greater-than-100-character title, THEN THE Application SHALL display a validation error and SHALL NOT save the rename.
5. IF the Server fails to save the renamed title, THEN THE Application SHALL display an error message and SHALL retain the previous title.
6. WHEN the user dismisses or cancels the rename dialog without confirming, THE Application SHALL close the dialog and retain the previous title without any changes.

---

### Requirement 5: Duplicate a Mind Map

**User Story:** As a user, I want to duplicate an existing mind map, so that I can use an existing map as a starting point for a new one.

#### Acceptance Criteria

1. WHEN the user initiates the duplicate action on a mind map, THE Server SHALL create a new Map File that is a deep copy of the source map.
2. THE Server SHALL assign a new unique Map ID to the duplicated map.
3. THE Server SHALL assign new unique Node IDs to every node in the duplicated map.
4. THE Server SHALL append " (Copy)" to the title of the duplicated map.
5. WHEN the duplicate is created, THE Application SHALL display the duplicated map in the list without requiring a page reload.
6. IF the Server fails to write the duplicated Map File, THEN THE Application SHALL display an error message.

---

### Requirement 6: Delete a Mind Map

**User Story:** As a user, I want to delete a mind map I no longer need and be able to recover it if I change my mind, so that accidental deletion does not result in permanent data loss.

#### Acceptance Criteria

1. WHEN the user initiates the delete action on a mind map, THE Application SHALL display a confirmation dialog that includes the name of the map being deleted before proceeding.
2. WHEN the user confirms deletion, THE Server SHALL move the corresponding Map File from the Data Directory into a `_trash` subdirectory within the Data Directory, rather than permanently deleting it.
3. WHEN the Map File has been moved to the trash, THE Application SHALL remove the map from the main list without requiring a page reload.
4. THE Application SHALL provide a trash view accessible from the main list screen that displays all maps currently in the `_trash` subdirectory.
5. WHEN the user selects a map in the trash view and confirms restoration, THE Server SHALL move the Map File back from the `_trash` subdirectory to the Data Directory and THE Application SHALL display the map in the main list.
6. THE Application SHALL provide a "Empty Trash" action in the trash view; WHEN the user confirms this action, THE Server SHALL permanently delete all Map Files in the `_trash` subdirectory.
7. WHEN the user cancels the initial confirmation dialog, THE Application SHALL take no action and SHALL close the dialog.
8. IF the Server fails to move the Map File to the trash, THEN THE Application SHALL display an error message and SHALL retain the map in the main list.
9. IF the map being deleted is currently open in the Editor, THEN THE Application SHALL close the Editor and return the user to the list screen after the map is successfully moved to trash.
10. THE Application SHALL NOT open or render maps stored in the `_trash` subdirectory in the Editor.
11. Map Files in the `_trash` subdirectory SHALL NOT be included in the map count or list on the home screen.

---

### Requirement 7: Add Nodes

**User Story:** As a user, I want to add child nodes to any existing node, so that I can grow my mind map hierarchy.

#### Acceptance Criteria

1. WHEN the user triggers the add-child action on a node, THE Editor SHALL create a new child node attached to the selected node and SHALL place the new node in an inline editing state.
2. THE Server SHALL assign a unique Node ID (UUID v4) to each new node at creation time.
3. THE Editor SHALL support adding child nodes at any depth level with no enforced depth limit.
4. WHEN the user confirms the new node's text, THE Server SHALL persist the updated map to the Map File.
5. IF the user cancels the new node entry or provides only whitespace text, THEN THE Editor SHALL remove the pending node and SHALL NOT persist any change.
6. IF the Server fails to persist the new node, THEN THE Editor SHALL display an error message and SHALL remove the pending node from the canvas.

---

### Requirement 8: Edit Node Text

**User Story:** As a user, I want to edit the text of any node, so that I can update or correct the content of my mind map.

#### Acceptance Criteria

1. WHEN the user activates the edit action on a node (double-click or F2), THE Editor SHALL place that node into an inline text editing state with a visible text cursor.
2. WHEN the user confirms the edit by pressing Enter or clicking outside the node, THE Editor SHALL update the node's displayed text.
3. WHEN the user confirms the edit, THE Server SHALL persist the updated map to the Map File.
4. WHEN the user cancels editing by pressing Escape, THE Editor SHALL revert the node's text to its previous value and SHALL NOT persist any change.
5. IF the user confirms an edit with empty or whitespace-only text, THEN THE Editor SHALL display a validation error and SHALL NOT save the empty text.
6. THE Editor SHALL allow editing the root node's text, accepting text of 1 to 200 characters.
7. IF the Server fails to persist the edited text, THEN THE Editor SHALL display an error message and SHALL revert the node's displayed text to its previous value.

---

### Requirement 9: Delete Nodes

**User Story:** As a user, I want to delete a node and its entire branch, so that I can remove parts of my mind map I no longer need.

#### Acceptance Criteria

1. WHEN the user triggers the delete action on a non-root node that has one or more children, THE Application SHALL display a confirmation prompt identifying the node and the number of descendants that will also be deleted.
2. WHEN deletion is confirmed on a node with children, or when the user triggers delete on a leaf node (no children), THE Editor SHALL remove the node and all of its descendants from the map and THE Server SHALL persist the updated map to the Map File.
3. THE Editor SHALL NOT allow deletion of the root node; WHEN the user attempts to delete the root node, THE Editor SHALL take no action.
4. WHEN the user cancels the confirmation prompt, THE Editor SHALL take no action.
5. IF the Server fails to persist the deletion, THEN THE Editor SHALL display an error message and SHALL restore the deleted node and its descendants to the canvas.

---

### Requirement 10: Rearrange Nodes

**User Story:** As a user, I want to reorder child nodes within the same parent, so that I can control the arrangement of branches.

#### Acceptance Criteria

1. THE Editor SHALL support both drag-and-drop and keyboard shortcuts to change the order of sibling nodes under a shared parent.
2. WHILE the user is dragging a node to a new sibling position, THE Editor SHALL display a position indicator showing the prospective insertion point among the siblings.
3. WHEN the user commits the reorder operation (drops the node or confirms via keyboard), THE Server SHALL persist the updated sibling order to the Map File.
4. WHEN the user cancels the reorder operation (presses Escape or releases outside a valid target), THE Editor SHALL restore the node to its original position without persisting any change.
5. IF the Server fails to persist the updated sibling order, THEN THE Editor SHALL display an error message and SHALL revert the node to its pre-reorder position.

---

### Requirement 11: Move Branches

**User Story:** As a user, I want to move a node (and its entire branch) to a different parent node, so that I can reorganize the structure of my mind map.

#### Acceptance Criteria

1. THE Editor SHALL provide a drag-and-drop mechanism to re-parent a node by moving it, along with all of its descendants, under a different parent node.
2. WHEN a branch is successfully moved to a new parent, THE Editor SHALL update the visual layout to reflect the new hierarchy within 300ms.
3. WHEN a branch is successfully moved to a new parent, THE Server SHALL persist the updated structure to the Map File.
4. IF the Server fails to persist the branch move, THEN THE Editor SHALL revert the branch to its previous parent and SHALL display an error message that dismisses automatically after 3 seconds or on the next user interaction.
5. THE Editor SHALL prevent a node from being moved to itself, to any of its own descendants, or to its current parent.
6. IF an attempted move would create a cycle or is otherwise invalid (self, descendant, or same parent), THEN THE Editor SHALL reject the move and SHALL display an inline error indicator.

---

### Requirement 12: Collapse and Expand Branches

**User Story:** As a user, I want to collapse and expand branches in the mind map, so that I can focus on specific parts of a large map without visual clutter.

#### Acceptance Criteria

1. WHEN a non-root node has one or more children and is in the expanded state, THE Editor SHALL display a collapse control on that node.
2. WHEN the user activates the collapse control on a node, THE Editor SHALL hide all descendants of that node and SHALL display a visual indicator on that node that is visually distinct from the expanded-state indicator.
3. WHEN a node is in the collapsed state, THE Editor SHALL display an expand control on that node.
4. WHEN the user activates the expand control on a node, THE Editor SHALL reveal the direct children of that node, with each child displayed in its own previously persisted collapsed or expanded state.
5. THE Editor SHALL persist the collapsed or expanded state of every node as part of the Map File so that the state is restored when the map is reopened.
6. THE Editor SHALL NOT display a collapse control on the root node.

---

### Requirement 13: Canvas Navigation — Zoom and Pan

**User Story:** As a user, I want to zoom and pan the canvas, so that I can navigate large mind maps comfortably.

#### Acceptance Criteria

1. WHEN the user scrolls the mouse wheel over the canvas, THE Editor SHALL zoom in or out by 10% per scroll tick, centered on the cursor position.
2. WHEN the user clicks and drags on a canvas area not occupied by a node or edge, THE Editor SHALL pan the canvas in the direction of the drag.
3. WHEN the user activates the zoom-in or zoom-out controls in the UI, THE Editor SHALL adjust the zoom level by 10% per activation.
4. THE Editor SHALL clamp the zoom level silently to a minimum of 10% and a maximum of 200%, taking no action when the bound is already reached.
5. WHEN the user activates the "Fit to Screen" control, THE Editor SHALL adjust the zoom level and pan position so the entire mind map is visible within the canvas viewport, clamping to the 10%–200% range if necessary.
6. WHEN the Editor first opens a mind map, THE Editor SHALL automatically apply the "Fit to Screen" behavior as defined in criterion 5.

---

### Requirement 14: Automatic Layout

**User Story:** As a user, I want the mind map to be automatically arranged, so that branches are displayed clearly without manual positioning.

#### Acceptance Criteria

1. WHEN a node is added, deleted, moved, or its collapsed/expanded state changes, THE Editor SHALL recalculate and begin rendering the updated node positions within 100ms of the triggering action, without blocking the browser UI thread.
2. THE Editor SHALL distribute top-level branches across both sides of the root node such that the count difference between the left side and the right side is at most 1.
3. THE Editor SHALL position nodes such that no two node label bounding boxes overlap, maintaining a minimum gap of 8px between any two bounding boxes.
4. THE Editor SHALL render exactly one visible connector line between each parent node and each of its children.
5. WHEN the layout recalculation completes after a structural change, THE Editor SHALL animate all node position changes with a transition duration between 150ms and 400ms.
6. THE Editor SHALL provide a "Re-centre root" action (accessible from the toolbar and via a keyboard shortcut, e.g. `Home`) that instantly pans the canvas so that the root node is positioned at the centre of the visible viewport, without changing the zoom level.

---

### Requirement 15: Visual Customization

**User Story:** As a user, I want to customize the appearance of nodes and branches, so that I can use color and style to add meaning to my mind map.

#### Acceptance Criteria

1. THE Editor SHALL allow the user to set a background color for individual nodes by selecting from a color picker that supports at minimum a full hue range.
2. THE Editor SHALL allow the user to set a text color for individual nodes by selecting from a color picker that supports at minimum a full hue range.
3. THE Editor SHALL allow the user to set a color for individual branch connector lines by selecting from a color picker that supports at minimum a full hue range.
4. THE Editor SHALL apply all per-node visual customization settings (background color, text color, and branch line color and style) independently for each node and persist them in the Map File; WHEN a node is deleted, THE Editor SHALL remove its associated customization settings from the Map File.
5. THE Editor SHALL allow the user to set a line style for individual branch connector lines, where line style is one of: solid, dashed, or dotted, with a line thickness between 1 and 8 pixels inclusive.
6. WHERE no custom background color is set for a node, THE Editor SHALL render that node's background using a depth-based default color derived from the active theme's color palette, such that all nodes at the same depth level share the same default background color, and nodes at different depth levels are visually distinguishable by their default background color.
7. WHERE no custom text color, connector color, or connector style is set for a node or branch, THE Editor SHALL render that element using the default values defined by the active theme, such that all unstyled text, connectors, and branches are visually consistent under the same theme.

---

### Requirement 16: Keyboard Shortcuts

**User Story:** As a user, I want to control the Editor using keyboard shortcuts, so that I can capture and organize ideas quickly without switching to the mouse.

#### Acceptance Criteria

1. THE Editor SHALL support the following keyboard shortcuts when a node is selected and no text input is focused:
   - `Tab` or `Insert`: add a child node to the currently selected node
   - `Enter`: add a sibling node after the currently selected node; this action SHALL have no effect when the root node is selected
   - `Delete` or `Backspace`: delete the currently selected node; WHEN the node has children, THE Editor SHALL display a confirmation prompt before deleting
   - `F2`: begin editing the text of the currently selected node
   - `Escape`: cancel the current edit or close the current dialog
   - `Space`: toggle collapse/expand on the currently selected node
   - `ArrowUp` / `ArrowDown`: move focus to the previous or next sibling node
   - `ArrowLeft`: move focus to the parent node
   - `ArrowRight`: move focus to the first child node
   - `Ctrl+Z` (Windows/Linux) / `Cmd+Z` (macOS): undo the most recent undoable operation
   - `Ctrl+Shift+Z` or `Ctrl+Y` (Windows/Linux) / `Cmd+Shift+Z` (macOS): redo the most recently undone operation
   - `Home`: re-centre the canvas on the root node (pan only, zoom unchanged)
   - `Ctrl+S` (Windows/Linux) / `Cmd+S` (macOS): save the current map state manually; THE Application SHALL prevent the browser's default "Save page" behaviour and SHALL NOT trigger a file download
2. WHEN the user presses `?` or activates the keyboard shortcut help button in the UI, THE Editor SHALL display a keyboard shortcut reference panel.
3. WHEN a text input field is focused, THE Editor SHALL NOT trigger node-level shortcuts for `Tab`, `Delete`, `Backspace`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, or `Space`.
4. THE Editor SHALL intercept `Ctrl+S` (Windows/Linux) and `Cmd+S` (macOS) globally at all times while the Editor is open, preventing the browser default "Save page" action, regardless of which element currently has focus.

---

### Requirement 17: Light and Dark Theme

**User Story:** As a user, I want to switch between a light and dark theme, so that I can use the application comfortably in different lighting conditions.

#### Acceptance Criteria

1. THE Application SHALL provide a toggle control to switch between the light theme and the dark theme.
2. WHEN the user selects a theme, THE Application SHALL apply the selected theme to all UI elements and the canvas within 300ms.
3. WHEN the user selects a theme, THE Application SHALL persist the selected theme preference in localStorage.
4. WHEN the Application loads, THE Application SHALL read the persisted theme preference from localStorage and apply it before rendering any UI elements.
5. IF no persisted theme preference exists in localStorage and the operating system color scheme preference is detectable, THEN THE Application SHALL apply the theme that matches the operating system color scheme preference.
6. IF no persisted theme preference exists in localStorage and the operating system color scheme preference is not detectable, THEN THE Application SHALL apply the light theme by default.
7. IF localStorage is unavailable, THEN THE Application SHALL apply the theme selected by the user for the current session without persisting it.
8. THE Application SHALL define a depth-based background color palette for each theme (light and dark) that assigns a distinct default background color to each node depth level from depth 0 (root) through at least depth 5, with deeper levels cycling through the palette; these palette colors SHALL be applied as the default node background per criterion 6 of Requirement 15.

---

### Requirement 18: Export to JSON

**User Story:** As a user, I want to export a mind map to a JSON file, so that I can back up or transfer individual maps.

#### Acceptance Criteria

1. WHEN the user triggers the export-to-JSON action, THE Application SHALL generate a syntactically valid JSON file representing the complete mind map.
2. WHEN the JSON file is generated, THE Application SHALL initiate a browser file download with a filename derived from the map title with a `.json` extension.
3. THE exported JSON file SHALL conform to the current versioned Map File schema.
4. THE exported JSON file SHALL be self-contained and portable, containing no references to server-side paths, host-specific identifiers, or deployment-specific configuration.
5. THE exported JSON file SHALL include the Map ID, all Node IDs, node titles, node text content, the full tree structure, node colors, and the Schema Version.
6. IF the export generation fails, THEN THE Application SHALL display an error message indicating the export could not be completed and SHALL NOT initiate a file download.

---

### Requirement 19: Import from JSON

**User Story:** As a user, I want to import a mind map from a JSON file, so that I can restore a previously exported map or transfer a map from another Maplora instance.

#### Acceptance Criteria

1. WHEN the user selects a JSON file via the import action, THE Application SHALL validate the file's content against the Map File schema before proceeding.
2. IF the imported JSON is valid and conforms to the current or a supported older schema version, THEN THE Server SHALL discard the Map ID from the imported file, assign a new unique Map ID (UUID v4) to the imported map, and save it as a new Map File in the Data Directory.
3. IF the imported JSON is valid and conforms to the current or a supported older schema version, THEN THE Server SHALL preserve all Node IDs from the imported file, provided no Node ID in the imported file conflicts with an existing Node ID in any Map File already present in the Data Directory; IF a Node ID conflict is detected, THEN THE Server SHALL replace the conflicting Node IDs with newly generated UUID v4 values before saving.
3a. WHEN the import is saved successfully, THE Application SHALL automatically display the newly imported map in the map list without requiring a manual refresh.
4. IF the selected file is not valid JSON, THEN THE Application SHALL display an error message indicating that the file could not be parsed as JSON and SHALL NOT create a Map File.
5. IF the JSON is valid but does not conform to any supported schema version, THEN THE Application SHALL display an error message indicating the detected schema version and stating that it is not supported, and SHALL NOT create a Map File.
6. IF the JSON conforms to a supported older schema version, THEN THE Server SHALL migrate the map data to the current schema version before saving the Map File.

---

### Requirement 20: Export to PNG

**User Story:** As a user, I want to export a mind map as a PNG image, so that I can share or embed the map in documents.

#### Acceptance Criteria

1. WHEN the user triggers the export-to-PNG action, THE Application SHALL temporarily expand all collapsed branches for rendering purposes only and SHALL render the complete mind map at a minimum resolution of 144 PPI (2× the display pixel density).
2. WHEN the user triggers the export-to-PNG action, THE Application SHALL initiate a browser file download of the PNG file named after the mind map title with a `.png` extension.
3. THE exported PNG SHALL include all nodes, connector lines, text labels, node colors, font styles, and icon decorations present in the mind map.
4. THE exported PNG SHALL use a white background and SHALL NOT include canvas UI controls, toolbars, selection handles, or scrollbars.
5. IF the export rendering fails, THEN THE Application SHALL display an error message indicating the export could not be completed and SHALL NOT initiate a file download.

---

### Requirement 21: Map File Schema and Versioning

**User Story:** As a user, I want map files to have a clear, versioned format, so that I can rely on long-term compatibility and reliable backups.

#### Acceptance Criteria

1. THE Server SHALL store each mind map in its own dedicated JSON file in the Data Directory.
2. THE Map File SHALL contain a `schemaVersion` integer field at the root level with a value greater than or equal to 1.
3. THE Server SHALL use a stable filename derived from the Map ID (e.g., `{mapId}.json`) and SHALL NOT derive filenames from map titles.
4. WHEN the Server reads a Map File, THE Server SHALL validate the file's content against the schema for the declared `schemaVersion`; IF the content fails validation, THEN THE Server SHALL reject loading that file and SHALL return an error indicating which field or constraint failed.
5. IF a Map File has a `schemaVersion` that is higher than the Server's supported maximum version, THEN THE Server SHALL reject loading that file and SHALL log an error that includes the unsupported version number and the Server's supported maximum version.
6. IF a Map File has a `schemaVersion` that is lower than the Server's supported minimum migration version, THEN THE Server SHALL reject loading that file and SHALL log an error indicating the version is too old to migrate.
7. IF a Map File has a `schemaVersion` that is lower than the current version and greater than or equal to the Server's supported minimum migration version, THEN THE Server SHALL migrate the file's content to the current schema version and SHALL overwrite the file with the migrated content.
8. THE Server SHALL support a defined migration path for each schema version increment from the supported minimum migration version to the current version, such that a file at any version within that range can be migrated to the current version.
9. THE Map File SHALL serialize to JSON and deserialize back to an object with identical field names and values as the original, with no data loss or type coercion.

---

### Requirement 22: Safe File Writes

**User Story:** As a user, I want my mind maps to be saved reliably, so that I never lose data due to interrupted or corrupted writes.

#### Acceptance Criteria

1. WHEN the Server saves a mind map, THE Server SHALL write the serialized map content to a temporary file in the same directory as the target Map File before replacing the target.
2. WHEN the temporary file has been written and synced to disk, THE Server SHALL atomically replace the target Map File with the temporary file using a rename operation.
3. IF the write or sync to the temporary file fails, THEN THE Server SHALL delete the temporary file and SHALL NOT modify the existing Map File.
4. THE Server SHALL ensure only one write operation is in progress per Map ID at a time, serializing any concurrent save requests for the same Map ID.
5. WHEN a save operation completes successfully, THE Server SHALL return a success response to the caller confirming the Map File was updated.
6. IF the temporary file cannot be deleted after a failed write, THEN THE Server SHALL return an error response to the caller indicating the save failed and the temporary file could not be cleaned up.
7. THE Map File SHALL include a `revision` integer field that THE Server SHALL increment by 1 on every successful write, starting at 1 for newly created maps.
8. WHEN the Server receives a save request for a Map ID, THE Server SHALL compare the `revision` in the incoming payload against the `revision` in the current Map File; IF the incoming `revision` is less than the current file's `revision`, THEN THE Server SHALL reject the save request and SHALL return an error indicating a stale-write conflict, without modifying the Map File.

---

### Requirement 23: Docker Deployment

**User Story:** As a user, I want to run Maplora in Docker with minimal configuration, so that I can self-host it reliably on any compatible host including a Synology NAS.

#### Acceptance Criteria

1. THE Application SHALL be deployable by running `docker compose up` without any manual setup steps beyond editing the provided `docker-compose.yml` or `.env` file.
2. THE Application SHALL provide a `Dockerfile` that produces a self-contained image containing all runtime dependencies required to run the Application.
3. THE Application SHALL provide a `docker-compose.yml` file that defines the complete deployment configuration.
4. THE Application SHALL expose its web interface on the host port specified by the `HOST_PORT` environment variable, defaulting to port 3000 when `HOST_PORT` is not set.
5. THE Server SHALL read the Data Directory path from the `DATA_DIR` environment variable, defaulting to `/data` when `DATA_DIR` is not set.
6. THE `docker-compose.yml` SHALL mount a host directory into the container as the Data Directory using a bind mount.
7. THE Application SHALL NOT require internet connectivity during operation when map data is present in the Data Directory.
8. THE Application SHALL NOT depend on any external cloud services or third-party APIs.
9. THE Application SHALL run all services within a single container unless a specific function requires a dedicated process, in which case the total number of containers SHALL NOT exceed 2.

---

### Requirement 24: Data Persistence and Backup

**User Story:** As a user, I want my mind maps to survive container restarts, rebuilds, and upgrades, so that my data is safe even when the deployment changes.

#### Acceptance Criteria

1. THE Server SHALL store all Map Files exclusively in the Data Directory, where the Data Directory is the single host-mounted path configured via the `DATA_DIR` environment variable, defaulting to `/data`.
2. WHEN the Docker container is stopped and restarted, THE Application SHALL serve all previously saved mind maps, with every map file present and readable before the stop remaining present and readable after the restart.
3. IF the Data Directory bind mount is unchanged, WHEN the Docker image is rebuilt and the container is recreated, THE Application SHALL serve all previously saved mind maps, with every map file present and readable before the rebuild remaining present and readable after recreation.
4. THE Application SHALL NOT store any persistent application state (map data) inside the container filesystem layers outside the Data Directory.
5. THE Application SHALL store all Map Files such that copying the Data Directory on the host captures all map data with no additional state required from any other location.
6. IF the Data Directory is not accessible when the Server starts, THEN THE Server SHALL refuse to start and emit an error indicating the Data Directory is unavailable, rather than falling back to any path inside the container filesystem.

---

### Requirement 25: Undo and Redo

**User Story:** As a user, I want to undo and redo changes to my mind map, so that I can recover from mistakes quickly without losing my work.

#### Acceptance Criteria

1. THE Editor SHALL maintain an undo history for the following operations: adding a node, deleting a node or branch, editing node text, moving a branch to a new parent, reordering sibling nodes, and changing a node's visual customization.
2. WHEN the user triggers the undo action (`Ctrl+Z` on Windows/Linux, `Cmd+Z` on macOS), THE Editor SHALL reverse the most recent undoable operation and update the canvas.
3. WHEN the user triggers the redo action (`Ctrl+Shift+Z` or `Ctrl+Y` on Windows/Linux, `Cmd+Shift+Z` on macOS), THE Editor SHALL re-apply the most recently undone operation and update the canvas.
4. THE Editor SHALL maintain a minimum undo history depth of 50 operations per editing session.
5. THE Editor SHALL persist the map state to the Map File after each undo or redo operation, using the same safe-write mechanism defined in Requirement 22.
6. WHEN the map is closed or the Editor is navigated away from, THE Editor MAY discard the undo history; THE undo history SHALL NOT be required to persist across sessions.
7. WHEN no further undo operations are available, THE Editor SHALL disable the undo control and SHALL take no action when the undo shortcut is triggered.
8. WHEN no further redo operations are available, THE Editor SHALL disable the redo control and SHALL take no action when the redo shortcut is triggered.

---

### Requirement 26: Map Library Search and Sorting

**User Story:** As a user, I want to search and sort my mind map library, so that I can quickly find a specific map even when I have hundreds of them.

#### Acceptance Criteria

1. THE Application SHALL display a search input field on the map list screen that filters the displayed map cards in real time as the user types.
2. WHEN the user types in the search input, THE Application SHALL filter the displayed map list to show only maps whose title contains the search query as a case-insensitive substring, updating the results within 100ms of each keystroke.
3. WHEN the search input is empty, THE Application SHALL display all maps without filtering.
4. WHEN the active search query produces no matching maps, THE Application SHALL display a "no results" message that includes the search query and a button to clear the search.
5. THE Application SHALL provide a sort control on the map list screen with the following sort options:
   - Last edited (descending) — default
   - Last edited (ascending)
   - Title (A → Z)
   - Title (Z → A)
6. WHEN the user selects a sort option, THE Application SHALL re-sort the displayed map list immediately and persist the selected sort order in localStorage so it is restored on subsequent visits.
7. IF localStorage is unavailable, THE Application SHALL apply the default sort order (last edited, descending) for the current session without persisting it.
8. WHEN both a search query and a sort order are active, THE Application SHALL first filter by the search query and then sort the filtered results by the selected sort order.
9. THE Application SHALL perform all filtering and sorting on the client side using the map data already loaded in memory, without making additional server requests.
10. THE search and sort controls SHALL remain visible and functional when the map list contains 500 or more maps without causing a perceptible delay.

---

### Requirement 27: Copy Mind Map as Markdown

**User Story:** As a user, I want to copy my mind map as formatted Markdown text, so that I can share it as readable structured content through chat, email, or any text-based communication.

#### Acceptance Criteria

1. THE Application SHALL provide a "Copy as Markdown" action in the Editor toolbar that copies a Markdown text representation of the mind map to the system clipboard.
2. WHEN the user triggers the "Copy as Markdown" action, THE Application SHALL generate the Markdown representation from the current in-memory map state without making any server requests.
3. THE generated Markdown SHALL represent the mind map root as a top-level heading using `# {root text}`, and each child node as a Markdown bullet point (`-`) indented proportionally to its depth in the tree, such that each additional level of depth adds two spaces of indentation.
4. THE generated Markdown SHALL include all nodes in the tree, including nodes inside collapsed branches, preserving the full logical structure of the map regardless of the current collapsed/expanded display state.
5. THE generated Markdown SHALL preserve the sibling order of nodes as defined in the map data.
6. WHEN the Markdown has been successfully written to the clipboard, THE Application SHALL display a brief confirmation message (e.g., "Copied to clipboard") that dismisses automatically after 2 seconds.
7. IF the clipboard API is unavailable or the write operation fails, THE Application SHALL display an error message indicating the copy could not be completed.
8. THE "Copy as Markdown" action SHALL be accessible from the Editor toolbar and SHALL be available at all times while a map is open, regardless of the selected node or editing state.

**Example output** for a map titled "Project X" with branches "Frontend" (children: "React", "TypeScript") and "Backend" (children: "Node.js", "Hono"):

```
# Project X
- Frontend
  - React
  - TypeScript
- Backend
  - Node.js
  - Hono
```

---

### Requirement 28: Map Tags

**User Story:** As a user, I want to assign tags to my mind maps and filter the library by tag, so that I can organize and find maps across topics more effectively.

#### Acceptance Criteria

1. THE Map File schema SHALL include a `tags` field at the root level containing an ordered array of tag strings; the field SHALL default to an empty array for maps that have no tags.
2. WHEN a map has no tags, THE Application SHALL store an empty `tags` array in the Map File and SHALL NOT display any tag indicators on the map card.
3. EACH tag string SHALL be between 1 and 32 characters in length, SHALL NOT consist entirely of whitespace, and SHALL NOT contain commas; THE Application SHALL display a validation error and reject any tag that violates these constraints.
4. EACH mind map SHALL support a maximum of 20 tags; THE Application SHALL display a validation error and reject adding a tag when the map already has 20 tags.
5. THE Application SHALL provide a tag management control on the map card (in the map list screen) that allows the user to add and remove tags for a given map.
6. WHEN the user adds a tag to a map, THE Application SHALL save the updated `tags` array to the Map File using the existing safe-write mechanism and SHALL update the map card display without requiring a page reload.
7. WHEN the user removes a tag from a map, THE Application SHALL save the updated `tags` array to the Map File using the existing safe-write mechanism and SHALL remove the tag from the map card display without requiring a page reload.
8. THE Application SHALL display a tag input that offers autocomplete suggestions based on all unique tags already present across all loaded maps, sorted alphabetically.
9. THE Application SHALL display the assigned tags on each map card in the map list, showing up to 5 tags directly and indicating any additional tags with a count badge (e.g., "+3").
10. THE Application SHALL provide a tag filter control on the map list screen that shows all unique tags present in the loaded map collection.
11. WHEN the user selects one or more tags in the tag filter control, THE Application SHALL display only maps that contain ALL selected tags (AND logic), combining the tag filter with any active search query and sort order.
12. WHEN no tags are selected in the tag filter, THE Application SHALL display all maps without tag filtering.
13. THE Application SHALL perform all tag filtering on the client side using the map data already loaded in memory, without making additional server requests.
14. THE `MapSummary` object returned by the list API SHALL include the `tags` array so that the map list screen can filter and display tags without loading the full `MapFile` for each map.
15. IF a Map File does not contain a `tags` field (e.g., files created before this feature), THE Server SHALL treat the missing field as an empty array when reading the file, without rejecting or migrating the file.
16. THE Application SHALL assign a persistent display color to each unique tag string, such that the same tag always renders in the same color across all map cards and tag controls.
17. THE Application SHALL derive tag colors deterministically from the tag string itself (e.g. by hashing), so that no per-tag color data needs to be stored in Map Files or on the server, and the same tag name always produces the same color on any device or session.
18. THE Application SHALL ensure that tag colors provide sufficient contrast against the card background for legibility in both the light and dark themes, and SHALL display the tag text in a contrasting foreground color (light or dark) chosen automatically based on the tag background color's luminance.

---

### Requirement 29: Recently Opened Maps Bar

**User Story:** As a user, I want to see a list of recently opened maps while I am in the editor, so that I can quickly switch to another map without going back to the main list.

#### Acceptance Criteria

1. THE Editor SHALL display a recently opened maps bar showing the titles of the maps most recently opened in the current browser session, in reverse chronological order (most recently opened first).
2. THE Application SHALL track the order in which maps are opened during a session and update the recently opened list each time a map is opened.
3. THE recently opened maps bar SHALL display a maximum of 5 map titles; older entries beyond the 5 most recent SHALL NOT be shown.
4. WHEN the user clicks a map title in the recently opened bar, THE Application SHALL navigate to that map's Editor view, loading the map as if it were opened from the list screen.
5. THE recently opened maps bar SHALL exclude the currently open map from its entries.
6. THE recently opened maps bar SHALL be accessible from within the Editor (e.g. displayed in the editor toolbar or as a collapsible panel).
7. IF a map that appears in the recently opened list has been deleted (moved to trash) since it was last opened, THE Application SHALL omit that map from the recently opened list without displaying an error.
8. THE recently opened list SHALL be stored in browser session state (e.g. a module-level variable or sessionStorage) and SHALL NOT persist across page reloads or new browser tabs.
9. IF the recently opened list is empty (no other maps have been opened in this session), THE Application SHALL hide the recently opened bar or display a placeholder indicating no recent maps are available.
