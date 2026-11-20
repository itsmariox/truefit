import { createRoot } from "react-dom/client";
import type { CvAppBridge } from "../shared/contract.ts";
import { App } from "./App.tsx";
import "./tokens.css";
import "./styles.css";
import { initAppearance } from "./theme.ts";

declare global { interface Window { cvapp: CvAppBridge } }
// In the real app the bridge comes from the preload script. In a plain browser during development (no bridge) a mock with sample scenarios is used so every screen can be looked at;
// `import.meta.env.DEV` is false in a build, so none of the preview code is part of the app.
async function start() {
  initAppearance(); // before the first paint: the last look the user chose
  let bridge = window.cvapp;
  if (!bridge && import.meta.env.DEV) document.documentElement.dataset.preview = ""; // the development preview has no Mac material behind it (see styles.css)
  if (!bridge && import.meta.env.DEV) bridge = (await import("./preview/mock-bridge.ts")).createMockBridge(new URLSearchParams(location.search).get("scenario") ?? "fresh");
  createRoot(document.getElementById("root")!).render(<App bridge={bridge} />);
}
void start();
