// Regression tests for a bug fixed on 2026-11-16: UK-style phone numbers with spaces passed through the contact masking. Fictional text only.
const { minimise, maskContacts } = await import("../src/persona.ts");
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };

const phones = ["call 07700 900123", "tel 0113 496 0000", "mobile +44 7700 900123", "07700900123", "ring 01632-960-123 today", "phone 020 7946 0000", "office 0131 496 0123"];
ok("minimise drops every line with a phone number (UK local with spaces or dashes, +44, 11 digits)", phones.every((l) => minimise(`keep\n${l}\nkeep too`) === "keep\nkeep too"));
const safe = ["MSc, 2021 - 2022", "Managed about $500K of pipeline", "Budget of £15,000 and 6 events", "06/2023 – 08/2026, remote", "Grew 1,200 to 3,600 subscribers", "Reduced 40 hours to 10 hours a week", "ISO 27001 trained"];
ok("minimise keeps dates, money and ordinary numbers", safe.every((l) => minimise(l) === l));
ok("maskContacts masks UK phone numbers inside a line and keeps the rest", maskContacts("Reach me on 07700 900123 or a@b.co, thanks") === "Reach me on [phone] or [email], thanks" && maskContacts("2021 - 2022 and £15,000") === "2021 - 2022 and £15,000");

// (The "numbers the CV may use" fix lives in profileToPersona now: verified bullets only; see profile.test.ts.)
console.log(failures === 0 ? "\nall persona-fixes tests passed" : `\n${failures} persona-fixes test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
