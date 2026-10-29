import { Link } from "react-router-dom";
import { useRecentMapsStore } from "../recentMapsStore";
import { useEditorStore } from "../stores/editorStore";

export function RecentMapsBar({ currentMapId }: { currentMapId: string }) {
  const maps = useRecentMapsStore((state) => state.maps);
  const saving = useEditorStore((state) => state.saving === "saving");
  const recent = maps.filter((map) => map.id !== currentMapId);
  if (!recent.length) return null;
  return (
    <nav
      className="recent-maps"
      aria-label="Recently opened maps"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="recent-maps-label">Recent</span>
      <div className="recent-map-links">
        {recent.map((map) => (
          <Link
            key={map.id}
            to={`/maps/${map.id}`}
            state={{ recentMapId: map.id }}
            title={map.title}
            aria-disabled={saving || undefined}
            tabIndex={saving ? -1 : undefined}
            onClick={(event) => {
              // Blurring a node input may have started a save since this render.
              if (useEditorStore.getState().saving === "saving")
                event.preventDefault();
            }}
          >
            {map.title}
          </Link>
        ))}
      </div>
    </nav>
  );
}
