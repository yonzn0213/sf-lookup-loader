import type { Mapping, ParsedMappings } from "./types.js";

export function parseMappings(mappings: Record<string, Mapping>): ParsedMappings {
  const simple: Record<string, string> = {};
  const lookups: ParsedMappings["lookups"] = [];
  for (const [src, m] of Object.entries(mappings)) {
    if (typeof m === "string") simple[src] = m;
    else lookups.push({ src, field: m.field, object: m.lookup.object, key: m.lookup.key });
  }
  return { simple, lookups };
}

export function applySimple(
  row: Record<string, string>,
  simple: Record<string, string>,
  skipEmpty = false,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [src, target] of Object.entries(simple)) {
    if (!(src in row)) continue;
    const val = row[src];
    if (skipEmpty && val.trim() === "") continue; // 빈 값 제외(기존 값 보존)
    out[target] = val;
  }
  return out;
}
