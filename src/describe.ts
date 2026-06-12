import type { Connection } from "jsforce";

export interface FieldInfo { name: string; label: string; }

export function suggestMappings(headers: string[], fields: FieldInfo[]): Record<string, string> {
  const byLabel = new Map(fields.map((f) => [f.label, f.name]));
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f.name]));
  const out: Record<string, string> = {};
  for (const h of headers) {
    out[h] = byLabel.get(h) ?? byName.get(h.toLowerCase()) ?? "";
  }
  return out;
}

export async function describeFields(conn: Connection, object: string): Promise<FieldInfo[]> {
  const meta: any = await (conn as any).describe(object);
  return meta.fields.map((f: any) => ({ name: f.name, label: f.label }));
}
