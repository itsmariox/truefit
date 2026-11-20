// The ONLY bridge between the page and the main process (phase 4c). Runs in a sandboxed preload with context isolation: the page sees `window.cvapp` and nothing else (no Node,
// no Electron object, no ipcRenderer). Only the channels and events listed in the shared contract can be used; anything else is refused here before it leaves the page.
import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL_NAMES, EVENT_NAMES, type CvAppBridge } from "../shared/contract.ts";

const bridge: CvAppBridge = {
  invoke(channel, request) {
    if (!(CHANNEL_NAMES as string[]).includes(channel)) return Promise.resolve({ ok: false, error: { code: "forbidden", message: "This request was not accepted." } });
    return ipcRenderer.invoke(channel, request);
  },
  on(event, listener) {
    if (!(EVENT_NAMES as string[]).includes(event)) return () => undefined;
    const handler = (_e: unknown, payload: never) => listener(payload);
    ipcRenderer.on(event, handler as never);
    return () => ipcRenderer.removeListener(event, handler as never);
  },
};
contextBridge.exposeInMainWorld("cvapp", Object.freeze(bridge));
