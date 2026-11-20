// Phase 9: an automated accessibility check (axe-core) of every main screen in the simulated browser. Colour contrast cannot be computed there (it is checked from the design tokens in tokens.test.ts),
// so that one rule is switched off here; everything else axe knows (names, roles, labels, landmarks, duplicate ids, ARIA use) must pass.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { App } from "../src/renderer/App.tsx";
import { createMockBridge } from "../src/renderer/preview/mock-bridge.ts";

afterEach(cleanup);
async function violations() { const r = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } }); return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`); }
const go = async (name: string) => fireEvent.click(await screen.findByRole("button", { name }));


describe("accessibility (axe)", () => {
  it("first-run guide, every step", async () => {
    render(<App bridge={createMockBridge("onboarding")} />); await screen.findByTestId("onboarding"); expect(await violations()).toEqual([]);
    fireEvent.click(screen.getByTestId("ob-next")); expect(await violations()).toEqual([]); fireEvent.click(screen.getByTestId("ob-next")); await screen.findByTestId("connect"); expect(await violations()).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: "Use an API key" })); fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "sk-ant-api03-fakekeyfakekeyfake" } }); fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    await screen.findByTestId("ob-connected", undefined, { timeout: 4000 }); fireEvent.click(screen.getByTestId("ob-next")); await screen.findByTestId("ob-cv"); expect(await violations()).toEqual([]);
  });
  it("Connect screen, notice, key form", async () => {
    render(<App bridge={createMockBridge("fresh")} />); await screen.findByTestId("connect"); expect(await violations()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Use my Claude subscription" })); await screen.findByTestId("notice"); expect(await violations()).toEqual([]);
  });
  it("Connect screen with OpenAI chosen: the service choice and the ChatGPT-plan notice", async () => {
    render(<App bridge={createMockBridge("fresh")} />); fireEvent.click(await screen.findByRole("button", { name: "OpenAI (ChatGPT plan or API key)" }));
    await screen.findByRole("button", { name: "Use my ChatGPT plan" }); expect(await violations()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Use my ChatGPT plan" })); await screen.findByTestId("notice"); expect(await violations()).toEqual([]);
  });
  it("OpenAI API key form", async () => {
    render(<App bridge={createMockBridge("fresh")} />); fireEvent.click(await screen.findByRole("button", { name: "OpenAI (ChatGPT plan or API key)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use an OpenAI API key" })); await screen.findByTestId("key-form"); expect(await violations()).toEqual([]);
  });
  it("API key form", async () => {
    render(<App bridge={createMockBridge("fresh")} />); fireEvent.click(await screen.findByRole("button", { name: "Use an API key" })); await screen.findByTestId("key-form"); expect(await violations()).toEqual([]);
  });
  it("New job, a job's verdict, History, Settings", async () => {
    render(<App bridge={createMockBridge("jobs")} />); await screen.findByTestId("new-job-form"); expect(await violations()).toEqual([]);
    fireEvent.click(await within(await screen.findByRole("complementary", { name: "Jobs" })).findByRole("button", { name: /Brightwell/ })); await screen.findByTestId("verdict"); expect(await violations()).toEqual([]);
    await go("History"); await screen.findByTestId("history"); await waitFor(() => expect(screen.getAllByTestId("history-row").length).toBeGreaterThan(0)); expect(await violations()).toEqual([]);
    await go("Settings"); await screen.findByTestId("settings"); await screen.findByLabelText("Bot token"); expect(await violations()).toEqual([]);
  });
  it("My profile: the whole page, with the import open", async () => {
    render(<App bridge={createMockBridge("jobs")} />); await go("My profile"); await screen.findByTestId("profile");
    await screen.findAllByTestId("review-card"); expect(await violations()).toEqual([]); for (const n of ["Add a language", "Add a certificate", "Add a project"]) fireEvent.click(screen.getByRole("button", { name: n })); expect(await violations()).toEqual([]); fireEvent.click(await screen.findByTestId("import-open")); await screen.findByTestId("import-cv"); expect(await violations()).toEqual([]);
  });
  it("start-up problem screens", async () => {
    for (const s of ["damaged", "too-new", "upgrade-failed", "failed"]) { const { unmount } = render(<App bridge={createMockBridge(s)} />); await screen.findByTestId("startup-problem"); expect(await violations()).toEqual([]); unmount(); }
  });
});
