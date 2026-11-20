// The main-process side of the bridge (phase 4c). One wrapper registers a handler for EVERY channel of the contract: it refuses a sender that is not our page, validates the
// request, runs the handler, and turns any failure into a short plain Result. A raw error, a stack or a path never reaches the page. Electron is passed in, never imported,
// so the wrapper is tested with fakes.
import { CHANNEL_NAMES, INVALID, channels, fail, ok, type ChannelName, type RequestOf, type Result, type ResponseOf } from "../shared/contract.ts";

export type Handlers = { [C in ChannelName]: (request: RequestOf<C>) => Promise<ResponseOf<C>> | ResponseOf<C> };
export type IpcMainLike = { handle(channel: string, listener: (event: any, payload: unknown) => unknown): void };
export type IpcDeps = { ipcMain: IpcMainLike; handlers: Handlers; isTrusted: (event: any) => boolean; log?: (line: string) => void };

export function registerIpc(d: IpcDeps): void {
  const missing = CHANNEL_NAMES.filter((c) => typeof (d.handlers as Record<string, unknown>)[c] !== "function");
  if (missing.length) throw new Error(`no handler for channel(s): ${missing.join(", ")}`); // a channel without a handler is a programming error, caught at start-up
  for (const name of CHANNEL_NAMES) {
    d.ipcMain.handle(name, async (event, payload): Promise<Result<unknown>> => {
      if (!d.isTrusted(event)) { d.log?.(`ipc ${name}: untrusted sender refused`); return fail("forbidden", "This request was not accepted."); }
      const request = (channels[name].request as (x: unknown) => unknown)(payload);
      if (request === INVALID) { d.log?.(`ipc ${name}: invalid request refused`); return fail("invalid_request", "This request was not understood."); }
      try { return ok(await (d.handlers[name] as (r: unknown) => unknown)(request)); }
      catch (e) { d.log?.(`ipc ${name}: handler failed (${(e as Error)?.name ?? "error"})`); return fail("failed", "Something went wrong. Please try again."); } // never the message: it may hold a path or text from an ad
    });
  }
}
