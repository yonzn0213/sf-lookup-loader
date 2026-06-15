import { readFileSync } from "node:fs";
import type { Job, Operation } from "./types.js";

const OPERATIONS: Operation[] = ["insert", "update", "upsert"];

export function validateJob(raw: any): Job {
  if (!raw || typeof raw !== "object") throw new Error("job 설정이 객체가 아닙니다.");
  if (!raw.object || typeof raw.object !== "string") throw new Error("object가 필요합니다.");
  if (!raw.targetOrg || typeof raw.targetOrg !== "string") throw new Error("targetOrg(별칭)가 필요합니다.");
  if (!OPERATIONS.includes(raw.operation)) throw new Error(`operation은 ${OPERATIONS.join("|")} 중 하나여야 합니다.`);
  if (!raw.mappings || typeof raw.mappings !== "object" || Object.keys(raw.mappings).length === 0)
    throw new Error("mappings가 비어 있습니다.");

  const targets = Object.values(raw.mappings).map((m: any) => (typeof m === "string" ? m : m?.field));
  if (raw.operation === "upsert" && !raw.externalIdField)
    throw new Error("upsert에는 externalIdField가 필요합니다.");
  if (raw.operation === "update" && !targets.includes("Id"))
    throw new Error("update에는 Id로 매핑되는 컬럼이 필요합니다.");

  const onLookupMiss = raw.onLookupMiss ?? "error";
  if (onLookupMiss !== "error" && onLookupMiss !== "blank")
    throw new Error("onLookupMiss는 error 또는 blank여야 합니다.");

  const skipEmptyFields = raw.skipEmptyFields ?? false;
  if (typeof skipEmptyFields !== "boolean")
    throw new Error("skipEmptyFields는 true 또는 false여야 합니다.");

  return {
    object: raw.object,
    targetOrg: raw.targetOrg,
    operation: raw.operation,
    externalIdField: raw.externalIdField,
    mappings: raw.mappings,
    onLookupMiss,
    skipEmptyFields,
  };
}

export function loadJob(path: string): Job {
  return validateJob(JSON.parse(readFileSync(path, "utf8")));
}
