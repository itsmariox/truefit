// The pause detector of the microphone: it must stop after real speech and a pause, in a quiet room, a noisy room and with a soft voice, and it must NOT stop on silence alone or in the middle of a sentence.
import { createVad, thresholds } from "../src/renderer/mic.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const DT = 0.256; // one chunk of 4096 samples at 16 kHz
const run = (levels: number[]) => { const v = createVad(); return levels.findIndex((r) => v.push(r, DT)); };
const rep = (r: number, secs: number) => Array(Math.round(secs / DT)).fill(r);
ok("thresholds follow the room: a quiet room uses the floors, a noisy one scales up", thresholds(0).speech === 0.012 && thresholds(0).quiet === 0.006 && Math.abs(thresholds(0.05).speech - 0.15) < 1e-9);
ok("quiet room: speech for 3 s then a pause stops after about 1.3 s of quiet", (() => { const i = run([...rep(0.002, 0.8), ...rep(0.08, 3), ...rep(0.002, 3)]); return i > 0 && i * DT < 0.8 + 3 + 2.2; })());
ok("a SOFT voice (about 0.02) in a quiet room is still heard and stops", run([...rep(0.002, 0.8), ...rep(0.02, 3), ...rep(0.002, 3)]) > 0);
ok("a NOISY room (background 0.03): speech at 0.2 then a return to background stops", run([...rep(0.03, 0.8), ...rep(0.2, 3), ...rep(0.03, 3)]) > 0);
ok("silence alone never stops it before the 30 s limit; then it stops by itself", run(rep(0.002, 29)) === -1 && run(rep(0.002, 31)) > 0);
ok("a short gap between words does not stop it (0.5 s pause inside a sentence)", (() => { const i = run([...rep(0.002, 0.8), ...rep(0.08, 2), ...rep(0.002, 0.5), ...rep(0.08, 2), ...rep(0.002, 3)]); return i * DT > 0.8 + 2 + 0.5 + 2; })());
ok("it fires only once", (() => { const v = createVad(); let n = 0; for (const r of [...rep(0.002, 0.8), ...rep(0.08, 3), ...rep(0.002, 6)]) if (v.push(r, DT)) n++; return n === 1; })());
console.log(failures === 0 ? "\nall mic tests passed" : `\n${failures} mic test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
