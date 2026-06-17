import type { ParsedMappings, IdMap, RowError } from "./types.js";

// SOQL IN 비교에 안전한 key 필드 타입(텍스트형·숫자형·날짜·id). textarea/base64/encrypted 등 제외.
export const COMPARABLE_KEY_TYPES = new Set([
  "string", "email", "phone", "url", "picklist", "double", "int",
  "currency", "percent", "date", "datetime", "id",
]);

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 개수(maxCount)와 SOQL IN 절 문자수(maxChars) 둘 다 만족하도록 분할.
// 긴 key가 많아도 SOQL이 Salesforce 길이 제한을 넘지 않게 한다.
export function chunkByBudget(values: string[], maxCount: number, maxChars: number): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let curChars = 0;
  for (const v of values) {
    const cost = v.length + 4; // 'v', 따옴표·콤마 여유
    if (cur.length > 0 && (cur.length >= maxCount || curChars + cost > maxChars)) {
      out.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(v);
    curChars += cost;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export function soqlEscape(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\f/g, "\\f")
    .replace(/[\b]/g, "\\b");
}

// lookup key 매칭용 정규화: 앞뒤 공백 무시 + 대소문자 무시 (중간 공백은 보존)
export function normalizeKey(v: string): string {
  return v.trim().toLowerCase();
}

export function buildIdMap(records: Array<Record<string, any>>, keyField: string): IdMap {
  const map = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const rec of records) {
    const k = normalizeKey(String(rec[keyField] ?? ""));
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
    const raw = (row[lk.src] ?? "").trim();
    if (raw === "") continue; // 빈 lookup 값은 관계 없음으로 간주 — 에러 아님, 필드 미설정
    const nkey = normalizeKey(raw);
    const idm = idMaps[lk.field];
    if (idm.duplicates.has(nkey)) {
      errors.push({ row: rowNum, field: lk.field, key: raw, reason: "중복 key" });
      continue;
    }
    const id = idm.map.get(nkey);
    if (id) {
      fields[lk.field] = id;
    } else {
      errors.push({ row: rowNum, field: lk.field, key: raw, reason: "미매칭" });
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
  // 정규화 기준 중복 제거(앞뒤 공백·대소문자 무시). 조회는 trim된 대표값으로.
  const uniq = [...new Map(keys.map((k) => [normalizeKey(k), k.trim()])).values()].filter((k) => k !== "");
  // 개수(chunkSize) + SOQL IN 문자수(안전마진) 둘 다로 분할 → 긴 key에도 SOQL 길이 초과 방지.
  for (const part of chunkByBudget(uniq, chunkSize, 3800)) {
    const inList = part.map((k) => `'${soqlEscape(k)}'`).join(",");
    const soql = `SELECT Id, ${keyField} FROM ${object} WHERE ${keyField} IN (${inList})`;
    const res = await conn.query(soql);
    out.push(...res.records);
  }
  return out;
}
