// The look of the window: light (the default), dark, or follow the Mac. The engine setting "appearance" is the truth; the main process applies it to the native window (nativeTheme), and this file
// applies it to the page at once through `data-theme` on <html> (tokens.css and styles.css read it). The last choice is also kept in localStorage so the very first paint already has the right look
// (no flash of light for someone who chose dark). If storage is unavailable, the page simply starts light until the setting arrives.
export type Appearance = "light" | "dark" | "system";
const KEY = "truefit.appearance";
export const isAppearance = (v: unknown): v is Appearance => v === "light" || v === "dark" || v === "system";
export function applyAppearance(v: string) {
  const mode: Appearance = isAppearance(v) ? v : "light", root = document.documentElement;
  if (mode === "system") delete root.dataset.theme; else root.dataset.theme = mode;
  try { localStorage.setItem(KEY, mode); } catch { /* private mode or blocked storage: fine */ }
}
export function initAppearance() {
  let v: unknown = "light"; try { v = localStorage.getItem(KEY) ?? "light"; } catch { /* use light */ }
  applyAppearance(isAppearance(v) ? v : "light");
}
