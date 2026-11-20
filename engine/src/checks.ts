// Checks done by plain code. The models propose; this file verifies. No AI here, so a job ad cannot talk it round.

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[*`\\]/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

// Every evidence quote a model gives must really appear in the persona text.
export function quoteExists(personaText: string, quote: string): boolean {
  const q = normalise(quote).replace(/^[\s'".…-]+|[\s'".…-]+$/g, "");
  if (q.length < 6) return false;
  const hay = normalise(personaText);
  if (hay.includes(q)) return true;
  // Near-exact: at least 75% of the quote's 2-word runs appear in the persona (an added or changed word, or "...",
  // is tolerated; a made-up sentence is not). Needs at least 5 words.
  const w = q.split(" ");
  if (w.length < 5) return false;
  const runs = w.slice(0, -1).map((_, i) => `${w[i]} ${w[i + 1]}`);
  return runs.filter((r) => hay.includes(r)).length / runs.length >= 0.75;
}

// Phrases that suggest an ad is trying to instruct the AI reading it. Independent of the model.
const INJECTION_PATTERNS: [string, RegExp][] = [
  ["ignore-instructions", /ignore (all |any |your |the )?(previous|prior|above|earlier) (instructions|rules|prompts?)/i],
  ["disregard", /disregard (all |any |your |the )?(previous|prior|above|earlier|system)/i],
  ["ignore-rules", /\bignore (any|all|every|the|these|those)\s+(rules?|instructions?|guidelines?|constraints?)\b/i],
  ["addressed-to-ai", /\b(notes?|messages?|instructions?|attention)\s+(to|for)\s+(automated|ai|llm|language model|screening|ats|cv|resume)\b/i],
  ["forced-claims", /\bmust be described as\b|\bdescribe the candidate as\b|\bstate (in the summary )?that the candidate\b/i],
  ["system-prompt", /system prompt|developer message|you are (now )?an? (ai|assistant|language model)/i],
  ["demands-verdict", /(output|return|set|give)[^.\n]{0,40}(verdict|score|fit)[^.\n]{0,30}(apply|\d{2,3} ?%)/i],
  ["tool-bait", /\b(read|open|cat|fetch|curl|visit)\b[^.\n]{0,40}(\.ssh|\/etc\/|api[_ -]?key|token|password)/i],
  ["hidden-markup", /<!--[\s\S]*?-->|<\s*(script|style)\b/i],
];
export const scanForInjection = (text: string): string[] => INJECTION_PATTERNS.filter(([, re]) => re.test(text)).map(([n]) => n);

// Any of our own prompt tags inside outside text is neutralised, so it cannot close a block early. Length capped.
export const OUR_TAGS = ["job_ad", "persona", "profile", "limits", "tone", "rewrites", "file", "analysis", "selection", "checker_problems", "cv_text", "team_results", "stories", "skill", "instructions", "approved_template_wording", "summary_to_check", "text_to_check"];
export function sanitise(text: string, maxChars: number): { text: string; truncated: boolean; removedTags: number } {
  let removedTags = 0;
  const re = new RegExp(`<\\s*\\/?\\s*(${OUR_TAGS.join("|")})\\b[^>]*>`, "gi");
  const cleaned = text.replace(re, () => { removedTags++; return "[tag removed]"; }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠﻿]/g, "");
  return { text: cleaned.slice(0, maxChars), truncated: cleaned.length > maxChars, removedTags };
}

// One line of plain text: no control characters, no zero-width tricks, capped.
export const oneLine = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// A token never reaches a log or a message.
export function redact(text: unknown, max = 400): string {
  let s = String(text ?? "");
  for (const v of [process.env.CLAUDE_CODE_OAUTH_TOKEN, process.env.TELEGRAM_BOT_TOKEN]) if (v) s = s.split(v).join("[redacted]");
  return s.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]").replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/Bearer\s+[A-Za-z0-9._~+\/=-]{12,}/gi, "Bearer [redacted]").replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]").replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, "[redacted]").slice(0, max);
}

// Recognises the failures that mean "stop and tell the user" rather than "try the next step".
export function classifyError(message: string): "auth" | "rate_limit" | "other" {
  if (/invalid bearer token|authentication_failed|failed to authenticate|login expired|please run \/login|\b401\b|oauth.*(expired|invalid|revoked)/i.test(message)) return "auth";
  if (/rate.?limit|usage limit|too many requests|\b429\b|overloaded|limit reached|quota/i.test(message)) return "rate_limit";
  return "other";
}
