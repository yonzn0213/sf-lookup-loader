import type { Job, Mapping } from "./types.js";
import type { FieldInfo } from "./describe.js";

export interface MappingChoice {
  header: string;
  kind: "field" | "lookup" | "skip";
  field?: string;
  lookup?: { object: string; key: string };
}

export function requiredFieldsMissing(fields: FieldInfo[], mapped: string[]): FieldInfo[] {
  const set = new Set(mapped);
  return fields.filter(
    (f) => f.createable && !f.nillable && !f.defaultedOnCreate && !set.has(f.name),
  );
}

export function keyFieldRisk(field: FieldInfo): boolean {
  return !(field.externalId || field.idLookup);
}

export function mappedApiNames(choices: MappingChoice[]): string[] {
  return choices.filter((c) => c.kind !== "skip" && c.field).map((c) => c.field!);
}

export function summaryRows(choices: MappingChoice[]): Array<{ header: string; target: string }> {
  return choices.map((c) => ({
    header: c.header,
    target:
      c.kind === "skip" ? "(건너뜀)"
        : c.kind === "field" ? c.field!
          : `${c.field} ← ${c.lookup!.object}.${c.lookup!.key}`,
  }));
}

export function buildJob(params: {
  object: string;
  targetOrg: string;
  operation: Job["operation"];
  externalIdField?: string;
  onLookupMiss: Job["onLookupMiss"];
  skipEmptyFields: boolean;
  choices: MappingChoice[];
}): Job {
  const mappings: Record<string, Mapping> = {};
  for (const c of params.choices) {
    if (c.kind === "skip") continue;
    mappings[c.header] = c.kind === "field" ? c.field! : { field: c.field!, lookup: c.lookup! };
  }
  const job: Job = {
    object: params.object,
    targetOrg: params.targetOrg,
    operation: params.operation,
    onLookupMiss: params.onLookupMiss,
    skipEmptyFields: params.skipEmptyFields,
    mappings,
  };
  if (params.operation === "upsert") job.externalIdField = params.externalIdField;
  return job;
}
