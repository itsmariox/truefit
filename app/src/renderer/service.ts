// Which AI service the screens talk about. The screens' own wording (privacy lines, "Connect ...", status line) names the service the user chose, so it is never wrong about where their
// text goes: when OpenAI is chosen, "Claude" in any of the page's message tables reads "OpenAI". The name is set from the access view (Shell and Connect); the tables read it when a
// screen is drawn. The approved Claude catalogue is separate (the main process words access messages itself) and is not touched here.
export type Service = "claude" | "openai";
let current: Service = "claude";
export const setService = (p: Service | undefined | null) => { current = p === "openai" ? "openai" : "claude"; };
export const service = (): Service => current;
export const serviceName = () => (current === "openai" ? "OpenAI" : "Claude");
const brand = (s: string) => (current === "claude" ? s : s.replace(/\bClaude\b/g, "OpenAI"));

// Wraps a message table so that every string read from it (and every string a function in it returns) is worded for the chosen service. Same shape, same types, no call site changes.
export function branded<T>(table: T): T {
  const wrap = (v: unknown): unknown => {
    if (typeof v === "string") return brand(v);
    if (typeof v === "function") return new Proxy(v as (...a: unknown[]) => unknown, { apply: (fn, self, args) => wrap(Reflect.apply(fn, self, args)) });
    // Only plain tables and lists are wrapped. A React element (frozen, with a read-only `props`) or any other frozen object is returned as it is: a proxy may not lie about those.
    if (v && typeof v === "object" && !("$$typeof" in v) && !Object.isFrozen(v)) return new Proxy(v as object, { get: (t, k, r) => wrap(Reflect.get(t, k, r)) });
    return v;
  };
  return wrap(table) as T;
}
