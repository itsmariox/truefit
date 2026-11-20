// The bridge to the speech service: one channel. The recording arrives as base64, is checked and transcribed in voice.ts, and is not kept.
import type { Handlers } from "./ipc.ts";
import type { createVoice } from "./voice.ts";

export function createVoiceHandlers(d: { voice: ReturnType<typeof createVoice>; micAccess?: () => Promise<"granted" | "denied" | "restricted" | "unknown"> }): Pick<Handlers, "voice:transcribe" | "voice:mic"> {
  return { "voice:transcribe": ({ audio }) => d.voice.transcribe(audio), "voice:mic": async () => ({ access: (await d.micAccess?.().catch(() => "unknown" as const)) ?? "unknown" }) };
}
