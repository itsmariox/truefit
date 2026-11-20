// Phase 9: the REAL window at two sizes (820 x 560 is the smallest allowed, 1180 x 760 the default) in light and dark, on every main page: nothing may overflow sideways, and the text must
// have enough contrast against what is really behind it (computed from the real styles, not the design tokens). Screenshots go to the folder in CVAPP_SHOTS if set. Needs a screen.
import { _electron as electron } from "playwright-core";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), exe = path.join(appDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"), shots = process.env.CVAPP_SHOTS;
// The guide has no skip: a test that is not about the guide marks it done through the real settings channel and reloads the page.
async function finishGuideForTest(page: any) { await page.evaluate(() => (window as any).cvapp.invoke("settings:set", { patch: { onboardingDone: true } })); await page.reload(); }
let failures = 0; const check = (n: string, c: boolean, extra = "") => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  " + extra)); };
const data = mkdtempSync(path.join(os.tmpdir(), "cvapp-q-")), claude = mkdtempSync(path.join(os.tmpdir(), "cvapp-q-claude-")); if (shots) mkdirSync(shots, { recursive: true });
const env = { ...process.env, CVAPP_USER_DATA: data, CVAPP_APP_NAME: "CVAppQuality", CVAPP_CLAUDE_CONFIG_DIR: claude } as Record<string, string>; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: exe, args: [appDir], env, timeout: 60000 });
const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
try {
  const page = await app.firstWindow(); await page.waitForSelector('[data-testid="onboarding"]', { timeout: 30000 });
  await app.evaluate(({}, j) => { (globalThis as any).__cvappCore.profile.save(JSON.parse(j)); }, readFileSync(path.join(appDir, "..", "engine", "tests", "fixtures", "profile-priya.json"), "utf8"));
  const pages: [string, () => Promise<void>][] = [
    ["connect", async () => { await page.click('button[aria-label="New job"]'); }], ["history", async () => { await page.click('button[aria-label="History"]'); }],
    ["profile-top", async () => { await page.click('button[aria-label="My profile"]'); }], ...(["Experience", "Skills", "Studies", "Languages & more", "What I want"] as const).map((n): [string, () => Promise<void>] => [`profile-${n.toLowerCase().replace(/\W+/g, "-")}`, async () => { await page.click('button[aria-label="My profile"]'); if (await page.locator('[data-testid="edit-open"]').count()) await page.click('[data-testid="edit-open"]'); await page.click(`.dna-nav button:has-text("${n}")`); }]),
    ["settings", async () => { await page.click('button[aria-label="Settings"]'); }],
    ...(["Notifications", "Your CVs", "Start up", "Telegram", "Usage", "Your data", "About"] as const).map((n): [string, () => Promise<void>] => [`settings-${n.toLowerCase().replace(/\W+/g, "-")}`, async () => { await page.click('button[aria-label="Settings"]'); await page.click(`.set-nav-item:has-text("${n}")`); }]),
  ];
// The guide's last step (start your profile) can only be reached once Claude is connected, which a normal build cannot do without a login: it is covered by the component and accessibility tests instead.
const onboardingSteps: [string, () => Promise<void>][] = [
  ["onboarding-welcome", async () => { while ((await page.locator('[data-step="0"]').count()) === 0) await page.click('button:has-text("Back")'); }],
  ["onboarding-honest", async () => { while ((await page.locator('[data-step="1"]').count()) === 0) await page.click((await page.locator('[data-step="0"]').count()) ? '[data-testid="ob-next"]' : 'button:has-text("Back")'); }],
  ["onboarding-connect", async () => { while ((await page.locator('[data-step="2"]').count()) === 0) await page.click('[data-testid="ob-next"]'); }],
];
let startChecked = false;
async function runAll(pages: [string, () => Promise<void>][]) {
  if (!startChecked) { startChecked = true;
  const startTheme = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource); check("the app starts in LIGHT whatever macOS is set to (light is the default look; dark and 'match my Mac' are choices in Settings and the guide)", startTheme === "light"); }
  for (const theme of ["light", "dark"] as const) for (const [w, h] of [[1180, 760], [820, 560]] as const) {
    await app.evaluate(({ BrowserWindow, nativeTheme }, a) => { nativeTheme.themeSource = a.t; const win = BrowserWindow.getAllWindows()[0]; win.setSize(a.w, a.h); }, { t: theme, w, h }); await page.emulateMedia({ colorScheme: theme }); await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme); await page.waitForTimeout(500); // the same attribute the page sets when the user chooses a look
    const really = await page.evaluate((t) => window.matchMedia(`(prefers-color-scheme: ${t})`).matches, theme); check(`${theme} ${w}x${h}: the page really is in ${theme} mode`, really);
    for (const [name, go] of pages) {
      await go(); await page.mouse.move(2, 2); await page.waitForTimeout(350); // the pointer is moved off the last button pressed, so no hover colour is measured
      const r = await page.evaluate(() => {
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches; const out = { overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, wide: [] as string[], low: [] as string[] };
        for (const el of Array.from(document.querySelectorAll("button, input, select, textarea, h1, h2, p, label"))) { const b = el.getBoundingClientRect(); if (b.width > 0 && b.right > window.innerWidth + 1) out.wide.push((el.textContent ?? el.tagName).slice(0, 30)); }
        const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
        const bgOf = (el: Element | null): number[] => { while (el) { const c = parse(getComputedStyle(el).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; el = el.parentElement; } return dark ? [38, 38, 38] : [236, 236, 238]; }; // transparent all the way up = the Mac's translucent sidebar material, about this colour
        const lumf = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        for (const el of Array.from(document.querySelectorAll("h1, h2, p, label, button, .muted, .job-title, .nav-item span"))) {
          const t = (el.textContent ?? "").trim(); if (!t || (el as HTMLElement).offsetParent === null) continue; const cs = getComputedStyle(el), fg = parse(cs.color), bg = bgOf(el); if (fg.length < 3) continue;
          const a = fg[3] ?? 1, mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a)), l1 = lumf(mix), l2 = lumf(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), size = parseFloat(cs.fontSize), big = size >= 18.66 || (size >= 14 && Number(cs.fontWeight) >= 700);
          if ((el as HTMLButtonElement).disabled) continue; if (ratio < (big ? 3 : 4.5)) out.low.push(`${t.slice(0, 24)} (${ratio.toFixed(1)})`);
        }
        return out;
      });
      check(`${theme} ${w}x${h} ${name}: no sideways overflow, nothing past the right edge, text contrast at least 4.5 to 1`, !r.overflowX && r.wide.length === 0 && r.low.length === 0, JSON.stringify({ overflowX: r.overflowX, wide: r.wide.slice(0, 4), low: r.low.slice(0, 5) }));
      if (shots) await page.screenshot({ path: path.join(shots, `${theme}-${w}-${name}.png`) });
    }
  }
}
await runAll(onboardingSteps);
await finishGuideForTest(page); await page.waitForSelector('[data-testid="connect"]', { timeout: 30000 });
await runAll(pages);
  void lum;
} finally { await app.close().catch(() => undefined); rmSync(data, { recursive: true, force: true }); rmSync(claude, { recursive: true, force: true }); }
console.log(failures === 0 ? "\nall quality checks passed" : `\n${failures} quality check(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
