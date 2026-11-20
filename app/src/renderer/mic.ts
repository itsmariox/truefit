// The microphone, in the page: records 16 kHz mono audio, reports a level and says when the person has stopped talking. The recording is held in memory only,
// handed to the main process once as base64 16-bit samples, and then dropped. Nothing here uploads anything.
export type MicSession = { stop: () => Promise<string | null>; snapshot: () => string | null }; // snapshot: the audio so far, for a live caption
export type MicStart = (o: { onLevel: (level: number) => void; onSilence: () => void }) => Promise<MicSession>;
export const micSupported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
const MAX_SECONDS = 30, QUIET_FOR = 1.3, SPEECH_FOR = 0.25, CALIBRATE_CHUNKS = 3;
// The thresholds follow the room: the quietest of the first few moments is taken as the background level, speech is a few times louder than that, silence is close to it.
export const thresholds = (floor: number) => ({ speech: Math.max(0.012, floor * 3), quiet: Math.max(0.006, floor * 1.7) });

// "Has the person finished?": pure, so it can be tested without a microphone. Feed it the loudness of each short moment; it says true once, when speech has been followed by a pause (or at the time limit).
export function createVad() {
  let spoke = 0, quiet = 0, floor = 1, seen = 0, fired = false, time = 0;
  return {
    push(r: number, dt: number): boolean {
      time += dt;
      if (seen < CALIBRATE_CHUNKS) { floor = Math.min(floor, r); seen++; return false; }
      const t = thresholds(floor);
      if (r > t.speech) { spoke += dt; quiet = 0; } else if (r < t.quiet) quiet += dt; else quiet = Math.max(0, quiet - dt / 2);
      if (!fired && ((spoke >= SPEECH_FOR && quiet >= QUIET_FOR) || time >= MAX_SECONDS)) { fired = true; return true; }
      return false;
    },
  };
}

export const startMic: MicStart = async ({ onLevel, onSilence }) => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: 16000 }), src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), chunks: Float32Array[] = [];
  let samples = 0, level = 0; const vad = createVad();
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0), copy = new Float32Array(d); chunks.push(copy); samples += copy.length;
    let s = 0; for (const v of copy) s += v * v; const r = Math.sqrt(s / copy.length), dt = copy.length / ctx.sampleRate;
    level = level * 0.5 + Math.min(1, r * 8) * 0.5; onLevel(level);
    if (vad.push(r, dt)) onSilence();
  };
  src.connect(proc); proc.connect(ctx.destination);
  const encode = (): string | null => {
    if (!samples) return null;
    const all = new Float32Array(samples); let i = 0; for (const c of chunks) { all.set(c, i); i += c.length; }
    const bytes = new Uint8Array(samples * 2), view = new DataView(bytes.buffer); for (let k = 0; k < samples; k++) view.setInt16(k * 2, Math.max(-1, Math.min(1, all[k])) * 32767, true);
    let bin = ""; for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000)); return btoa(bin);
  };
  return {
    snapshot: encode,
    stop: async () => {
      proc.onaudioprocess = null; proc.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); await ctx.close().catch(() => undefined); onLevel(0);
      return encode();
    },
  };
};
