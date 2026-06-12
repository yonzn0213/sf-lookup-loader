export type Operation = "insert" | "update" | "upsert";
export interface LookupSpec { object: string; key: string; }
export interface LookupMapping { field: string; lookup: LookupSpec; }
export type Mapping = string | LookupMapping;
export interface Job {
  object: string;
  targetOrg: string;
  operation: Operation;
  externalIdField?: string;
  mappings: Record<string, Mapping>;
  onLookupMiss: "error" | "blank";
}
export interface ParsedMappings {
  simple: Record<string, string>;
  lookups: Array<{ src: string; field: string; object: string; key: string }>;
}
export interface IdMap { map: Map<string, string>; duplicates: Set<string>; }
export interface RowError { row: number; field: string; key: string; reason: string; }
