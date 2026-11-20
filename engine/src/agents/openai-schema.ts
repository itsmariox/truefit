// OpenAI Structured Outputs in strict mode accepts only a subset of JSON Schema (https://developers.openai.com/api/docs/guides/structured-outputs, read 2026-11-19): the root is an
// object (not anyOf), every property is listed in `required`, every object has `additionalProperties:false`, at most 5,000 properties and 10 levels, and no allOf/not/if/then/else
// and so on. This checks one of OUR schemas against those rules and returns the problems (empty = acceptable), so a schema that would be refused is caught offline.
const BANNED = ["allOf", "not", "dependentRequired", "dependentSchemas", "if", "then", "else", "patternProperties"];
export function strictSchemaProblems(schema: unknown): string[] {
  const out: string[] = []; let props = 0;
  const walk = (s: any, at: string, depth: number) => {
    if (!s || typeof s !== "object") return;
    if (depth > 10) out.push(`${at}: nested deeper than 10 levels`);
    for (const k of BANNED) if (k in s) out.push(`${at}: "${k}" is not supported`);
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (types.includes("object") || s.properties) {
      const keys = Object.keys(s.properties ?? {}); props += keys.length;
      if (s.additionalProperties !== false) out.push(`${at}: additionalProperties must be false`);
      const req = new Set<string>(s.required ?? []); for (const k of keys) if (!req.has(k)) out.push(`${at}.${k}: not in required`);
      for (const k of keys) walk(s.properties[k], `${at}.${k}`, depth + 1);
    }
    if (types.includes("array") && s.items) walk(s.items, `${at}[]`, depth + 1);
    for (const k of ["anyOf"]) if (Array.isArray(s[k])) s[k].forEach((x: unknown, i: number) => walk(x, `${at}.${k}[${i}]`, depth + 1));
  };
  const root = schema as any;
  if (!root || root.type !== "object") out.push("root: must be an object");
  if (root?.anyOf) out.push("root: must not be anyOf");
  walk(root, "root", 1);
  if (props > 5000) out.push(`more than 5,000 properties (${props})`);
  return out;
}
