// Voice (phase 4): the guards around the speech model (fake model), then the REAL bundled model on speech made by macOS `say` (skipped, loudly, off a Mac).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const wavPcm = (w: Buffer) => { let o = 12; while (o + 8 <= w.length) { const id = w.toString("ascii", o, o + 4), n = w.readUInt32LE(o + 4); if (id === "data") return w.subarray(o + 8, o + 8 + n); o += 8 + n + (n % 2); } throw new Error("no data chunk"); };
import { createVoice, decodePcm16, whisperTranscriber } from "../src/main/voice.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const pcm64 = (seconds: number, amp: number) => { const n = Math.round(seconds * 16000), b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 7) * amp * 32767), i * 2); return b.toString("base64"); };
let seen = 0; const say = (t: string) => createVoice({ transcriber: async () => { seen++; return t; } });
{ const v = say("  I was a  marketing\nexecutive. ");
  ok("a normal recording gives clean text (spaces collapsed)", JSON.stringify(await v.transcribe(pcm64(2, 0.3))) === JSON.stringify({ status: "ok", text: "I was a marketing executive." })); }
{ seen = 0; const v = say("hello");
  const r = [await v.transcribe(pcm64(0.2, 0.3)), await v.transcribe(pcm64(31, 0.3)), await v.transcribe(pcm64(2, 0.001)), await v.transcribe("not base64!!"), await v.transcribe("AAAA")] as any[];
  ok("too short, too long, too quiet and broken audio are refused BEFORE the model runs", r.map((x) => x.reason).join() === "too_short,too_long,quiet,bad_audio,bad_audio" && seen === 0); }
for (const t of ["you", "Thank you.", "Thanks for watching!", "...", " Okay. "]) ok(`silence phrase "${t}" is dropped, not sent as a message`, (await say(t).transcribe(pcm64(2, 0.3)) as any).reason === "nothing_heard");
ok("a real sentence that contains 'you' is kept", (await say("Can you hear me").transcribe(pcm64(2, 0.3)) as any).text === "Can you hear me");
{ const v = createVoice({ transcriber: async () => { throw new Error("boom"); } }); ok("a model that fails gives 'unavailable', never an exception", (await v.transcribe(pcm64(2, 0.3)) as any).reason === "unavailable"); }
{ const order: number[] = []; let n = 0; const v = createVoice({ transcriber: async () => { const me = ++n; await new Promise((r) => setTimeout(r, me === 1 ? 60 : 5)); order.push(me); return "ok then"; } }); const first = v.transcribe(pcm64(2, 0.3)), second = await v.transcribe(pcm64(2, 0.3)) as any; await first;
  ok("recordings are worked out one at a time, in order: a second one waits for the first and then succeeds (a live caption never makes the final words fail)", second.status === "ok" && order.join() === "1,2"); }
ok("decodePcm16 turns 16-bit samples into -1..1", (() => { const b = Buffer.alloc(4); b.writeInt16LE(16384, 0); b.writeInt16LE(-32768, 2); const a = decodePcm16(b.toString("base64"))!; return a[0] === 0.5 && a[1] === -1; })());
// the real model
const here = path.dirname(fileURLToPath(import.meta.url)), models = path.join(here, "..", "voice", "models");
if (process.platform === "darwin" && existsSync(path.join(models, "Xenova", "whisper-tiny.en", "onnx", "encoder_model_quantized.onnx"))) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cvapp-voice-"));
  try {
    execFileSync("say", ["-v", "Samantha", "-o", path.join(dir, "a.aiff"), "I was a marketing executive at Acme Retail. I cut the weekly report time from four hours to two."]); execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", path.join(dir, "a.aiff"), path.join(dir, "a.wav")]);
    const wav = readFileSync(path.join(dir, "a.wav")), v = createVoice({ transcriber: whisperTranscriber(models) }), t0 = Date.now(), r = await v.transcribe(wavPcm(wav).toString("base64")) as any;
    ok("the REAL bundled model, offline, hears generated speech: the words marketing, executive, report and hours come out", r.status === "ok" && /marketing/i.test(r.text) && /executive/i.test(r.text) && /report/i.test(r.text) && /hours/i.test(r.text)); console.log("  heard:", r.text, `(${Date.now() - t0} ms including load)`);
    const quiet = await v.transcribe(pcm64(3, 0.0005)) as any; ok("with the real model in place a silent room is still refused as quiet", quiet.reason === "quiet");
  } finally { rmSync(dir, { recursive: true, force: true }); }
} else console.log("SKIPPED: the real-model test needs macOS and the bundled model in app/voice/models");
console.log(failures === 0 ? "\nall voice tests passed" : `\n${failures} voice test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
