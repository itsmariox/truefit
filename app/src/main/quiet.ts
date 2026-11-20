// Imported FIRST by index.ts (imports run in order, before the rest of the file): pdf.js prints two known warnings while it loads, because it tries an optional drawing module the CV checks do not need.
// Only those two are hidden; every other warning still shows.
const quiet = (f: (...a: unknown[]) => void) => (...a: unknown[]) => { const t = String(a[0] ?? ""); if (/@napi-rs\/canvas|Cannot polyfill `(DOMMatrix|Path2D)`/.test(t)) return; f(...a); };
console.warn = quiet(console.warn.bind(console)); console.log = quiet(console.log.bind(console));
export {};
