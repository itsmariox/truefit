// What an OpenAI call costs, from token counts (the Responses API reports tokens, not dollars). Prices are per 1M tokens, from OpenAI's model pages as read on 2026-11-19
// (https://developers.openai.com/api/docs/models and the gpt-6.2-sol page). They change: this table is the ONE place to update, and an unknown model costs 0 and is reported as such.
// Where a page did not list a cached-input or cache-write price (Astra, Terra, Luna) the full input price is used, so the figure can only be too high, never too low.
export type Price = { in: number; cachedIn: number; cacheWrite: number; out: number };
const P = (i: number, o: number, cachedIn = i, cacheWrite = i): Price => ({ in: i, cachedIn, cacheWrite, out: o });
export const OPENAI_PRICES: Record<string, Price> = {
  "gpt-6.2-sol": P(2, 10, 0.1, 2.5),
  "gpt-6.2-astra": P(8, 40),
  "gpt-6.1-terra": P(1, 5),
  "gpt-6-luna": P(0.1, 0.5),
};
export const LONG_CONTEXT_TOKENS = 272_000; // above this many input tokens, input-side rates double and output is 1.5x (gpt-6.2-sol page)
export type TokenUse = { input: number; cachedInput?: number; cacheWrite?: number; output: number };

// Returns dollars, or null when the model is not in the table (the caller records 0 and the usage screen says the price is unknown).
export function openaiCostUsd(model: string, u: TokenUse): number | null {
  const p = OPENAI_PRICES[model]; if (!p) return null;
  const long = u.input > LONG_CONTEXT_TOKENS, inMul = long ? 2 : 1, outMul = long ? 1.5 : 1;
  const cached = Math.min(u.cachedInput ?? 0, u.input), write = Math.min(u.cacheWrite ?? 0, u.input - cached), fresh = Math.max(0, u.input - cached - write);
  const usd = (fresh * p.in * inMul + cached * p.cachedIn * inMul + write * p.cacheWrite * inMul + u.output * p.out * outMul) / 1e6;
  return Math.round(usd * 1e8) / 1e8;
}
