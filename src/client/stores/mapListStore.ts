import { create } from "zustand";
import * as api from "../api";
import {
  TagsSchema,
  type MapFile,
  type MapSummary,
} from "../../shared/schema.js";

export type SortOrder =
  "updatedAt_desc" | "updatedAt_asc" | "title_asc" | "title_desc";
const defaultSortOrder: SortOrder = "updatedAt_desc";
function readSortOrder(): SortOrder {
  try {
    const saved = localStorage.getItem("maplora:sortOrder");
    if (
      saved === "updatedAt_desc" ||
      saved === "updatedAt_asc" ||
      saved === "title_asc" ||
      saved === "title_desc"
    )
      return saved;
  } catch {
    // Storage can be blocked by the browser. The library still works.
  }
  return defaultSortOrder;
}
const titleCollator = new Intl.Collator(undefined, { sensitivity: "base" });
interface MapListState {
  maps: MapSummary[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  sortOrder: SortOrder;
  activeTags: string[];
  setActiveTags(tags: string[]): void;
  allTags(): string[];
  updateTags(id: string, tags: string[]): Promise<void>;
  setSearchQuery(query: string): void;
  setSortOrder(order: SortOrder): void;
  filteredAndSortedMaps(): MapSummary[];
  fetchMaps(): Promise<void>;
  createMap(title: string): Promise<string>;
  renameMap(id: string, title: string): Promise<void>;
  deleteMap(id: string): Promise<void>;
  duplicateMap(id: string): Promise<void>;
  importMap(map: MapFile): Promise<MapSummary>;
}
export const useMapListStore = create<MapListState>((set, get) => ({
  maps: [],
  loading: false,
  error: null,
  searchQuery: "",
  sortOrder: readSortOrder(),
  activeTags: [],
  setActiveTags(activeTags) {
    set({ activeTags: [...new Set(activeTags)] });
  },
  allTags() {
    return [...new Set(get().maps.flatMap((map) => map.tags ?? []))].sort(
      (a, b) => titleCollator.compare(a, b) || a.localeCompare(b),
    );
  },
  async updateTags(id, tags) {
    const map = await api.updateTags(id, TagsSchema.parse(tags));
    set((s) => ({ maps: s.maps.map((item) => (item.id === id ? map : item)) }));
  },
  setSearchQuery(searchQuery) {
    set({ searchQuery });
  },
  setSortOrder(sortOrder) {
    set({ sortOrder });
    try {
      localStorage.setItem("maplora:sortOrder", sortOrder);
    } catch {
      // With unavailable storage, subsequent sessions use the default order.
    }
  },
  filteredAndSortedMaps() {
    const { maps, searchQuery, sortOrder, activeTags } = get();
    const query = searchQuery.toLowerCase();
    // filter creates a new array, so sorting never mutates the loaded maps.
    return maps
      .filter((map) => map.title.toLowerCase().includes(query))
      .filter((map) =>
        activeTags.every((tag) => (map.tags ?? []).includes(tag)),
      )
      .sort((a, b) => {
        if (sortOrder === "title_asc" || sortOrder === "title_desc") {
          return (
            titleCollator.compare(a.title, b.title) *
            (sortOrder === "title_asc" ? 1 : -1)
          );
        }
        const aTime = Date.parse(a.updatedAt ?? ""),
          bTime = Date.parse(b.updatedAt ?? "");
        // Unreadable entries have no timestamp; keep them visible at the end.
        if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : 0;
        if (!Number.isFinite(bTime)) return -1;
        return (aTime - bTime) * (sortOrder === "updatedAt_asc" ? 1 : -1);
      });
  },
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
  async importMap(map) {
    const summary = await api.importMap(map);
    set((s) => ({
      maps: [summary, ...s.maps],
      searchQuery: "",
      activeTags: [],
    }));
    return summary;
  },
}));
