import type { ParsedMappings, IdMap, RowError } from "./types.js";

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function soqlEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function buildIdMap(records: Array<Record<string, any>>, keyField: string): IdMap {
  const map = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const rec of records) {
    const k = String(rec[keyField]);
    if (map.has(k)) duplicates.add(k);
    else map.set(k, rec.Id);
  }
  for (const d of duplicates) map.delete(d);
  return { map, duplicates };
}

export function resolveRow(
  row: Record<string, string>,
  lookups: ParsedMappings["lookups"],
  idMaps: Record<string, IdMap>,
  onMiss: "error" | "blank",
  rowNum: number,
): { fields: Record<string, string>; errors: RowError[] } {
  const fields: Record<string, string> = {};
  const errors: RowError[] = [];
  for (const lk of lookups) {
    const key = row[lk.src] ?? "";
    const idm = idMaps[lk.field];
    if (idm.duplicates.has(key)) {
      errors.push({ row: rowNum, field: lk.field, key, reason: "중복 key" });
      continue;
    }
    const id = idm.map.get(key);
    if (id) {
      fields[lk.field] = id;
    } else {
      errors.push({ row: rowNum, field: lk.field, key, reason: "미매칭" });
      if (onMiss === "blank") fields[lk.field] = "";
    }
  }
  return { fields, errors };
}

export async function queryKeys(
  conn: { query: (soql: string) => Promise<{ records: Array<Record<string, any>> }> },
  object: string, keyField: string, keys: string[], chunkSize = 500,
): Promise<Array<Record<string, any>>> {
  const out: Array<Record<string, any>> = [];
  for (const part of chunk([...new Set(keys)], chunkSize)) {
    const inList = part.map((k) => `'${soqlEscape(k)}'`).join(",");
    const soql = `SELECT Id, ${keyField} FROM ${object} WHERE ${keyField} IN (${inList})`;
    const res = await conn.query(soql);
    out.push(...res.records);
  }
  return out;
}
