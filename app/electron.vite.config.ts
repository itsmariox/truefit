import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

// Three builds: the main process (Node, our engine inside), the preload script (the only bridge) and the renderer (the window's page, React).
export default defineConfig({
  // The packaged TEST build (scripts/package.ts --test) sets CVAPP_TEST_BUILD=1; a release build and every normal build define it as false, so the test hooks are removed from them.
  main: { plugins: [{ name: "copy-pdf-worker", // pdfjs (inside the engine's CV checks) loads its worker file from next to the main bundle
    generateBundle() { this.emitFile({ type: "asset", fileName: "pdf.worker.mjs", source: readFileSync(path.resolve("../engine/node_modules/pdfjs-dist/build/pdf.worker.mjs")) }); } }], define: { __TEST_BUILD__: JSON.stringify(process.env.CVAPP_TEST_BUILD === "1") }, build: { rollupOptions: { external: ["fflate", "@huggingface/transformers", "onnxruntime-node"], input: { index: path.resolve("src/main/index.ts") } } } }, // fflate is loaded from node_modules: bundled, its own `require` collides with the bundler's
  
  preload: { build: { rollupOptions: { input: { index: path.resolve("src/preload/index.ts") }, output: { format: "cjs", entryFileNames: "[name].cjs" } } } },
  renderer: { root: path.resolve("src/renderer"), plugins: [react(), { name: "dev-no-meta-csp", apply: "serve", // the development server injects styles from script; the strict meta policy stays in every build and the main process sets the (dev-relaxed) header
      transformIndexHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "") }], build: { rollupOptions: { input: { index: path.resolve("src/renderer/index.html") } } } },
});
