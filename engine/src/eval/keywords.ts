// Keyword coverage for the step 8 eval: how many of an ad's keywords a CV's text contains. Pure code, no Claude. Used to compare a reworded CV with a choose-and-order CV of the same job.
import { namedTerms } from "../cv/reword.ts";

const STOP = new Set(("a an and are as at be by for from has have in is it its of on or our that the their this to we will with you your who they them can able about across all also any more most new other over per such than then these those through up us use used using very well what when where which while work working within would should must may including include etc role team experience strong skills ability years year join looking candidate company business great good high").split(" "));

export type AdKeywords = { named: string[]; words: string[] };

// Named terms (tools, acronyms) plus content words that the ad repeats at least twice (what the ad stresses).
export function adKeywords(ad: string, skills: string[] = []): AdKeywords {
  const named = namedTerms(ad, skills);
  const counts = new Map<string, number>();
  for (const w of ad.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const words = [...counts].filter(([w, n]) => n >= 2 && !named.includes(w)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
  return { named, words };
}

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
export type Coverage = { namedHit: string[]; wordsHit: string[]; total: number; hit: number; percent: number };

export function coverage(cvText: string, kw: AdKeywords): Coverage {
  const low = cvText.toLowerCase(), tokens = new Set((low.match(/[a-z][a-z-]*/g) ?? []).map(stem));
  const namedHit = kw.named.filter((t) => low.includes(t)), wordsHit = kw.words.filter((w) => tokens.has(stem(w)));
  const total = kw.named.length + kw.words.length, hit = namedHit.length + wordsHit.length;
  return { namedHit, wordsHit, total, hit, percent: total ? Math.round((hit / total) * 100) : 0 };
}

// What rewording added: keywords found in the reworded CV but not in the choose-and-order CV of the same job (and the reverse).
export function gain(base: Coverage, reworded: Coverage) {
  const b = new Set([...base.namedHit, ...base.wordsHit]), r = new Set([...reworded.namedHit, ...reworded.wordsHit]);
  return { added: [...r].filter((k) => !b.has(k)), lost: [...b].filter((k) => !r.has(k)), points: reworded.percent - base.percent };
}
