import type { Connection } from "jsforce";

export interface FieldInfo {
  name: string;
  label: string;
  type: string;
  referenceTo: string[];
  createable: boolean;
  updateable: boolean;
  nillable: boolean;
  defaultedOnCreate: boolean;
  externalId: boolean;
  idLookup: boolean;
}

export interface ObjectInfo { name: string; label: string; }

export function toFieldInfo(f: any): FieldInfo {
  return {
    name: f.name,
    label: f.label ?? f.name,
    type: f.type ?? "",
    referenceTo: Array.isArray(f.referenceTo) ? f.referenceTo.filter(Boolean) : [],
    createable: !!f.createable,
    updateable: !!f.updateable,
    nillable: !!f.nillable,
    defaultedOnCreate: !!f.defaultedOnCreate,
    externalId: !!f.externalId,
    idLookup: !!f.idLookup,
  };
}

export async function describeFields(conn: Connection, object: string): Promise<FieldInfo[]> {
  const meta: any = await (conn as any).describe(object);
  return (meta.fields as any[]).map(toFieldInfo);
}

export async function listObjects(conn: Connection): Promise<ObjectInfo[]> {
  const g: any = await (conn as any).describeGlobal();
  return (g.sobjects as any[])
    .filter((o) => o.queryable)
    .map((o) => ({ name: o.name, label: o.label ?? o.name }));
}

// 헤더를 라벨/이름으로 자동 매칭(기본 제안용). 못 찾으면 빈 문자열.
export function suggestMappings(headers: string[], fields: { name: string; label: string }[]): Record<string, string> {
  const byLabel = new Map(fields.map((f) => [f.label, f.name]));
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f.name]));
  const out: Record<string, string> = {};
  for (const h of headers) out[h] = byLabel.get(h) ?? byName.get(h.toLowerCase()) ?? "";
  return out;
}
