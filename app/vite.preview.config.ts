// DEVELOPMENT ONLY: serves the page in a plain browser (with the mock bridge, see src/renderer/preview) so every screen can be looked at without Electron.
// The page's strict content policy is removed here only, because the development server needs inline scripts; the real app and every build keep it.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  define: { "process.env": "{}" }, // the engine's wording code reads two environment variables (to hide them); a browser has none
  root: path.resolve("src/renderer"), server: { port: 5190, strictPort: true, fs: { allow: [path.resolve("..")] } },
  plugins: [react(), { name: "preview-no-csp", transformIndexHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "") }],
});
