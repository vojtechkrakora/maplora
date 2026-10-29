import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { useEditorStore } from "../stores/editorStore";
import { MindMapCanvas } from "../components/MindMapCanvas";
import { addRecentMap, useRecentMapsStore } from "../recentMapsStore";
export function EditorPage() {
  const { mapId } = useParams(),
    navigate = useNavigate(),
    location = useLocation(),
    s = useEditorStore();
  const [loadedId, setLoadedId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoadedId(null);
    if (mapId)
      void s.loadMap(mapId).then(() => {
        if (!active) return;
        const current = useEditorStore.getState();
        if (current.map?.id === mapId && !current.loading && !current.error) {
          const { id, title, tags, updatedAt } = current.map;
          addRecentMap({ id, title, tags, updatedAt });
        }
        setLoadedId(mapId);
      });
    return () => {
      active = false;
    };
  }, [mapId, s.loadMap]);
  useEffect(() => {
    if (loadedId === mapId && !s.loading && s.error && (!s.map || s.gone)) {
      if (s.gone && mapId) useRecentMapsStore.getState().removeRecentMap(mapId);
      const missingRecent =
        !s.map && s.gone && location.state?.recentMapId === mapId;
      navigate("/", {
        replace: true,
        state: missingRecent ? null : { error: s.error },
      });
    }
  }, [
    loadedId,
    mapId,
    s.loading,
    s.error,
    s.map,
    s.gone,
    navigate,
    location.state,
  ]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s")
        return;
      event.preventDefault();
      const current = useEditorStore.getState();
      if (
        !current.loading &&
        current.map?.id === mapId &&
        current.saving !== "saving"
      )
        void current.saveMap();
    };
    // Inputs and dialogs stop bubbling; capture keeps saving available inside them.
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [mapId]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (
        useEditorStore.getState().saving === "saving" ||
        useEditorStore.getState().draft
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  if (s.loading || !s.map || s.map.id !== mapId)
    return (
      <div className="loading-screen" role="status">
        Making space for your ideas…
      </div>
    );
  return (
    <ReactFlowProvider>
      <MindMapCanvas />
    </ReactFlowProvider>
  );
}
