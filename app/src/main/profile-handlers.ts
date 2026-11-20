// The profile handlers (phase 5). The page sends the WHOLE profile; the engine's own validator and start gate run here (never trusted from the page); problems are turned into
// plain sentences (ids replaced by the role's name). Identity and contact details stay on this side of nothing: they are the user's own, shown only to the user.
import type { Handlers } from "./ipc.ts";
import type { Host } from "./core/host.ts";
import type { ProfileView } from "../shared/contract.ts";
import { readCvSource } from "../../../engine/src/cv-source.ts";
import { toUi } from "./handlers.ts";
import { meetsStartGate, type Profile } from "../../../engine/src/profile.ts";

export function plainProblems(p: Profile, errors: string[]): string[] {
  const roles = new Map((p.roles ?? []).map((r) => [r.id, `${r.title || "a role"} at ${r.company || "a company"}`]));
  const bullets = new Map((p.roles ?? []).flatMap((r) => (r.bullets ?? []).map((b) => [b.id, `a bullet of ${r.title || "a role"} at ${r.company || "a company"}`] as const)));
  return errors.map((e) => e
    .replace(/^role ([^:]+):/, (_m, id) => `${roles.get(id) ?? "A role"}:`).replace(/^bullet (\S+) /, (_m, id) => `${bullets.get(id) ?? "A bullet"} `)
    .replace(/^schemaVersion is .*/, "This profile was made by a different version of the app.").replace(/identity\.name is empty/, "Your name is empty")
    .replace(/ contains an email, phone number or LinkedIn link; contact details belong in identity only/, " contains an email address, phone number or LinkedIn link. Contact details belong in the Hard facts section only.")
    .replace(/^(language|certification|project) \S+ has no name$/, (_m, k) => `A ${k === "certification" ? "certificate" : k} has no name.`).replace(/^project \S+ needs a description of up to 400 characters$/, "A project needs a short description (up to 400 characters).")
    .replace(/^language \S+ has level .*/, "Pick a level for each language.").replace(/^certification \S+ has a year outside .*/, "A certificate year must be between 1950 and 2100.")
    .replace(/^(language|certification|project) (\S+) (contains an email)/, (_m, k, _id, rest) => `A ${k === "certification" ? "certificate" : k} ${rest}`).replace(/^(language|certification|project) id .* is missing or repeated$/, "Something in your languages, certificates or projects is listed twice. Remove the repeat.").replace(/^extras has more than 30 (\w+)$/, "You can keep up to 30 of each: languages, certificates and projects."));
}

export function createProfileHandlers(d: { host: Host; chooseCvFile?: () => Promise<string | null> }): Pick<Handlers, "profile:get" | "profile:save" | "profile:import" | "profile:importFile" | "profile:overview" | "profile:card"> {
  const core = () => { const c = d.host.core(); if (!c) throw new Error("not ready"); return c; };
  return {
    "profile:get": (): ProfileView => { const p = core().profile.get(); return p ? { status: "ok", profile: p as never, gate: meetsStartGate(p), updatedAt: core().profile.updatedAt() } : { status: "none", profile: null, gate: { ok: false, missing: ["your name and city", "your email and country", "one role with at least 3 verified bullets", "where you are and where you want to work", "your right to work"] }, updatedAt: null }; },
    "profile:overview": () => core().profile.overview(),
    "profile:card": ({ key, action }) => { const c = core(), r = c.profile.cardAction(key, action); return r.ok ? { ok: true, profile: r.profile as never, updatedAt: r.updatedAt, overview: c.profile.overview() } : r; },
    "profile:importFile": async () => {
      const f = await d.chooseCvFile?.(); if (!f) return { status: "cancelled" };
      const r = await readCvSource(f); return r.ok ? { status: "picked", text: r.text.slice(0, 200_000), kind: r.kind } : { status: "refused", reason: r.reason };
    },
    "profile:import": async ({ text }) => {
      const c = core(), r = await c.profile.importCv(text);
      if (r.ok) return { status: "ok", profile: r.profile as never, added: r.added, notFromCv: r.notFromCv, dropped: r.dropped, upgraded: r.upgraded, proposedName: r.proposedName, updatedAt: r.updatedAt };
      return { status: "refused", reason: r.reason, message: r.reason === "claude" ? toUi(c.access.describePause(r.kind ?? "other")) : null };
    },
    "profile:save": ({ profile, baseUpdatedAt }) => {
      const p = profile as unknown as Profile, cur = core().profile.updatedAt();
      if (baseUpdatedAt && cur && baseUpdatedAt !== cur) return { ok: false, errors: ["Your profile was changed somewhere else (for example by a CV import) after you opened it. Reload this page, then make your changes again."] };
      const r = core().profile.save(p);
      if (!r.ok) return { ok: false, errors: plainProblems(p, r.errors) };
      return { ok: true, warnings: r.warnings.filter((w) => !w.startsWith("not ready to build CVs yet")), gate: meetsStartGate(p), updatedAt: core().profile.updatedAt() ?? "" }; // the gate is shown separately
    },
  };
}
