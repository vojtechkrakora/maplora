import { create } from "zustand";
import type { MapSummary } from "../shared/schema.js";

interface RecentMapsState {
  maps: MapSummary[];
  addRecentMap(summary: MapSummary): void;
  removeRecentMap(id: string): void;
  reconcileMaps(summaries: MapSummary[]): void;
}

// Intentionally kept in memory: a reload or a new tab starts a fresh list.
export const useRecentMapsStore = create<RecentMapsState>((set) => ({
  maps: [],
  addRecentMap(summary) {
    set((state) => ({
      maps: [
        { ...summary, tags: [...(summary.tags ?? [])] },
        ...state.maps.filter((map) => map.id !== summary.id),
      ].slice(0, 5),
    }));
  },
  removeRecentMap(id) {
    set((state) => ({ maps: state.maps.filter((map) => map.id !== id) }));
  },
  reconcileMaps(summaries) {
    const available = new Map(summaries.map((map) => [map.id, map]));
    set((state) => ({
      maps: state.maps.flatMap((map) => {
        const summary = available.get(map.id);
        return summary && !summary.error
          ? [{ ...summary, tags: [...(summary.tags ?? [])] }]
          : [];
      }),
    }));
  },
}));

export const addRecentMap = (summary: MapSummary) =>
  useRecentMapsStore.getState().addRecentMap(summary);

export const getRecentMaps = (currentMapId: string): MapSummary[] =>
  useRecentMapsStore.getState().maps.filter((map) => map.id !== currentMapId);
