import { create } from "zustand";

export type Theme = "light" | "dark";
export const useThemeStore = create<{
  theme: Theme;
  toggleTheme(): void;
}>((set, get) => ({
  // The head script resolves storage/system preferences before any UI renders.
  theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  toggleTheme() {
    const theme = get().theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#19221e" : "#f7f8f5");
    set({ theme });
    try {
      localStorage.setItem("maplora-theme", theme);
    } catch {
      // Keep the selected theme for this session when storage is unavailable.
    }
  },
}));
