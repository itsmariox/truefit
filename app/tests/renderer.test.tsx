// Phases 4c-4e: the page (renderer) with a FAKE bridge that follows the REAL contract (same validators, same answers' shapes). Component tests run in a simulated browser; no Electron.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../src/renderer/App.tsx";
import { TOAST_MS } from "../src/renderer/Shell.tsx";
import { createMockBridge } from "../src/renderer/preview/mock-bridge.ts";
import { branded, setService } from "../src/renderer/service.ts";
import { ONBOARDING } from "../src/renderer/onboarding-messages.ts";
import { STARTUP_COPY } from "../src/renderer/startup-messages.ts";
import { BUILD } from "../src/renderer/jobs-messages.ts";
import { PROFILE } from "../src/renderer/profile-messages.ts";
import { CARD, DUPLICATE, NEW_JOB, REFUSED } from "../src/renderer/jobs-messages.ts";
vi.mock("../src/renderer/mic.ts", () => ({ micSupported: () => true, startMic: async () => { const m = (globalThis as any).__mic ?? {}; if (m.deny) { const e = new Error("denied"); e.name = "NotAllowedError"; throw e; } m.started = (m.started ?? 0) + 1; return { stop: async () => m.audio ?? "AAAA", snapshot: () => m.audio ?? "AAAA" }; } }));
import type { CvAppBridge, Result } from "../src/shared/contract.ts";

afterEach(cleanup);
// Gets through the four steps of the guide for an already-connected user (Continue three times), then starts the profile from scratch. There is no skip.
const toLastStep = async () => { fireEvent.click(await screen.findByTestId("ob-next")); fireEvent.click(screen.getByTestId("ob-next")); fireEvent.click(await screen.findByRole("button", { name: "Use an API key" })); fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "sk-ant-api03-fakekeyfakekeyfake" } }); fireEvent.click(screen.getByRole("button", { name: "Save and test" })); await screen.findByTestId("ob-connected", undefined, { timeout: 4000 }); fireEvent.click(screen.getByTestId("ob-next")); };
const throughGuide = async () => { for (let i = 0; i < 3; i++) fireEvent.click(await screen.findByTestId("ob-next")); fireEvent.click(await screen.findByTestId("ob-cv")); fireEvent.click(await screen.findByTestId("cv-choose")); };
const never: CvAppBridge = { invoke: (() => new Promise(() => undefined)) as never, on: () => () => undefined };
const failing = (message: string): CvAppBridge => ({ invoke: (async () => ({ ok: false, error: { code: "failed", message } } satisfies Result<never>)) as never, on: () => () => undefined });
const text = () => document.body.textContent ?? "";


// The drop-downs are custom (button + listbox): open one by its label and click an option by its words.
const choose = (label: string, option: string) => { fireEvent.click(screen.getByLabelText(label)); fireEvent.click(screen.getByRole("option", { name: option })); };

describe("start-up", () => {
  it("shows a quiet 'Starting' line first and does not crash when the bridge never answers", () => {
    render(<App bridge={never} />);
    expect(screen.getByText(/Starting/)).toBeTruthy();
  });
  it("shows a plain message when the bridge fails, as an alert, never a raw error", async () => {
    render(<App bridge={failing("Something went wrong. Please try again.")} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong. Please try again.");
    expect(text()).not.toMatch(/undefined|null|\[object|Error:/);
  });
  for (const [scenario, phase] of [["damaged", "damaged"], ["too-new", "too-new"], ["upgrade-failed", "upgrade-failed"], ["failed", "failed"]] as const) {
    it(`a '${phase}' start-up shows ONLY the problem screen with its wording, never the app`, async () => {
      render(<App bridge={createMockBridge(scenario)} />);
      const screenEl = await screen.findByTestId("startup-problem");
      expect(screenEl.getAttribute("data-phase")).toBe(phase);
      expect(text()).toContain(STARTUP_COPY[phase].title); expect(text()).toContain(STARTUP_COPY[phase].body);
      expect(screen.queryByTestId("main")).toBeNull(); expect(screen.queryByRole("navigation")).toBeNull();
    });
  }
  it("damaged data: each listed copy has a Restore button; starting again needs a second, explicit confirmation; restoring opens the app", async () => {
    render(<App bridge={createMockBridge("damaged")} />);
    await screen.findByTestId("startup-problem");
    expect(screen.getAllByRole("button", { name: STARTUP_COPY.damaged.restoreButton! }).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: STARTUP_COPY.damaged.freshButton! }));
    expect(screen.getByRole("alertdialog").textContent).toContain(STARTUP_COPY.damaged.freshWarning!);
    fireEvent.click(screen.getByRole("button", { name: STARTUP_COPY.damaged.freshCancel! }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: STARTUP_COPY.damaged.restoreButton! })[0]);
    await screen.findByTestId("main");
  });
  it("with no saved copies the screen says so, and offers only starting again", async () => {
    render(<App bridge={createMockBridge("damaged-nobackups")} />);
    await screen.findByText(STARTUP_COPY.damaged.noBackups!);
    expect(screen.queryByRole("button", { name: STARTUP_COPY.damaged.restoreButton! })).toBeNull();
  });
  it("no start-up screen shows a path, a file name or an error code", async () => {
    for (const s of ["damaged", "too-new", "upgrade-failed", "failed"]) { const { unmount } = render(<App bridge={createMockBridge(s)} />); await screen.findByTestId("startup-problem"); expect(text()).not.toMatch(/\/mock|\.db|backups|\.json|ENOENT|Error|undefined/); unmount(); }
  });
});

describe("the frame", () => {
  it("has four labelled icon pages in the rail; History and Settings are real pages", async () => {
    render(<App bridge={createMockBridge("connected")} />);
    await screen.findByTestId("main");
    const nav = screen.getByRole("navigation", { name: "Pages" });
    for (const name of ["New job", "History", "My profile", "Settings"]) expect(nav.querySelector(`button[aria-label="${name}"]`)).toBeTruthy();
    
    fireEvent.click(nav.querySelector('button[aria-label="History"]')!);
    await screen.findByTestId("history");
  });
  it("the status line reads from the connection and opens Settings", async () => {
    render(<App bridge={createMockBridge("signedout")} />);
    await waitFor(() => expect(screen.getByTestId("status-line").textContent).toContain("Claude is not connected"));
    fireEvent.click(screen.getByTestId("status-line"));
    expect(screen.getByTestId("main").getAttribute("data-page")).toBe("settings");
  });
  it("when Claude is connected, New job no longer shows the Connect screen", async () => {
    render(<App bridge={createMockBridge("connected")} />);
    await screen.findByTestId("new-job-form"); expect(screen.queryByTestId("connect")).toBeNull();
    expect(screen.getByTestId("status-line").textContent).toContain("Claude is connected");
  });
  it("every button has a name and there is no inline style anywhere (the page's content policy forbids it)", async () => {
    render(<App bridge={createMockBridge("fresh")} />); await screen.findByTestId("connect");
    for (const b of screen.getAllByRole("button")) expect((b.textContent ?? "").trim() || b.getAttribute("aria-label")).toBeTruthy();
    expect(document.querySelectorAll("[style]").length).toBe(0);
  });
});

describe("the Connect screen", () => {
  it("a fresh app offers the two choices with the approved labels", async () => {
    render(<App bridge={createMockBridge("fresh")} />);
    await screen.findByTestId("connect");
    expect(screen.getByRole("button", { name: "Use my Claude subscription" })).toBeTruthy(); expect(screen.getByRole("button", { name: "Use an API key" })).toBeTruthy();
  });
  it("the subscription needs the notice ticked: Continue stays disabled until the box is ticked, then signing in is offered", async () => {
    render(<App bridge={createMockBridge("fresh")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use my Claude subscription" }));
    const notice = await screen.findByTestId("notice");
    expect(notice.textContent).toContain("What could change");
    const cont = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement; expect(cont.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox")); expect(cont.disabled).toBe(false); fireEvent.click(cont);
    await screen.findByRole("button", { name: "Sign in" });
    expect(screen.queryByTestId("notice")).toBeNull();
  });
  it("sign-in shows progress, the link and a Cancel button; Cancel ends it with the approved 'cancelled' message", async () => {
    render(<App bridge={createMockBridge("signedout")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await screen.findByTestId("signin"); await screen.findByTestId("signin-link", undefined, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("signin")).toBeNull());
    expect(screen.getByText("Sign-in cancelled")).toBeTruthy();
  });
  it("an API key field is a password field, a malformed key gets the approved message, and a good key connects", async () => {
    render(<App bridge={createMockBridge("fresh")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use an API key" }));
    const field = await screen.findByLabelText("API key") as HTMLInputElement; expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: "not a key" } }); fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    await screen.findByText("That doesn't look like an API key");
    fireEvent.change(field, { target: { value: "sk-ant-api03-fake" } }); fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    await waitFor(() => expect(screen.getByTestId("status-line").textContent).toContain("Claude is connected"), { timeout: 3000 });
  });
  it("Test connection answers in the approved words", async () => {
    render(<App bridge={createMockBridge("connected")} />);
    fireEvent.click(await screen.findByTestId("status-line")); fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    await screen.findByText("Claude is working", undefined, { timeout: 3000 });
  });
  it("a problem state (key not accepted) is announced as an alert and offers entering a new key", async () => {
    render(<App bridge={createMockBridge("keyinvalid")} />);
    const alert = await screen.findByRole("alert"); expect(alert.textContent).toContain("Claude didn't accept your API key");
    expect(screen.getByLabelText("API key")).toBeTruthy();
  });
  it("a key typed in the field never appears in the page text after saving", async () => {
    render(<App bridge={createMockBridge("fresh")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use an API key" }));
    fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "sk-ant-api03-SECRETSECRET" } }); fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    await waitFor(() => expect(screen.getByTestId("status-line").textContent).toContain("Claude is connected"), { timeout: 3000 });
    expect(document.body.innerHTML).not.toContain("SECRETSECRET");
  });
});

const sideJob = async (name: RegExp) => within(await screen.findByRole("complementary", { name: "Jobs" })).findByRole("button", { name }); // the New job page lists recent jobs again, so look in the sidebar
describe("New job and the Job screen", () => {
  const paste = async (value: string) => { fireEvent.change(await screen.findByLabelText("Job ad or link"), { target: { value } }); fireEvent.click(screen.getByRole("button", { name: NEW_JOB.send })); };
  it("pasting an ad makes a job, opens it while it is being read, and then shows the verdict card with Build CV, Skip and Analyse again", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    await paste("A marketing role at Acme, weekly emails and reporting.");
    await screen.findByTestId("working");
    const card = await screen.findByTestId("verdict", undefined, { timeout: 5000 });
    expect(card.getAttribute("data-verdict")).toBe("apply");
    expect((screen.getByRole("button", { name: CARD.build }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: CARD.skip })).toBeTruthy(); expect(screen.getByRole("button", { name: CARD.again })).toBeTruthy();
  });
  it("an empty paste says what to do, and nothing is created", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: NEW_JOB.send }));
    expect(await screen.findByText(NEW_JOB.nothing.title)).toBeTruthy(); expect(screen.queryByTestId("working")).toBeNull();
  });
  it("a link that cannot be read says to paste the text instead", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    await paste("https://wall.example.com/job"); expect(await screen.findByText(REFUSED.link_failed.title)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Error|ENOTFOUND|undefined/);
  });
  it("text that is not a job ad is turned back with a plain sentence and a Try anyway button; Try anyway makes the job", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    await paste("hi"); expect(await screen.findByText(REFUSED.too_short.title)).toBeTruthy();
    expect(screen.queryByTestId("working")).toBeNull(); expect(document.body.textContent).not.toMatch(/Error|undefined/);
    fireEvent.click(screen.getByRole("button", { name: NEW_JOB.tryAnyway })); await screen.findByTestId("working"); await screen.findByTestId("verdict", undefined, { timeout: 5000 });
  });
  it("a recipe is refused as not a job ad, the text stays in the box, and the notice offers Try anyway", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    await paste("my favourite recipe for a lemon cake with butter"); expect(await screen.findByText(REFUSED.not_a_job.title)).toBeTruthy();
    expect((screen.getByLabelText("Job ad or link") as HTMLTextAreaElement).value).toMatch(/lemon cake/); expect(screen.getByRole("button", { name: NEW_JOB.tryAnyway })).toBeTruthy();
  });
  it("the same ad again is a duplicate: it offers to open the existing job or analyse it again", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    await paste("Marketing executive at Acme"); // equals a sample job's text
    await screen.findByText(DUPLICATE.title);
    expect(screen.getByRole("button", { name: DUPLICATE.open })).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: DUPLICATE.open }));
    await screen.findByTestId("verdict");
  });
  it("a job that breaks one of the user's own rules says so, recommends skipping, and still leaves the decision to the user", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await sideJob(/Brightwell/));
    await screen.findByTestId("verdict");
    expect(screen.getByText(CARD.breaks.title)).toBeTruthy(); expect(screen.getByText(CARD.breaks.body)).toBeTruthy();
    expect(screen.getByTestId("rules").textContent).toContain("Doesn't match");
    expect(screen.getByRole("button", { name: CARD.again })).toBeTruthy();
  });
  it("the sidebar groups jobs ('Needs you' first), and every verdict dot has a text name", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    await screen.findAllByTestId("job-row");
    expect(screen.getByRole("region", { name: CARD.listNeeds })).toBeTruthy(); expect(screen.getByRole("region", { name: CARD.listRecent })).toBeTruthy();
    const names = screen.getAllByRole("img").map((i) => i.getAttribute("aria-label")); expect(names).toEqual(expect.arrayContaining(["Apply", "Long shot", "Skip", "Needs you"]));
  });
  it("a paused job shows the approved pause message with Resume, and the page never starts it by itself", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await sideJob(/Bramble/));
    await screen.findByText("Claude needs you to sign in again");
    expect(screen.getAllByRole("button", { name: CARD.resume }).length).toBeGreaterThan(0); expect(screen.queryByTestId("working")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: CARD.resume })[0]); await screen.findByTestId("working");
  });
});

describe("notification banners (the stand-in for macOS notifications)", () => {
  it("a banner leaves by itself after TOAST_MS, so it never sits over the page controls for long", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<App bridge={createMockBridge("jobs")} />);
      fireEvent.change(await screen.findByLabelText("Job ad or link"), { target: { value: "A marketing role at Acme, another new text." } }); fireEvent.click(screen.getByRole("button", { name: NEW_JOB.send }));
      await screen.findByTestId("toast", undefined, { timeout: 8000 });
      act(() => { vi.advanceTimersByTime(TOAST_MS + 500); });
      await waitFor(() => expect(screen.queryByTestId("toast")).toBeNull());
    } finally { vi.useRealTimers(); }
  }, 20000);
  it("a finished analysis shows a banner naming the job; Open goes to the job and removes the banner", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.change(await screen.findByLabelText("Job ad or link"), { target: { value: "A marketing role at Acme, brand new text." } }); fireEvent.click(screen.getByRole("button", { name: NEW_JOB.send }));
    await screen.findByTestId("verdict", undefined, { timeout: 5000 });
    // the job is open on screen, so open another page, then wait for a second analysis banner by re-analysing
    fireEvent.click(screen.getByRole("button", { name: CARD.again })); fireEvent.click(screen.getByRole("button", { name: "History" }));
    const toast = await screen.findByTestId("toast", undefined, { timeout: 5000 });
    expect(toast.textContent).toContain("Job analysed");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByTestId("job-detail"); await waitFor(() => expect(screen.queryByTestId("toast")).toBeNull());
  });
  it("Dismiss removes a banner without opening anything", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.change(await screen.findByLabelText("Job ad or link"), { target: { value: "Another new marketing ad text." } }); fireEvent.click(screen.getByRole("button", { name: NEW_JOB.send }));
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    await screen.findByTestId("toast", undefined, { timeout: 5000 }); fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByTestId("toast")).toBeNull()); expect(screen.getByTestId("main").getAttribute("data-page")).toBe("history");
  });
});

describe("My profile", () => {
  it("with no profile, New job shows what is missing and a button that opens My profile (nothing can be analysed first)", async () => {
    render(<App bridge={createMockBridge("noprofile")} />);
    const setup = await screen.findByTestId("profile-setup"); expect(setup.textContent).toContain(PROFILE.setup.title); expect(setup.textContent).toContain("One role with at least 3 verified bullets");
    expect(screen.queryByLabelText("Job ad or link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: PROFILE.setup.open })); await screen.findByTestId("profile");
  });
  it("the page has one navigation over its sections; nothing is saved until something changes", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    const nav = screen.getByRole("navigation", { name: "Profile sections" });
    for (const t of ["Hard facts", "Experience", "Skills", "Studies", "Languages & more", "What I want"]) expect(within(nav).getByRole("button", { name: t })).toBeTruthy();
    for (const t of ["Focus", "Never say"]) { expect(within(nav).queryByRole("button", { name: t })).toBeNull(); expect(screen.queryByRole("heading", { name: t })).toBeNull(); } // those sections are gone, and so is the footnote under them
    expect(text()).not.toContain("never asks for your date of birth");
    expect(screen.queryAllByRole("tab").length).toBe(0);
    expect(screen.queryByTestId("save")).toBeNull(); expect(screen.queryByTestId("undo")).toBeNull(); expect(screen.getByRole("status", { name: "" }).textContent).toBe("");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "York" } }); await waitFor(() => expect(screen.getByText(PROFILE.saved)).toBeTruthy(), { timeout: 4000 });
  });
  it("a name left empty is refused with the plain message, and a filled one saves", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: " " } });
    expect((await screen.findByTestId("errors", {}, { timeout: 4000 })).textContent).toContain("Your name is empty");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Sam Example" } });
    await waitFor(() => expect(screen.getByText(PROFILE.saved)).toBeTruthy(), { timeout: 4000 });
  });
  it("there is no 'I confirm this is true' tick anywhere: what the user adds is saved as theirs (verified) at once", async () => {
    const bridge = createMockBridge("jobs"); let saved: any = null;
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save") saved = req.profile; return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    fireEvent.click(screen.getByRole("button", { name: PROFILE.roles.addBullet }));
    expect(screen.queryAllByRole("checkbox", { name: PROFILE.roles.confirm }).length).toBe(0);
    const fields = screen.getAllByPlaceholderText(PROFILE.roles.bulletHint); fireEvent.change(fields.at(-1)!, { target: { value: "Cut the weekly report time by half." } });
    await waitFor(() => expect(saved).not.toBeNull(), { timeout: 4000 });
    expect(saved.roles[0].bullets.at(-1)).toMatchObject({ text: "Cut the weekly report time by half.", status: "verified" });
  });
  it("What I want: places are chips that keep commas while you type, levels are toggle chips, and the three removed fields are gone", async () => {
    const bridge = createMockBridge("jobs"); let saved: any = null;
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save") saved = req.profile; return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    for (const gone of [/Levels you would not take/, /How your location should read/, /Kinds of job you don't want/]) expect(screen.queryByLabelText(gone)).toBeNull();
    // Typing "Derby, Ba" in one go: the comma turns "Derby" into a chip and the rest stays in the box, spaces intact.
    const box = screen.getByLabelText(PROFILE.rules.targets) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Derby, Ba" } }); expect(box.value).toBe(" Ba"); 
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.change(box, { target: { value: "Derby," } }); expect(box.value).toBe(""); // a lone trailing comma commits the chip
    fireEvent.change(box, { target: { value: "Ba" } }); expect(box.value).toBe("Ba"); fireEvent.change(box, { target: { value: "Bath" } }); fireEvent.keyDown(box, { key: "Enter" });
    const placed = screen.getByRole("list", { name: PROFILE.rules.targetsList });
    const items = () => within(placed).getAllByRole("listitem").map((x) => x.textContent); expect(items().slice(-2)).toEqual(["Derby", "Bath"]);
    fireEvent.click(within(placed).getByRole("button", { name: "Remove Derby" })); expect(items()).not.toContain("Derby"); expect(items()).toContain("Bath");
    fireEvent.keyDown(screen.getByLabelText(PROFILE.rules.targets), { key: "Backspace" }); expect(screen.queryAllByRole("listitem").some((x) => x.textContent === "Bath")).toBe(false);
    // Levels are real checkboxes in a labelled group.
    const group = screen.getByRole("group", { name: PROFILE.rules.levels });
    const levels = within(group).getAllByRole("checkbox").map((c) => (c.parentElement as HTMLElement).textContent);
    expect(levels).toEqual(expect.arrayContaining(["Entry", "Junior", "Mid", "Senior", "Lead"]));
    const mid = within(group).getByRole("checkbox", { name: "Mid" }) as HTMLInputElement; const was = mid.checked;
    fireEvent.click(mid); expect(mid.checked).toBe(!was);
    await waitFor(() => expect(saved?.rules.seniority.levels.includes("mid")).toBe(!was), { timeout: 4000 });
    // The place that goes on the CV follows "Where you live now".
    fireEvent.change(screen.getByLabelText(PROFILE.rules.here), { target: { value: "Bristol" } });
    await waitFor(() => expect(saved?.rules.location.cvLocationLines).toEqual(["Bristol"]), { timeout: 4000 });
  });
  it("a card about something waiting for a look: Accept uses it and the card goes; Dismiss only hides the card", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    const waiting = async () => (await screen.findAllByTestId("review-card")).find((c) => c.getAttribute("data-kind") === "needs-review")!, gone = () => expect(screen.queryAllByTestId("review-card").some((c) => c.getAttribute("data-kind") === "needs-review")).toBe(false);
    expect((await waiting()).textContent).toContain("waiting for a look");
    fireEvent.click(within(await waiting()).getByRole("button", { name: PROFILE.dna.accept }));
    await waitFor(gone);
    cleanup(); render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    fireEvent.click(within(await waiting()).getByRole("button", { name: PROFILE.dna.dismiss }));
    await waitFor(gone);
  });
  it("languages, certificates and projects can be added and are saved as the user's own (verified), with the level and year they chose", async () => {
    const bridge = createMockBridge("jobs"); let saved: any = null;
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save") saved = req.profile; return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    const X = PROFILE.dna.extras;
    fireEvent.click(screen.getByRole("button", { name: X.addLanguage })); fireEvent.change(screen.getByLabelText(X.language), { target: { value: "Spanish" } }); choose(X.level, "Professional");
    fireEvent.click(screen.getByRole("button", { name: X.addCert })); fireEvent.change(screen.getByLabelText(X.certName), { target: { value: "Analytics certificate" } }); fireEvent.change(screen.getByLabelText(X.year), { target: { value: "2022" } });
    fireEvent.click(screen.getByRole("button", { name: X.addProject })); fireEvent.change(screen.getByLabelText(X.projectName), { target: { value: "Newsletter rebuild" } }); fireEvent.change(screen.getByLabelText(X.projectText), { target: { value: "Rebuilt a weekly newsletter" } });
    await waitFor(() => expect(saved).not.toBeNull(), { timeout: 4000 });
    expect(saved.extras).toEqual({ languages: [{ id: expect.any(String), name: "Spanish", level: "professional", status: "verified" }], certifications: [{ id: expect.any(String), name: "Analytics certificate", year: 2022, status: "verified" }], projects: [{ id: expect.any(String), name: "Newsletter rebuild", text: "Rebuilt a weekly newsletter", status: "verified" }] });
    fireEvent.click(within(screen.getByTestId("language")).getByRole("button", { name: X.remove })); expect(screen.queryAllByTestId("language").length).toBe(0);
  });
  it("a duplicate card offers Merge, and merging takes one of the two achievements away", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    const card = (await screen.findAllByTestId("review-card")).find((c) => c.getAttribute("data-kind") === "duplicate")!; const before = screen.getAllByTestId("bullet").length;
    fireEvent.click(within(card).getByRole("button", { name: PROFILE.dna.merge }));
    await waitFor(() => expect(screen.getAllByTestId("bullet").length).toBe(before - 1));
    expect(screen.queryAllByTestId("review-card").some((c) => c.getAttribute("data-kind") === "duplicate")).toBe(false);
  });
  it("details the import filled in carry a 'check' mark and a card; 'These are right' clears both and keeps what was filled", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    expect(screen.queryAllByTestId("check-mark").length).toBe(0);
    fireEvent.click(await screen.findByTestId("import-open")); fireEvent.click(screen.getByRole("button", { name: "Choose a file…" })); await waitFor(() => expect((screen.getByLabelText("Paste the text of your CV") as HTMLTextAreaElement).value.length).toBeGreaterThan(20));
    fireEvent.click(screen.getByRole("button", { name: "Find my jobs and skills" })); await screen.findByTestId("import-note");
    await waitFor(() => expect(screen.getAllByTestId("check-mark").length).toBe(1));
    expect((screen.getByLabelText(/^Phone/) as HTMLInputElement).value).toBe("07700 900456");
    const lock = (await screen.findAllByTestId("review-card")).find((c) => c.getAttribute("data-kind") === "locked-check")!;
    fireEvent.click(within(lock).getByRole("button", { name: PROFILE.dna.confirm }));
    await waitFor(() => expect(screen.queryAllByTestId("check-mark").length).toBe(0));
    expect(screen.queryAllByTestId("review-card").some((c) => c.getAttribute("data-kind") === "locked-check")).toBe(false); expect((screen.getByLabelText(/^Phone/) as HTMLInputElement).value).toBe("07700 900456");
  });
  it("a card button saves edits that are still waiting BEFORE it acts, so nothing typed is lost", async () => {
    const bridge = createMockBridge("jobs"); const order: string[] = [];
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save" || ch === "profile:card") order.push(ch); return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "York" } });
    fireEvent.click(within((await screen.findAllByTestId("review-card")).find((c) => c.getAttribute("data-kind") === "needs-review")!).getByRole("button", { name: PROFILE.dna.accept }));
    await waitFor(() => expect(order).toEqual(["profile:save", "profile:card"]));
    await waitFor(() => expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("York"));
  });
  it("an edit autosaves about a second after the last change: Saving shows, then Saved, with the change sent; there is no Save or Undo button", async () => {
    const bridge = createMockBridge("jobs"); const saves: any[] = [];
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save") saves.push(req.profile); return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    expect(screen.queryByTestId("save")).toBeNull(); expect(screen.queryByTestId("undo")).toBeNull();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Y" } }); fireEvent.change(screen.getByLabelText("City"), { target: { value: "York" } });
    expect(saves.length).toBe(0);
    await waitFor(() => expect(screen.getByText(PROFILE.saved)).toBeTruthy(), { timeout: 4000 });
    expect(saves.length).toBe(1); expect(saves[0].identity.city).toBe("York");
  });
  it("Add inserts one blank row and focuses it; pressing Add again only focuses that row, in every list (studies, skills, languages, certificates, projects, roles, achievements)", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    const X = PROFILE.dna.extras, count = (id: string) => screen.queryAllByTestId(id).length;
    const lists: [string, string, string][] = [[PROFILE.education.add, "education", PROFILE.education.text], [PROFILE.skills.add, "skill", PROFILE.skills.name], [X.addLanguage, "language", X.language], [X.addCert, "certificate", X.certName], [X.addProject, "project", X.projectName], [PROFILE.roles.add, "role", PROFILE.roles.title], [PROFILE.roles.addBullet, "bullet", PROFILE.roles.bulletHint]];
    for (const [add, id, first] of lists) {
      const before = count(id), button = screen.getAllByRole("button", { name: add })[0];
      fireEvent.click(button); expect(count(id)).toBe(before + 1);
      await waitFor(() => expect((document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? (document.activeElement as HTMLTextAreaElement | null)?.placeholder).toBe(first));
      const field = document.activeElement as HTMLElement; fireEvent.blur(field, { relatedTarget: button }); expect(count(id)).toBe(before + 1); /* focus moving to the Add button keeps the blank row */ fireEvent.click(button); fireEvent.click(button); expect(count(id)).toBe(before + 1); // a second press only goes back to the blank row
      await waitFor(() => expect(document.activeElement).toBe(field));
    }
    // (the blank row of the list before is removed as focus moves on: leaving a blank row removes it)
    fireEvent.click(screen.getByRole("button", { name: PROFILE.roles.add })); const roles = screen.getAllByTestId("role"); expect(roles.length).toBe(2);
    expect(within(roles[1]).queryAllByTestId("bullet").length).toBe(0); // a new role is made with no achievements: "Add something you did" adds the first
  });
  it("a blank row survives the autosave wait while it has focus, is never shown as Saved, and removes itself when it is left empty", async () => {
    const bridge = createMockBridge("jobs"); const saves: any[] = [];
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save") saves.push(req.profile); return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    const X = PROFILE.dna.extras;
    for (const [add, id, label] of [[X.addLanguage, "language", X.language], [X.addCert, "certificate", X.certName], [X.addProject, "project", X.projectName], [PROFILE.skills.add, "skill", PROFILE.skills.name], [PROFILE.education.add, "education", PROFILE.education.text]] as const) {
      const before = screen.queryAllByTestId(id).length;
      fireEvent.click(screen.getByRole("button", { name: add })); const box = screen.getAllByLabelText(label).find((e) => e.closest(`[data-testid="${id}"]`) && !(e as HTMLInputElement).value) as HTMLElement; box.focus();
      await act(async () => { await new Promise((r) => setTimeout(r, 1200)); }); // longer than the 800 ms autosave wait
      expect(screen.queryAllByTestId(id).length).toBe(before + 1); expect(document.activeElement).toBe(box); expect(screen.queryByText(PROFILE.saved)).toBeNull(); expect(saves.length).toBe(0);
      fireEvent.blur(box); expect(screen.queryAllByTestId(id).length).toBe(before);
    }
    // moving from one box of a row to another box of the same row does not count as leaving it
    fireEvent.click(screen.getByRole("button", { name: X.addCert })); const cert = screen.getByTestId("certificate"); const issuer = within(cert).getByLabelText(X.issuer);
    fireEvent.blur(within(cert).getByLabelText(X.certName), { relatedTarget: issuer }); expect(screen.queryAllByTestId("certificate").length).toBe(1);
    fireEvent.change(within(cert).getByLabelText(X.certName), { target: { value: "First aid" } }); fireEvent.blur(within(cert).getByLabelText(X.certName)); expect(screen.queryAllByTestId("certificate").length).toBe(1); // typed in: it stays
    await waitFor(() => expect(saves.length).toBe(1), { timeout: 4000 });
  }, 30000);
  it("nothing blank is ever sent in profile:save: no blank study, skill, language, certificate or project, no role without a title or company, no achievement without text", async () => {
    const bridge = createMockBridge("jobs"); const saves: any[] = [];
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save") saves.push(structuredClone(req.profile)); return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    const X = PROFILE.dna.extras;
    for (const n of [PROFILE.education.add, PROFILE.skills.add, X.addLanguage, X.addCert, X.addProject, PROFILE.roles.add, PROFILE.roles.addBullet]) fireEvent.click(screen.getAllByRole("button", { name: n })[0]);
    const newRole = screen.getAllByTestId("role").at(-1)!; fireEvent.change(within(newRole).getByLabelText(PROFILE.roles.title), { target: { value: "Only a title" } }); // no company yet
    fireEvent.change(within(screen.getByTestId("language")).getByLabelText(X.language), { target: { value: "Welsh" } });
    fireEvent.change(within(screen.getByTestId("project")).getByLabelText(X.projectName), { target: { value: "Half a project" } }); // no description yet
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "York" } });
    await waitFor(() => expect(saves.length).toBeGreaterThan(0), { timeout: 4000 });
    for (const p of saves) {
      expect(p.education.every((e: any) => e.text.trim())).toBe(true); expect(p.skills.every((x: any) => x.name.trim())).toBe(true);
      expect(p.extras.languages.map((x: any) => x.name)).toEqual(["Welsh"]); expect(p.extras.certifications).toEqual([]); expect(p.extras.projects).toEqual([]);
      expect(p.roles.every((r: any) => r.title.trim() && r.company.trim() && r.bullets.every((b: any) => b.text.trim()))).toBe(true); expect(p.roles.length).toBe(1); expect(p.roles[0].bullets.length).toBe(4);
    }
    expect(screen.getAllByTestId("role").length).toBe(2); expect(screen.getAllByTestId("bullet").length).toBe(5); // the page still shows every row the user has started
  });
  it("Skills are a plain list of chips: no group box, no group headings and no number badge; a stored group stays in the data", async () => {
    const bridge = createMockBridge("jobs"); let saved: any = null;
    const spy: CvAppBridge = { on: bridge.on, invoke: (async (ch: string, req: any) => { if (ch === "profile:save") saved = req.profile; if (ch === "profile:get") { const r: any = await (bridge.invoke as any)(ch, req); const pr = structuredClone(r.data.profile); pr.skills[0].group = "Tools"; return { ...r, data: { ...r.data, profile: pr } }; } return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    const chips = screen.getAllByTestId("skill"); expect(chips.length).toBe(2);
    for (const c of chips) { expect(c.querySelectorAll("input").length).toBe(1); expect(c.querySelector(".chip-evidence")).toBeNull(); }
    expect(screen.queryByText("Other skills")).toBeNull(); expect(screen.queryByLabelText(/^Group/)).toBeNull(); expect(screen.queryByText("Tools")).toBeNull();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "York" } }); await waitFor(() => expect(saved).not.toBeNull(), { timeout: 4000 });
    expect(saved.skills[0].group).toBe("Tools");
  });
  it("the hard facts: Phone and LinkedIn say (optional); the rest are required and say so, quietly, once they have been left empty", async () => {
    render(<App bridge={createMockBridge("noprofile")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    expect(screen.getByLabelText(PROFILE.details.phone)).toBeTruthy(); expect(PROFILE.details.phone).toContain("(optional)"); expect(PROFILE.details.linkedin).toContain("(optional)");
    for (const l of [PROFILE.details.name, PROFILE.details.city, PROFILE.details.country, PROFILE.details.email, PROFILE.rules.rtw]) expect(screen.getByLabelText(l).getAttribute("aria-required")).toBe("true");
    for (const l of [PROFILE.details.phone, PROFILE.details.linkedin]) expect(screen.getByLabelText(l).getAttribute("aria-required")).toBeNull();
    expect(screen.queryAllByTestId("required-hint").length).toBe(0); // nothing is flagged before a field has been visited
    fireEvent.blur(screen.getByLabelText(PROFILE.details.email)); fireEvent.blur(screen.getByLabelText(PROFILE.details.phone));
    const hints = screen.getAllByTestId("required-hint"); expect(hints.length).toBe(1); expect(hints[0].textContent).toBe(PROFILE.details.required);
    expect(screen.getByLabelText(PROFILE.details.email).getAttribute("aria-describedby")).toBe(hints[0].id);
    fireEvent.change(screen.getByLabelText(PROFILE.details.email), { target: { value: "a@b.co" } }); expect(screen.queryAllByTestId("required-hint").length).toBe(0);
  });
  it("the Focus and Never say sections are gone, and a bullet no longer offers an 'only for focus' choice even when focus types are stored; the stored data is left as it was", async () => {
    const bridge = createMockBridge("jobs"); let saved: any = null;
    const spy: CvAppBridge = { on: bridge.on, invoke: (async (ch: string, req: any) => { if (ch === "profile:save") saved = req.profile; if (ch === "profile:get") { const r: any = await (bridge.invoke as any)(ch, req); const pr = structuredClone(r.data.profile); pr.focusTypes = [{ id: 7, name: "A", headline: "h", leadTags: [], status: "verified" }]; pr.doNotUse = [{ id: "a1", kind: "phrase", text: "rockstar", note: "" }]; pr.roles[0].bullets[0].onlyForFocus = [7]; return { ...r, data: { ...r.data, profile: pr } }; } return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    expect(screen.queryByTestId("focus")).toBeNull(); expect(screen.queryByTestId("avoid")).toBeNull(); expect(screen.queryByText(/only use this when/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "York" } }); await waitFor(() => expect(saved).not.toBeNull(), { timeout: 4000 });
    expect(saved.focusTypes.map((f: any) => f.id)).toEqual([7]); expect(saved.doNotUse.map((x: any) => x.text)).toEqual(["rockstar"]); expect(saved.roles[0].bullets[0].onlyForFocus).toEqual([7]);
  });
  it("a story the user writes is trusted at once and saved as theirs", async () => {
    const bridge = createMockBridge("jobs"); let saved: any = null;
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save") saved = req.profile; return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    fireEvent.click(screen.getAllByRole("button", { name: PROFILE.dna.addStory })[0]); fireEvent.change(screen.getAllByLabelText(PROFILE.roles.story)[0], { target: { value: "I turned the team around." } });
    await waitFor(() => expect(saved).not.toBeNull(), { timeout: 4000 });
    expect(saved.roles[0].story).toEqual({ text: "I turned the team around.", status: "verified" });
  });
  it("the start gate is shown on the page and updates after a save", async () => {
    render(<App bridge={createMockBridge("noprofile")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    expect(screen.getByText(PROFILE.gateTitle)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Person" } }); fireEvent.change(screen.getByLabelText("City"), { target: { value: "Leeds" } });
    await waitFor(() => expect(screen.getByText(PROFILE.saved)).toBeTruthy(), { timeout: 4000 }); expect(document.body.textContent).not.toContain("your name and city");
  });
});

describe("Build CV and extras", () => {
  const open = async (name: RegExp) => { fireEvent.click(await sideJob(name)); await screen.findByTestId("verdict"); };
  it("Build CV shows the working state and then 'Your CV is ready' with Open, Show in Finder and Build again", async () => {
    render(<App bridge={createMockBridge("jobs")} />); await open(/Acme/);
    fireEvent.click(screen.getByTestId("build")); await screen.findByText(BUILD.working);
    const done = await screen.findByTestId("built", undefined, { timeout: 5000 }); expect(done.textContent).toContain(BUILD.built.title);
    for (const n of [BUILD.built.open, BUILD.built.reveal, CARD.buildAgain]) expect(screen.getByRole("button", { name: n })).toBeTruthy();
    expect(screen.queryByTestId("build")).toBeNull(); // the main Build CV button is gone once a CV exists (only "Build again" remains)
  });
  it("a missing fact is asked in plain words, with 'build again', 'build without it' and a way to My profile", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.change(await screen.findByLabelText("Job ad or link"), { target: { value: "A marketing role with a question about budgets, new ad." } }); fireEvent.click(screen.getByRole("button", { name: NEW_JOB.send }));
    await screen.findByTestId("verdict", undefined, { timeout: 5000 }); fireEvent.click(screen.getByTestId("build"));
    const ask = await screen.findByTestId("needs-fact", undefined, { timeout: 5000 }); expect(ask.textContent).toContain("paid search budget"); expect(screen.queryByText("Resume")).toBeNull(); // one set of actions only: the fact card has its own buttons, no second "Resume" banner
    for (const n of [BUILD.fact.added, BUILD.fact.without, BUILD.fact.profile]) expect(screen.getByRole("button", { name: n })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: BUILD.fact.without })); await screen.findByTestId("built", undefined, { timeout: 5000 });
  }, 15000);
  it("a CV that does not fit one page offers a shorter version or a longer one, and the user chooses", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.change(await screen.findByLabelText("Job ad or link"), { target: { value: "A marketing role, layout test, new ad text." } }); fireEvent.click(screen.getByRole("button", { name: NEW_JOB.send }));
    await screen.findByTestId("verdict", undefined, { timeout: 5000 }); fireEvent.click(screen.getByTestId("build"));
    const ask = await screen.findByTestId("needs-layout", undefined, { timeout: 5000 }); expect(ask.textContent).toContain("2 pages"); expect(ask.textContent).toMatch(/^The CV doesn't fit on one page[A-Z]/); expect(screen.queryByText("Resume")).toBeNull(); // the reason starts with a capital letter
    fireEvent.click(screen.getByRole("button", { name: BUILD.layout.shorter })); await screen.findByTestId("built", undefined, { timeout: 5000 });
  }, 15000);
  it("while a job runs the page shows the real steps as they begin and end: a ring for the one working, a tick for each finished one, and nothing for an unknown step", async () => {
    const bridge = createMockBridge("jobs"); let fire: ((p: any) => void) | null = null;
    const spy: CvAppBridge = { invoke: bridge.invoke, on: ((ev: string, l: any) => { if (ev === "jobs:step") { fire = l; return () => undefined; } return (bridge.on as any)(ev, l); }) as never };
    render(<App bridge={spy} />); fireEvent.click(await sideJob(/Bramble/));
    fireEvent.click(await screen.findByRole("button", { name: /Resume/ })); await screen.findByTestId("working");
    const id = (await (bridge.invoke as any)("jobs:list")).data.find((r: any) => /Bramble/.test(r.title)).id;
    const send = (scope: string, name: string, phase: string) => act(() => { fire!({ jobId: id, scope, name, phase }); });
    send("analyse", "analyst", "start"); expect((await screen.findByTestId("stages")).textContent).toContain("Reading the ad");
    expect(screen.getByTestId("stages").querySelector(".stage-on")).not.toBeNull();
    send("analyse", "analyst", "done"); expect(screen.getByTestId("stages").querySelector(".stage-done")!.textContent).toContain("Reading the ad");
    send("analyse", "mystery", "start"); send("other", "analyst", "start"); expect(screen.getByTestId("stages").querySelectorAll("li").length).toBe(1);
    act(() => { fire!({ jobId: "someone-else", scope: "analyse", name: "check", phase: "start" }); }); expect(screen.getByTestId("stages").querySelectorAll("li").length).toBe(1);
  });
  it("each extra is written on request and shown with a Copy button (nothing is written until asked)", async () => {
    render(<App bridge={createMockBridge("jobs")} />); await open(/Acme/);
    expect(screen.queryByTestId("extra")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: BUILD.extras.cover }));
    const x = await screen.findByTestId("extra", undefined, { timeout: 4000 }); expect(x.textContent).toContain("Dear hiring team"); expect(x.textContent).toContain("backed by your profile");
    fireEvent.click(screen.getByRole("button", { name: BUILD.extras.copy })); await screen.findByText(BUILD.extras.copied);
  });
  it("an extra can be edited first: Copy and Save use the edited text, a note says edits are not stored, Undo my edits restores the original", async () => {
    const bridge = createMockBridge("jobs"); const calls: { ch: string; req: any }[] = [];
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { calls.push({ ch, req }); return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />); await open(/Acme/);
    fireEvent.click(screen.getByRole("button", { name: BUILD.extras.cover })); await screen.findByTestId("extra", undefined, { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: BUILD.extras.edit }));
    fireEvent.change(screen.getByLabelText(/text$/), { target: { value: "My own words." } });
    fireEvent.click(screen.getByRole("button", { name: BUILD.extras.doneEdit }));
    expect(screen.getByTestId("extra").textContent).toContain("My own words."); expect(screen.getByText(BUILD.extras.editedNote)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: BUILD.extras.copy })); await screen.findByText(BUILD.extras.copied);
    expect(calls.filter((c) => c.ch === "app:copy").at(-1)!.req.text).toBe("My own words.");
    fireEvent.click(screen.getByTestId("extra-save")); await screen.findByText(BUILD.extras.saved);
    const saved = calls.filter((c) => c.ch === "data:saveText").at(-1)!.req; expect(saved.text).toBe("My own words."); expect(saved.name).toContain("Acme");
    fireEvent.click(screen.getByTestId("extra-save-docx")); fireEvent.click(screen.getByTestId("extra-save-pdf")); await waitFor(() => expect(calls.filter((c) => c.ch === "data:saveText").map((c) => c.req.format)).toEqual(["txt", "docx", "pdf"]));
    expect(calls.filter((c) => c.ch === "data:saveText").every((c) => c.req.text === "My own words.")).toBe(true); // all three formats use the edited text
    fireEvent.click(screen.getByRole("button", { name: BUILD.extras.reset }));
    expect(screen.getByTestId("extra").textContent).toContain("Dear hiring team"); expect(screen.queryByText(BUILD.extras.editedNote)).toBeNull();
  });
});

describe("History and Settings", () => {
  it("History shows 200 rows, and 'Show more' loads the next page again and again with no limit until everything is shown", async () => {
    const bridge = createMockBridge("jobs"); const all = Array.from({ length: 450 }, (_, i) => ({ id: `j${i}`, title: `Company ${i}, Role`, status: "analysed", verdict: "apply", fit: 70 }));
    const spy: CvAppBridge = { on: bridge.on, invoke: (async (ch: string, req: any) => ch === "history:search" ? { ok: true, data: { rows: all.slice(Number(req.offset ?? 0), Number(req.offset ?? 0) + 200), total: 450 } } : (bridge.invoke as any)(ch, req)) as never };
    render(<App bridge={spy} />); fireEvent.click(await screen.findByRole("button", { name: "History" }));
    await waitFor(() => expect(screen.getAllByTestId("history-row").length).toBe(200));
    fireEvent.click(screen.getByTestId("history-more")); await waitFor(() => expect(screen.getAllByTestId("history-row").length).toBe(400));
    fireEvent.click(screen.getByTestId("history-more")); await waitFor(() => expect(screen.getAllByTestId("history-row").length).toBe(450));
    expect(screen.queryByTestId("history-more")).toBeNull();
  });
  it("History lists the jobs with verdict and fit, searches by company, filters by verdict and opens a job", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "History" })); await screen.findByTestId("history");
    await waitFor(() => expect(screen.getAllByTestId("history-row").length).toBe(4)); expect(screen.getByTestId("history-summary").textContent).toMatch(/4 jobs, 3 analysed/);
    fireEvent.change(screen.getByLabelText("Search jobs"), { target: { value: "lark" } }); await waitFor(() => expect(screen.getAllByTestId("history-row").length).toBe(1));
    fireEvent.change(screen.getByLabelText("Search jobs"), { target: { value: "" } }); choose("Any verdict", "Skip");
    await waitFor(() => expect(screen.getAllByTestId("history-row").length).toBe(1));
    fireEvent.click(screen.getByTestId("history-row")); await screen.findByTestId("job-detail");
  });
  it("a search with no match says so; with no jobs at all it explains how to start", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "History" })); fireEvent.change(await screen.findByLabelText("Search jobs"), { target: { value: "zzzz" } });
    expect((await screen.findByTestId("history-empty")).textContent).toContain("No jobs match");
  });
  it("Settings shows Claude, notifications, CV options, start-up, data and the version; a change is saved and confirmed", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" })); await screen.findByTestId("settings");
    await screen.findByLabelText("Tone of Claude's messages");
    fireEvent.click(screen.getByLabelText("A CV is ready")); await waitFor(() => expect((screen.getByLabelText("A CV is ready") as HTMLInputElement).checked).toBe(false));
    choose("Tone of Claude's messages", "Concise"); await screen.findByText("Saved.");
    expect(screen.getByText(/Version preview/)).toBeTruthy(); expect(screen.getByRole("button", { name: "Save a copy of everything" })).toBeTruthy();
  });
  it("Delete everything stays off until the exact phrase is typed, then says the app will close", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" })); const go = await screen.findByRole("button", { name: "Delete everything now" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true); fireEvent.change(screen.getByLabelText("Type delete everything"), { target: { value: "delete" } }); expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type delete everything"), { target: { value: "Delete Everything" } }); expect(go.disabled).toBe(false);
    fireEvent.click(go); expect((await screen.findByTestId("deleted")).textContent).toContain("will close");
  });
  it("Export reports how many jobs were saved", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" })); fireEvent.click(await screen.findByRole("button", { name: "Save a copy of everything" }));
    expect((await screen.findByTestId("settings-msg")).textContent).toContain("Saved 4 jobs");
  });
});

describe("Replaying the first-run guide", () => {
  it("Settings > About has 'Show the guide': it opens the guide again, and skipping it comes back to the app", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" })); fireEvent.click(await screen.findByRole("button", { name: "About" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show the guide" }));
    await screen.findByTestId("onboarding"); expect(screen.queryByTestId("main")).toBeNull();
    await throughGuide(); await screen.findByTestId("main");
  });
});

describe("Settings search", () => {
  it("the search box filters the sections by their name and by the settings inside; nothing found says so; clearing brings everything back", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" })); const box = await screen.findByLabelText("Search settings") as HTMLInputElement;
    const names = () => Array.from(document.querySelectorAll(".set-nav-item")).map((b) => b.textContent);
    expect(names().length).toBe(9);
    fireEvent.change(box, { target: { value: "token" } }); expect(names()).toEqual(["Telegram (optional)"]);
    fireEvent.change(box, { target: { value: "dark" } }); expect(names()).toEqual(["Appearance"]);
    fireEvent.change(box, { target: { value: "DELETE" } }); expect(names()).toEqual(["Your data"]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your data"); // the page follows the search: the first match opens
    fireEvent.change(box, { target: { value: "zzzz" } }); expect(names()).toEqual([]); expect(screen.getByText("No settings match that.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "" } }); expect(names().length).toBe(9);
  });
});

describe("Telegram in Settings", () => {
  it("a bad token is refused in plain words; a good one connects; pairing shows a code; the token is never shown again", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" })); const field = await screen.findByLabelText("Bot token") as HTMLInputElement; expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: "nope" } }); fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    expect((await screen.findByTestId("tg-msg")).textContent).toContain("doesn't look like a bot token");
    const good = "123456789:AAFakeFakeFakeFakeFakeFakeFakeFake_abc"; fireEvent.change(field, { target: { value: good } }); fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pair with my Telegram" }));
    expect((await screen.findByTestId("tg-code")).textContent).toContain("482913");
    expect(document.body.innerHTML).not.toContain("AAFakeFake");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); await screen.findByRole("button", { name: "Pair with my Telegram" });
  }, 15000);
});

describe("leaving My profile", () => {
  it("never asks anything; a change still waiting is saved on the way out", async () => {
    const real = window.confirm; const asked: string[] = []; window.confirm = (m?: string) => { asked.push(String(m)); return false; };
    try {
      const bridge = createMockBridge("jobs"); const saves: any[] = [];
      const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save") saves.push(req.profile); return (bridge.invoke as any)(ch, req); }) as never };
      render(<App bridge={spy} />);
      fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
      fireEvent.change(screen.getByLabelText("City"), { target: { value: "York" } });
      fireEvent.click(screen.getByRole("button", { name: "History" })); await screen.findByTestId("history");
      expect(asked.length).toBe(0); await waitFor(() => expect(saves.at(-1)?.identity.city).toBe("York"));
    } finally { window.confirm = real; }
  });
});

describe("small profile and sign-in details", () => {
  it("a role that ends before it starts is explained and is not saved; a bad month is explained", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    fireEvent.click(screen.getByLabelText("I still work here")); fireEvent.change(screen.getByLabelText("End year"), { target: { value: "2010" } }); fireEvent.change(screen.getByLabelText("End month"), { target: { value: "1" } });
    expect((await screen.findByTestId("date-problem")).textContent).toContain("ends before it starts");
    expect((await screen.findByTestId("errors", {}, { timeout: 4000 })).textContent).toContain("ends before it starts");
    fireEvent.change(screen.getByLabelText("End year"), { target: { value: "2024" } }); fireEvent.change(screen.getByLabelText("End month"), { target: { value: "13" } });
    expect((await screen.findByTestId("date-problem")).textContent).toContain("1 to 12");
  });
  it("the Telegram token can be shown while typing and is hidden by default", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" })); const f = await screen.findByLabelText("Bot token") as HTMLInputElement; expect(f.type).toBe("password");
    fireEvent.click(screen.getByLabelText("Show the token while I type")); expect(f.type).toBe("text");
  });
  it("when Claude becomes connected (for example after signing in) a banner says so", async () => {
    render(<App bridge={createMockBridge("signedout")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect((await screen.findByText("Claude is connected", { selector: "strong" }, { timeout: 12000 })).textContent).toBeTruthy();
  }, 20000);
});

describe("usage, delete jobs only, restore from a copy", () => {
  it("Settings shows this month's use; delete jobs needs its own phrase; restore describes the copy and needs a phrase", async () => {
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" })); expect((await screen.findByTestId("usage")).textContent).toContain("Subscription, this month");
    const go = screen.getByRole("button", { name: "Delete jobs now" }) as HTMLButtonElement; expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type delete jobs"), { target: { value: "delete everything" } }); expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type delete jobs"), { target: { value: "Delete Jobs" } }); expect(go.disabled).toBe(false); fireEvent.click(go);
    expect((await screen.findByTestId("settings-msg")).textContent).toContain("Deleted 4 jobs");
    fireEvent.click(screen.getByRole("button", { name: "Choose a copy…" })); expect((await screen.findByTestId("restore-found")).textContent).toContain("holds 12 jobs and a profile");
    const rg = screen.getByRole("button", { name: "Replace everything with this copy" }) as HTMLButtonElement; expect(rg.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type replace everything"), { target: { value: "replace everything" } }); expect(rg.disabled).toBe(false); fireEvent.click(rg);
    expect((await screen.findByTestId("restored")).textContent).toContain("will close");
  });
});

describe("CV import", () => {
  const openImport = async (scenario = "noprofile") => { render(<App bridge={createMockBridge(scenario)} />); fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile"); fireEvent.click(await screen.findByTestId("import-open")); await screen.findByTestId("import-cv"); };
  it("explains what is sent before anything is: contact details are removed first, and the button stays off until there is text", async () => {
    await openImport(); expect(screen.getByTestId("import-cv").textContent).toContain("email address, phone number and LinkedIn link are removed first");
    const go = screen.getByRole("button", { name: "Find my jobs and skills" }) as HTMLButtonElement; expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Paste the text of your CV"), { target: { value: "Marketing Coordinator at Northfield Retail since March 2021, weekly emails." } }); expect(go.disabled).toBe(false);
  });
  it("a file chosen in the dialog fills the text box (nothing is sent until the user presses the button)", async () => {
    await openImport(); fireEvent.click(screen.getByRole("button", { name: "Choose a file…" })); await waitFor(() => expect((screen.getByLabelText("Paste the text of your CV") as HTMLTextAreaElement).value).toContain("Northfield Retail"));
  });
  it("the result is SAVED at once (schema v2): a summary, a warning about an item not found in the CV, a card about the one waiting item shows, nothing is left waiting to save, the bullet the CV contains is trusted and only the unmatched one waits in Review", async () => {
    await openImport(); fireEvent.click(screen.getByRole("button", { name: "Choose a file…" })); await waitFor(() => expect((screen.getByLabelText("Paste the text of your CV") as HTMLTextAreaElement).value.length).toBeGreaterThan(20));
    fireEvent.click(screen.getByRole("button", { name: "Find my jobs and skills" }));
    const note = await screen.findByTestId("import-note"); expect(note.textContent).toContain("Added 1 job, 2 achievements, 1 skill and 0 education lines from your CV"); expect(note.textContent).toContain("Needs a look"); expect(note.textContent).toContain("1 item wasn't found word for word");
    expect(screen.queryByTestId("save")).toBeNull();
    expect((await screen.findAllByTestId("review-card")).some((c) => /1 achievement waiting for a look/.test(c.textContent ?? ""))).toBe(true); expect(screen.getAllByTestId("bullet").length).toBeGreaterThan(1);
  });
  it("edits not saved yet are saved BEFORE the import runs, so the import can never overwrite them", async () => {
    const bridge = createMockBridge("jobs"); const order: string[] = [];
    const spy: CvAppBridge = { on: bridge.on, invoke: ((ch: string, req: any) => { if (ch === "profile:save" || ch === "profile:import") order.push(ch); return (bridge.invoke as any)(ch, req); }) as never };
    render(<App bridge={spy} />); fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Leeds, edited" } }); fireEvent.click(await screen.findByTestId("import-open"));
    fireEvent.click(screen.getByRole("button", { name: "Choose a file…" })); await waitFor(() => expect((screen.getByLabelText("Paste the text of your CV") as HTMLTextAreaElement).value.length).toBeGreaterThan(20));
    fireEvent.click(screen.getByRole("button", { name: "Find my jobs and skills" })); await screen.findByTestId("import-note");
    expect(order).toEqual(["profile:save", "profile:import"]);
  });
});

describe("My profile page", () => {
  const openRaw = async (scenario = "jobs") => { render(<App bridge={createMockBridge(scenario)} />); fireEvent.click(await screen.findByRole("button", { name: "My profile" })); await screen.findByTestId("profile"); };
  it("opens on the page: what Claude can use at a glance, the editable fields, the role written as a sentence, and no persona view button", async () => {
    await openRaw(); expect(screen.getByTestId("dna-stats").textContent).toMatch(/Verified, used by Claude/); expect(screen.getByLabelText("Full name")).toBeTruthy(); expect(screen.getByTestId("role").textContent).toContain("I work as");
    expect(screen.queryByTestId("edit-done")).toBeNull(); expect(screen.queryByText("Persona view")).toBeNull();
  });
  it("a profile with no roles opens in the editor too", async () => {
    await openRaw("noprofile"); expect(screen.getByLabelText("Full name")).toBeTruthy();
  });
  it("the cards for what needs a look are shown on the page, with their buttons", async () => {
    await openRaw(); const c = (await screen.findAllByTestId("review-card")).find((x) => x.getAttribute("data-kind") === "needs-review")!; fireEvent.click(within(c).getByRole("button", { name: PROFILE.dna.accept }));
    await waitFor(() => expect(screen.queryAllByTestId("review-card").some((x) => x.getAttribute("data-kind") === "needs-review")).toBe(false));
  });
});

describe("first-run guide", () => {
  it("a new user sees the guide before anything else: the promise, a sample verdict, no way to skip the whole guide, and nothing of the app reachable", async () => {
    render(<App bridge={createMockBridge("onboarding")} />);
    const ob = await screen.findByTestId("onboarding"); expect(ob.textContent).toContain("Know if a job is worth it before you apply."); expect(screen.getByRole("img", { name: "Fit 78%" })).toBeTruthy();
    expect(screen.queryByTestId("onboarding-skip")).toBeNull(); expect(screen.queryByText("Skip setup")).toBeNull(); expect(ob.querySelector(".topbar-title")).toBeNull(); expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  });
  it("the steps run welcome, how it stays honest, connect Claude, start your profile; Back works; Connect needs a connection (there is no way to skip it)", async () => {
    render(<App bridge={createMockBridge("onboarding")} />);
    fireEvent.click(await screen.findByTestId("ob-next")); expect((await screen.findByTestId("onboarding")).textContent).toContain("Only what's true leaves your profile.");
    fireEvent.click(screen.getByRole("button", { name: "Back" })); expect(screen.getByTestId("onboarding").textContent).toContain("Know if a job is worth it");
    fireEvent.click(screen.getByTestId("ob-next")); fireEvent.click(screen.getByTestId("ob-next"));
    await screen.findByTestId("connect"); expect((screen.getByTestId("ob-next") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Do this later" })).toBeNull(); expect(screen.queryByText("Skip setup")).toBeNull(); // no way past Connect without connecting
  });
  it("the last step offers exactly two ways, each on its own screen: import a CV or start from scratch; no Finish, no sphere, no skip, no paste box", async () => {
    render(<App bridge={createMockBridge("onboarding")} />); await toLastStep();
    await screen.findByTestId("ob-cv"); expect(screen.getByTestId("ob-cv").textContent).toContain("Import from my CV"); expect(screen.getByTestId("ob-scratch").textContent).toContain("Start from scratch");
    for (const id of ["ob-finish", "ob-speak", "sphere-still"]) expect(screen.queryByTestId(id)).toBeNull(); expect(screen.queryByText("Skip for now")).toBeNull();
    fireEvent.click(screen.getByTestId("ob-cv")); await screen.findByTestId("cv-upload"); expect(screen.queryByTestId("ob-scratch")).toBeNull(); expect(screen.queryByLabelText("Paste the text of your CV")).toBeNull(); expect(screen.queryByLabelText(/I understand/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" })); await screen.findByTestId("ob-scratch");
  }, 15000);
  it("importing the CV is one button: choose the file, the loading screen shows, the guide finishes and lands on Home (not the profile); the guide does not return", async () => {
    const bridge = createMockBridge("onboarding"); const { unmount } = render(<App bridge={bridge} />); await toLastStep();
    fireEvent.click(await screen.findByTestId("ob-cv")); fireEvent.click(await screen.findByTestId("cv-choose"));
    await screen.findByTestId("ob-working"); await screen.findByTestId("main", undefined, { timeout: 5000 }); expect(screen.queryByTestId("onboarding")).toBeNull(); expect(screen.queryByTestId("profile")).toBeNull(); unmount();
    render(<App bridge={bridge} />); await screen.findByTestId("main"); expect(screen.queryByTestId("onboarding")).toBeNull();
  }, 20000);
  const type = (label: string, value: string) => { const el = screen.getByLabelText(label); if (el.getAttribute("role") === "combobox") { fireEvent.click(el); fireEvent.click(screen.getAllByRole("option")[Number(value)]); } else fireEvent.change(el, { target: { value } }); }, next = () => fireEvent.click(screen.getByTestId("wiz-next")), step = () => screen.getByTestId("wizard").getAttribute("data-step");
  const openWizard = async (bridge = createMockBridge("onboarding")) => { render(<App bridge={bridge} />); await toLastStep(); fireEvent.click(await screen.findByTestId("ob-scratch")); await screen.findByTestId("wizard"); return bridge; };
  it("Start from scratch walks one requirement per screen; Next stays off until each is met; at the end the profile is saved, meets the start gate and you land on Home", async () => {
    const bridge = await openWizard(); expect(step()).toBe("you"); const nx = () => screen.getByTestId("wiz-next") as HTMLButtonElement; expect(nx().disabled).toBe(true);
    type("Full name", "Sam Example"); type("City", "Leeds"); expect(nx().disabled).toBe(true); type("Country", "United Kingdom"); expect(nx().disabled).toBe(false); next();
    expect(step()).toBe("contact"); expect(nx().disabled).toBe(true); type("Email address", "not an email"); expect(nx().disabled).toBe(true); type("Email address", "sam@example.com"); next();
    expect(step()).toBe("job0"); type("Job title", "Marketing Coordinator"); type("Employer", "Northfield Retail"); expect(nx().disabled).toBe(true); type("Started: month", "3"); type("Started: year", "2021"); expect(nx().disabled).toBe(false); next();
    expect(step()).toBe("wins0"); for (const w of ["Grew the newsletter list from 1,200 to 3,600 subscribers.", "Cut the weekly report from four hours to two.", "Led a team of five to launch the spring campaign."]) { expect(nx().disabled).toBe(true); type("One achievement", w); fireEvent.click(screen.getByTestId("wiz-add-win")); }
    expect(screen.getByTestId("wiz-win-count").textContent).toContain("3 of at least 3"); next();
    expect(step()).toBe("more"); next();
    expect(step()).toBe("skills"); expect(nx().disabled).toBe(true); for (const s of ["Excel", "SQL", "Project management"]) fireEvent.click(screen.getByRole("button", { name: s })); expect(nx().disabled).toBe(false); next();
    expect(step()).toBe("edu"); next(); expect(step()).toBe("extras"); next();
    expect(step()).toBe("where"); expect((screen.getByLabelText("Where you live now") as HTMLInputElement).value).toBe("Leeds"); expect(nx().disabled).toBe(true); fireEvent.click(screen.getByTestId("mode-hybrid")); expect(nx().disabled).toBe(false); next();
    expect(step()).toBe("rtw"); expect(nx().disabled).toBe(true); fireEvent.click(screen.getByRole("button", { name: "I have the right to work in the UK" })); expect(nx().textContent).toBe("Build my profile"); next();
    await screen.findByTestId("main", undefined, { timeout: 5000 }); expect(screen.queryByTestId("onboarding")).toBeNull();
    const g: any = await bridge.invoke("profile:get"); expect(g.data.gate.ok).toBe(true); expect(g.data.profile.roles[0].bullets.length).toBe(3); expect(g.data.profile.identity.email).toBe("sam@example.com");
  }, 40000);
  it("'Add another job' loops back to the job and achievements screens for the next job", async () => {
    await openWizard(); type("Full name", "Sam Example"); type("City", "Leeds"); type("Country", "UK"); next(); type("Email address", "sam@example.com"); next();
    type("Job title", "Coordinator"); type("Employer", "Acme"); type("Started: month", "3"); type("Started: year", "2021"); next();
    for (const w of ["One win.", "Two wins.", "Three wins."]) { type("One achievement", w); fireEvent.click(screen.getByTestId("wiz-add-win")); } next();
    fireEvent.click(screen.getByTestId("wiz-add-job")); expect(step()).toBe("job1"); expect(screen.getByRole("heading").textContent).toBe("Job number 2.");
  }, 20000);
  it("'Skip, I'll finish this in my profile' saves what is complete and lands on Home; with nothing to save it just finishes", async () => {
    const bridge = await openWizard(); type("Full name", "Sam Example"); type("City", "Leeds"); fireEvent.click(screen.getByTestId("wiz-later"));
    await screen.findByTestId("main", undefined, { timeout: 5000 }); const g: any = await bridge.invoke("profile:get"); expect(g.data.profile.identity.name).toBe("Sam Example"); expect(g.data.gate.ok).toBe(false);
  }, 20000);
  it("Back on the first wizard screen returns to the two ways; the wizard has no consent box", async () => {
    await openWizard(); expect(screen.queryByLabelText(/I understand/)).toBeNull(); fireEvent.click(screen.getByTestId("wiz-back")); await screen.findByTestId("ob-scratch");
  }, 15000);
  it("dictating into an achievement box adds the transcribed words (the mic sits inside the box)", async () => {
    (globalThis as any).__mic = {}; await openWizard(); type("Full name", "Sam Example"); type("City", "Leeds"); type("Country", "UK"); next(); type("Email address", "sam@example.com"); next();
    type("Job title", "Coordinator"); type("Employer", "Acme"); type("Started: month", "3"); type("Started: year", "2021"); next();
    fireEvent.click(screen.getByTestId("mic-w-win")); await screen.findByRole("button", { name: "Stop and send" }); fireEvent.click(screen.getByTestId("mic-w-win"));
    await waitFor(() => expect((screen.getByLabelText("One achievement") as HTMLTextAreaElement).value).toContain("I ran the weekly newsletter."), { timeout: 4000 });
  }, 20000);
});

describe("light and dark", () => {
  it("Settings > Appearance offers Light, Dark and Match my Mac; choosing one applies at once and is saved", async () => {
    document.documentElement.removeAttribute("data-theme");
    render(<App bridge={createMockBridge("jobs")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" })); fireEvent.click(await screen.findByRole("button", { name: "Appearance" }));
    const light = await screen.findByRole("radio", { name: "Light" }) as HTMLInputElement; expect(light.checked).toBe(true);
    for (const n of ["Dark", "Match my Mac"]) expect(screen.getByRole("radio", { name: n })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark"); await waitFor(() => expect((screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole("radio", { name: "Match my Mac" })); expect(document.documentElement.dataset.theme).toBeUndefined();
    fireEvent.click(screen.getByRole("radio", { name: "Light" })); expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("the first-run guide asks light or dark on its first step, and the choice is applied at once", async () => {
    document.documentElement.removeAttribute("data-theme");
    render(<App bridge={createMockBridge("onboarding")} />);
    await screen.findByTestId("onboarding"); fireEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("OpenAI on the Connect screen", () => {
  afterEach(() => setService("claude"));
  it("offers both services; choosing OpenAI re-words the screen (ChatGPT plan, OpenAI API key) and the status line", async () => {
    render(<App bridge={createMockBridge("fresh")} />);
    await screen.findByTestId("connect");
    expect(screen.getByRole("button", { name: "Claude" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "OpenAI (ChatGPT plan or API key)" }));
    expect(await screen.findByRole("button", { name: "Use my ChatGPT plan" })).toBeTruthy(); expect(screen.getByRole("button", { name: "Use an OpenAI API key" })).toBeTruthy();
    expect(screen.getByTestId("beta-note").textContent).toContain("Beta"); // the OpenAI option is a beta and says so
    expect(screen.getByTestId("connect").textContent).not.toMatch(/Claude subscription/);
    await waitFor(() => expect(screen.getByTestId("status-line").textContent).toContain("OpenAI is not connected"));
  });
  it("the ChatGPT plan needs its own notice ticked, then offers 'Continue with ChatGPT', shows the sign-in link on the sign-in host and can be cancelled", async () => {
    render(<App bridge={createMockBridge("fresh")} />);
    fireEvent.click(await screen.findByRole("button", { name: "OpenAI (ChatGPT plan or API key)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use my ChatGPT plan" }));
    const notice = await screen.findByTestId("notice"); expect(notice.textContent).toContain("Using your ChatGPT plan");
    const cont = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement; expect(cont.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(cont);
    fireEvent.click(await screen.findByRole("button", { name: "Continue with ChatGPT" }));
    const link = await screen.findByTestId("signin-link", undefined, { timeout: 3000 }); expect(link.textContent).toMatch(/^https:\/\/auth\.openai\.com\//);
    expect(screen.queryByTestId("signin-code")).toBeNull(); // no code to paste on this path
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("signin")).toBeNull());
  });
  it("when the plan is connected the screen says 'Using ChatGPT plan', links to Manage usage and offers Disconnect", async () => {
    render(<App bridge={createMockBridge("openai")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use my ChatGPT plan" })); // mock: choose the plan, tick, sign in
    fireEvent.click(await screen.findByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue with ChatGPT" }));
    await waitFor(() => expect(screen.getByTestId("status-line").textContent).toContain("Using ChatGPT plan"), { timeout: 9000 }); // connected: the app moves on to the New job form
    fireEvent.click(document.querySelector('nav button[aria-label="Settings"]')!);
    const box = await screen.findByTestId("plan-in-use");
    expect(box.textContent).toContain("Using ChatGPT plan"); expect(screen.getByRole("button", { name: "Manage usage" })).toBeTruthy(); expect(screen.getByRole("button", { name: "Use a different ChatGPT account" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));
    await waitFor(() => expect(screen.queryByTestId("plan-in-use")).toBeNull());
  }, 20000);
  it("switching service from a connected app asks first: staying changes nothing, switching re-words the screen", async () => {
    render(<App bridge={createMockBridge("connected")} />);
    await screen.findByTestId("new-job-form"); fireEvent.click(document.querySelector('nav button[aria-label="Settings"]')!);
    const openai = await screen.findByRole("button", { name: "OpenAI (ChatGPT plan or API key)" }); fireEvent.click(openai);
    const box = await screen.findByTestId("switch-confirm"); expect(box.textContent).toContain("Switch to OpenAI?"); expect(box.textContent).toContain("add the ad again as a new job");
    fireEvent.click(screen.getByRole("button", { name: "Stay with Claude" })); await waitFor(() => expect(screen.queryByTestId("switch-confirm")).toBeNull());
    const choice = () => screen.getByTestId("provider-choice").querySelectorAll("button");
    expect(choice()[0].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(choice()[1]); fireEvent.click(await screen.findByRole("button", { name: "Switch to OpenAI" }));
    await waitFor(() => expect(choice()[1].getAttribute("aria-pressed")).toBe("true"));
  });
  it("the screens' own privacy wording names the chosen service: nothing says text goes to Claude when OpenAI is chosen, and Claude wording is unchanged otherwise", () => {
    setService("claude"); const c = JSON.stringify(ONBOARDING);
    setService("openai"); const o = JSON.stringify(ONBOARDING);
    expect(c).toContain("Claude"); expect(o).not.toContain("Claude"); expect(o).toContain("OpenAI");
    expect(branded({ a: "Claude reads it", b: ["Claude"], c: (n: number) => `Claude ${n}` }).c(2)).toBe("OpenAI 2");
    setService("claude"); expect(branded({ a: "Claude reads it" }).a).toBe("Claude reads it");
  });
});
