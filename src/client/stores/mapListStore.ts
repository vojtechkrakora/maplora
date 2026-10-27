import { create } from "zustand";
import * as api from "../api";
import type { MapSummary } from "../../shared/schema.js";
interface MapListState {
  maps: MapSummary[];
  loading: boolean;
  error: string | null;
  fetchMaps(): Promise<void>;
  createMap(title: string): Promise<string>;
  renameMap(id: string, title: string): Promise<void>;
  deleteMap(id: string): Promise<void>;
  duplicateMap(id: string): Promise<void>;
}
export const useMapListStore = create<MapListState>((set) => ({
  maps: [],
  loading: false,
  error: null,
  async fetchMaps() {
    set({ loading: true, error: null });
    try {
      set({ maps: await api.fetchMaps() });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },
  async createMap(title) {
    const m = await api.createMap(title);
    set((s) => ({ maps: [m, ...s.maps] }));
    return m.id;
  },
  async renameMap(id, title) {
    const m = await api.renameMap(id, title);
    set((s) => ({ maps: [m, ...s.maps.filter((x) => x.id !== id)] }));
  },
  async deleteMap(id) {
    await api.deleteMap(id);
    set((s) => ({ maps: s.maps.filter((x) => x.id !== id) }));
  },
  async duplicateMap(id) {
    const map = await api.duplicateMap(id);
    set((s) => ({ maps: [map, ...s.maps] }));
  },
}));
