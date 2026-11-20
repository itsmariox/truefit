// The PACKAGED test bundle (node scripts/package.ts --test) run as "Connect ChatGPT": the real window, the real main process, the real sign-in flow (OAuth + PKCE, loopback listener, ID-token
// check), the real secret store and the real engine, against a PRETEND OpenAI on localhost (started here) and a stand-in browser that follows the sign-in redirect. No real OpenAI service,
// account or key is involved, and the real Claude program is never used. Needs a screen. Run: npm run e2e:packaged-openai
import { _electron as electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeOpenAIWorld } from "../../engine/tests/openai-fake-auth.ts";
import { analysis } from "../tests/core-rig.ts";
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), bundle = path.join(appDir, "dist", "test", `Truefit-darwin-${process.arch}`, "Truefit.app");
const exe = path.join(bundle, "Contents", "MacOS", "Truefit");
let failures = 0; const check = (n: string, c: boolean, extra = "") => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  " + extra)); };
const SERVICE = "CVAppPkgOai Safe Storage", has = () => { try { execFileSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE], { stdio: "ignore" }); return true; } catch { return false; } };
if (!existsSync(exe)) { console.error("build the test bundle first: node scripts/package.ts --test"); process.exit(2); }
if (has()) { console.error("a leftover test Keychain item exists:  security delete-generic-password -s \"" + SERVICE + "\""); process.exit(2); }
const data = mkdtempSync(path.join(os.tmpdir(), "cvapp-pkgoai-")), claudeDir = mkdtempSync(path.join(os.tmpdir(), "cvapp-pkgoai-claude-"));
const world = await startFakeOpenAIWorld({ analysis: analysis("Acme Retail") });
const env = { ...process.env, CVAPP_USER_DATA: data, CVAPP_APP_NAME: "CVAppPkgOai", CVAPP_CLAUDE_CONFIG_DIR: claudeDir, CVAPP_OPENAI_BASE: world.url, CVAPP_FAKE_BROWSER: "1", CVAPP_TEST_PROFILE: path.join(appDir, "..", "engine", "tests", "fixtures", "profile-priya.json") } as Record<string, string>; delete env.ELECTRON_RUN_AS_NODE;
delete env.CVAPP_FAKE_CLAUDE; delete env.CVAPP_FAKE_PROVIDER;
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => { const f = path.join(d, e.name); return e.isDirectory() ? walk(f) : e.isFile() ? [f] : []; }); // real files only: Chromium leaves dangling "Singleton" links here
const app = await electron.launch({ executablePath: exe, args: [], env, timeout: 90000 });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="onboarding"]', { timeout: 60000 });
  await page.click('[data-testid="ob-next"]'); await page.click('[data-testid="ob-next"]'); await page.waitForSelector('[data-testid="connect"]', { timeout: 30000 });
  check("the guide's Connect step offers both services", (await page.locator('[data-testid="provider-choice"] button').count()) === 2);
  await page.click('text="OpenAI (ChatGPT plan or API key)"'); await page.click('text="Use my ChatGPT plan"'); await page.waitForSelector('[data-testid="notice"]');
  check("choosing OpenAI shows the ChatGPT-plan notice (not the Claude one)", /Using your ChatGPT plan/.test(await page.textContent('[data-testid="notice"]') ?? ""));
  await page.check('input[type="checkbox"]'); await page.click('text="Continue"'); await page.click('text="Continue with ChatGPT"');
  await page.waitForSelector('[data-testid="ob-connected"]', { timeout: 60000 });
  check("'Continue with ChatGPT' ran the real sign-in in the packaged app against the pretend OpenAI: the guide says it is connected", world.authorize.length === 1 && world.tokens.length === 1);
  const a = world.authorize[0];
  check("the authorize request had PKCE S256, a state and nonce, the app name, an opaque host id, the plan scope and a 127.0.0.1 callback", a.get("code_challenge_method") === "S256" && a.get("agent_name_hint") === "Truefit" && /^urn:uuid:/.test(a.get("ext_agent_host_id") ?? "") && (a.get("scope") ?? "").includes("chatgpt.tokens.use.direct") && /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/.test(a.get("redirect_uri") ?? ""));
  check("the real safeStorage Keychain item now exists (the sign-in is stored encrypted)", has());
  const leaked = walk(data).filter((f) => { try { const t = readFileSync(f).toString("latin1"); return /ACCESS-NEW|REFRESH-1|ey[A-Za-z0-9_-]{20,}\.ey/.test(t); } catch { return false; } });
  check("no token appears in readable form anywhere in the app's data folder", leaked.length === 0, leaked.join(", "));
  await page.click('[data-testid="ob-next"]'); await page.click('[data-testid="ob-finish"]'); await page.waitForSelector('[data-testid="profile"]', { timeout: 30000 });
  check("after the guide the status line says 'Using ChatGPT plan'", /Using ChatGPT plan/.test(await page.textContent('[data-testid="status-line"]') ?? ""));
  await page.click('button[aria-label="New job"]');
  await page.fill("#ad-input", "A marketing role at a fictional shop, weekly emails and reporting in Google Analytics. ".repeat(6)); await page.click('button[aria-label="Analyse this job"]');
  await page.waitForSelector('[data-testid="verdict"]', { timeout: 60000 });
  check("an ad is analysed through OpenAI with the plan token (the pretend service saw 'Bearer ACCESS-NEW') and the verdict card appears", world.bearers.includes("Bearer ACCESS-NEW") && /Apply|Long shot|Skip/.test(await page.textContent('[data-testid="verdict"]') ?? ""));
  await page.click('button[aria-label="Settings"]'); await page.waitForSelector('[data-testid="plan-in-use"]', { timeout: 15000 });
  check("Settings shows 'Using ChatGPT plan' with Manage usage and Disconnect", /Using ChatGPT plan/.test(await page.textContent('[data-testid="plan-in-use"]') ?? ""));
  await page.click('text="Disconnect ChatGPT"'); await page.waitForSelector('[data-testid="plan-in-use"]', { state: "detached", timeout: 15000 });
  check("Disconnect ChatGPT told OpenAI to revoke the session (token, hint and client id sent) and the status line reads not connected", world.revokes.length === 1 && world.revokes[0].get("token_type_hint") === "refresh_token" && world.revokes[0].get("token") === "REFRESH-1" && /not connected/.test(await page.textContent('[data-testid="status-line"]') ?? ""));
} finally { await app.close().catch(() => undefined); await world.close(); try { execFileSync("/usr/bin/security", ["delete-generic-password", "-s", SERVICE], { stdio: "ignore" }); } catch { /* none */ } rmSync(data, { recursive: true, force: true }); rmSync(claudeDir, { recursive: true, force: true }); }
console.log(failures === 0 ? "\nall packaged-openai tests passed" : `\n${failures} packaged-openai test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
