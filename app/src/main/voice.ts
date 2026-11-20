// Voice (phase 4): speech to text on THIS Mac. The recording never leaves the computer: the page captures 16 kHz mono audio and sends it here; a small Whisper model (bundled with the app,
// run by onnxruntime on the CPU) turns it into text. Nothing is downloaded at run time (remote models are switched off). The checks around the model are plain code: too short, too long and
// too quiet recordings are refused, and the stock phrases Whisper invents from silence ("you", "Thank you.") are dropped, so an empty room never becomes a message.
import path from "node:path";

export type Transcriber = (pcm: Float32Array) => Promise<string>;
export type VoiceResult = { status: "ok"; text: string } | { status: "refused"; reason: "too_short" | "too_long" | "quiet" | "nothing_heard" | "unavailable" | "bad_audio" };
export const SAMPLE_RATE = 16_000, MIN_SECONDS = 0.5, MAX_SECONDS = 30, MIN_RMS = 0.006;
// What Whisper tends to say about silence or noise. Matched on the WHOLE result, so a real sentence containing "you" is never dropped.
const PHANTOM = /^(you|thank you|thanks|thanks for watching|thank you for watching|bye|okay|ok|\.+|um|uh|hmm|mm)[.!? ]*$/i;

export function decodePcm16(base64: string): Float32Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null; const buf = Buffer.from(base64, "base64"); if (buf.length < 2 || buf.length % 2 !== 0) return null;
  const out = new Float32Array(buf.length / 2); for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768; return out;
}
export const rms = (a: Float32Array) => { let s = 0; for (const v of a) s += v * v; return a.length ? Math.sqrt(s / a.length) : 0; };

export function createVoice(d: { transcriber: Transcriber; onError?: (e: unknown) => void }) {
  let chain: Promise<unknown> = Promise.resolve(); // recordings are worked out ONE AT A TIME, in the order they arrive (a live caption in progress never makes the final words fail)
  return {
    async transcribe(base64: string): Promise<VoiceResult> {
      const pcm = decodePcm16(base64); if (!pcm) return { status: "refused", reason: "bad_audio" };
      const seconds = pcm.length / SAMPLE_RATE; if (seconds < MIN_SECONDS) return { status: "refused", reason: "too_short" }; if (seconds > MAX_SECONDS) return { status: "refused", reason: "too_long" };
      if (rms(pcm) < MIN_RMS) return { status: "refused", reason: "quiet" };
      const run = async (): Promise<VoiceResult> => {
        try { const text = (await d.transcriber(pcm)).replace(/\s+/g, " ").trim(); return !text || PHANTOM.test(text) ? { status: "refused", reason: "nothing_heard" } : { status: "ok", text: text.slice(0, 2000) }; }
        catch (e) { d.onError?.(e); return { status: "refused", reason: "unavailable" }; }
      };
      const mine = chain.then(run, run); chain = mine.catch(() => undefined); return mine;
    },
  };
}

// The real model: loaded on first use (about 0.2 s), then kept. `modelsDir` holds Xenova/whisper-tiny.en (shipped with the app, outside the archive).
export function whisperTranscriber(modelsDir: string): Transcriber {
  let asr: ((a: Float32Array) => Promise<{ text: string }>) | null = null;
  return async (pcm) => {
    if (!asr) {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = modelsDir.endsWith(path.sep) ? modelsDir : modelsDir + path.sep;
      asr = (await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", { dtype: "q8", device: "cpu" })) as unknown as typeof asr;
    }
    return (await asr!(pcm)).text;
  };
}
