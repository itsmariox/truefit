// Fit-to-one-page loop and the one-call "make a CV" helper (phase 1 step 5). Renders, reads the page count in process, and while the CV runs over,
// drops the LEAST relevant item (the Writer orders every list most relevant first): bullets first (from the role with the most spare bullets,
// oldest role on a tie), then skills, and only in "shorter version" mode (the user pressed the button, PRD 10) below the normal floors.
// It never edits any text: it only removes verified bullets or skills, so everything left is still exactly what was checked.
import type { Profile } from "../profile.ts";
import { profileToPersona } from "../profile.ts";
import { atsCheck, expectationsFor, readPdf } from "./ats.ts";
import type { AtsReport } from "./ats.ts";
import { renderCvHtml } from "./html.ts";
import type { Accent, FontUrls } from "./html.ts";
import type { PdfRenderer } from "./render.ts";
import { pruneRewrites, selectionBudget } from "./selection.ts";
import type { CvSelection } from "./selection.ts";

export type FitResult = { ok: boolean; selection: CvSelection; pdf: Buffer; pages: number; droppedBullets: string[]; droppedSkills: string[]; renders: number; reason?: string };
export type FitOptions = { renderer: PdfRenderer; fonts: FontUrls; accent?: Accent; showRightToWork?: boolean; shorter?: boolean; maxRenders?: number };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export async function fitToOnePage(profile: Profile, selection: CvSelection, o: FitOptions): Promise<FitResult> {
  const persona = profileToPersona(profile);
  const budget = selectionBudget(persona, selection.focus_id);
  let sel = clone(selection);
  const droppedBullets: string[] = [], droppedSkills: string[] = [];
  const maxRenders = o.maxRenders ?? 40;
  const floorOf = (role: string) => o.shorter ? 1 : budget.roles.find((r) => r.id === role)?.min ?? 1;
  const skillFloor = o.shorter ? 0 : budget.skills.min;
  let renders = 0, pdf: Buffer = Buffer.alloc(0), pages = 0;
  for (;;) {
    pdf = await o.renderer.renderPdf(renderCvHtml(profile, sel, { fonts: o.fonts, accent: o.accent, showRightToWork: o.showRightToWork }));
    renders++;
    pages = (await readPdf(pdf)).pages;
    if (pages <= 1) return { ok: true, selection: pruneRewrites(sel), pdf, pages, droppedBullets, droppedSkills, renders };
    if (renders >= maxRenders) return { ok: false, selection: pruneRewrites(sel), pdf, pages, droppedBullets, droppedSkills, renders, reason: "too many attempts to fit the CV on one page" };
    // choose what to drop
    const order = sel.roles.map((r, i) => ({ i, spare: r.bullets.length - floorOf(r.role) })).filter((x) => x.spare > 0).sort((a, b) => b.spare - a.spare || b.i - a.i);
    if (order.length) { droppedBullets.push(sel.roles[order[0].i].bullets.pop()!); continue; }
    if (sel.skills.length > skillFloor) { droppedSkills.push(sel.skills.pop()!); continue; }
    if (o.shorter && sel.achievements.length > 0) { droppedBullets.push(sel.achievements.pop()!.id); continue; }
    return { ok: false, selection: pruneRewrites(sel), pdf, pages, droppedBullets, droppedSkills, renders, reason: o.shorter ? "the CV does not fit one page even with one bullet per role" : "the CV does not fit one page at the normal minimums" };
  }
}

export type MadeCv = { fit: FitResult; report: AtsReport; text: string }; // text: what the PDF reads as (for the Checker)
// Fit, then run every ATS check on the final PDF. `allowMultiPage` is the user's explicit "deliver anyway": the fit loop is skipped and the
// full selection is delivered as it is (2 pages at most); every other check still applies.
export async function makeCv(profile: Profile, selection: CvSelection, o: FitOptions & { allowMultiPage?: boolean }): Promise<MadeCv> {
  let fit: FitResult;
  if (o.allowMultiPage) {
    const pdf = await o.renderer.renderPdf(renderCvHtml(profile, selection, { fonts: o.fonts, accent: o.accent, showRightToWork: o.showRightToWork }));
    fit = { ok: true, selection, pdf, pages: (await readPdf(pdf)).pages, droppedBullets: [], droppedSkills: [], renders: 1 };
  } else fit = await fitToOnePage(profile, selection, o);
  const parsed = await readPdf(fit.pdf);
  const report = atsCheck(parsed, expectationsFor(profile, fit.selection, { allowMultiPage: o.allowMultiPage, showRightToWork: o.showRightToWork }));
  return { fit, report, text: parsed.text };
}
