// The shapes the engine reads a persona in, and the small text helpers around them (contact masking, number tokens, markdown pieces for the importer). No AI.
// Contact details are removed before ANY text goes to a model: the CV header gets them from the template.


export type Employer = string; // a role id (was a fixed union of three employer names; made generic in phase 1 step 2)
export type Bullet = { id: string; tags: string[]; text: string; status: string; employer: Employer; ventureOnly: boolean };
export type Archetype = { id: number; name: string; headline: string; tags: string[] };
export type Skills = { allowed: string[]; removed: string[]; unverified: string[]; knownGaps: string[] };
export type Persona = {
  text: string;                       // what models see (contact lines removed), as <file> blocks
  hash: string;
  files: Record<string, string>;      // raw file contents (code only)
  bullets: Bullet[]; skills: Skills; archetypes: Archetype[]; numbers: Set<string>;
};

// Phone numbers: "+" international form, UK-style local numbers with spaces or dashes ("07700 900123", "0113 496 0000"), or 10+ digit runs.
// Date ranges like "2021 - 2022" and money like "$500K" are not matched. (Fixed 2026-11-16: UK local numbers with spaces used to pass through.)
export const PHONE = /\+\d[\d ()-]{7,}\d|\b0\d{3,4}[ -]?\d{3}[ -]?\d{3,4}\b|\b0\d{2}[ -]?\d{4}[ -]?\d{4}\b|\b\d{10,}\b/g;
const PHONE_TEST = new RegExp(PHONE.source);

// Lines with an email address, a LinkedIn link or a phone number never reach a model.
export function minimise(markdown: string): string {
  return markdown.split("\n").filter((l) => !/@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(l) && !/linkedin\.com/i.test(l) && !PHONE_TEST.test(l)).join("\n");
}

// Masks contact details inside a line (for text that must keep the rest of the line, like the CV's header).
export const maskContacts = (s: string) => s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]").replace(/(https?:\/\/)?(www\.)?linkedin\.com\/[^\s|]*/gi, "[linkedin]").replace(PHONE, "[phone]");

export const unescapeMd = (s: string) => s.replace(/\\([$*_#&%])/g, "$1");
export const BULLET_LINE = /^- \[([A-Za-z0-9_]+)\] \[([^\]]+)\] (.+) \[(confirmed|cv|unverified|retired)\](?: \(.*\))?$/;

const splitList = (s: string, seps: RegExp) => s.replace(/\*\*/g, "").replace(/\.\s*$/, "").split(seps).map((x) => x.trim()).filter(Boolean);
export function parseSkills(factsMd: string): Skills {
  const line = (re: RegExp) => (factsMd.match(re) ?? [])[1]?.trim();
  const allowed = line(/^Confirmed\/on CV:\s*(.+)$/m);
  if (!allowed) throw new Error('the facts file has no "Confirmed/on CV:" skills line');
  const gapsBlock = (factsMd.match(/^## Known gaps[^\n]*\n+([\s\S]*?)(?=\n## |\s*$)/m) ?? [])[1] ?? "";
  return {
    allowed: splitList(allowed, /[;,]/),
    removed: splitList(line(/^\*\*Removed \(do not list\):\*\*\s*(.+)$/m) ?? "", /[,]/),
    unverified: splitList(line(/^Unverified \(ask before use\):\s*(.+)$/m) ?? "", /[,]/),
    knownGaps: splitList(gapsBlock.trim(), /[,/]/),
  };
}

export function parseArchetypes(md: string): Archetype[] {
  const out: Archetype[] = [];
  for (const line of md.split("\n")) {
    const c = line.split("|").map((x) => x.trim());
    if (c.length >= 5 && /^\d+$/.test(c[1])) out.push({ id: Number(c[1]), name: c[2], headline: c[3], tags: c[4].split(",").map((t) => t.trim()).filter(Boolean) });
  }
  return out;
}

export const numberTokens = (s: string): string[] => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => t.replace(/,/g, "").replace(/\.$/, ""));
