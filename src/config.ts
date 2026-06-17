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

  // 각 매핑 값은 문자열(단순) 또는 {field, lookup:{object,key}}(lookup)여야 함. 배열/숫자/불완전 객체 차단.
  for (const [key, m] of Object.entries(raw.mappings)) {
    const ok =
      typeof m === "string"
        ? m.trim() !== ""
        : typeof m === "object" && m !== null && !Array.isArray(m)
          && typeof (m as any).field === "string" && (m as any).field.trim() !== ""
          && typeof (m as any).lookup === "object" && (m as any).lookup !== null
          && typeof (m as any).lookup.object === "string" && (m as any).lookup.object.trim() !== ""
          && typeof (m as any).lookup.key === "string" && (m as any).lookup.key.trim() !== "";
    if (!ok) throw new Error(`mappings['${key}'] 형식이 잘못되었습니다. 문자열(필드명) 또는 {field, lookup:{object,key}} 여야 합니다.`);
  }

  const targets = Object.values(raw.mappings).map((m: any) => (typeof m === "string" ? m : m.field));
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

  const auditRequired = raw.auditRequired ?? false;
  if (typeof auditRequired !== "boolean")
    throw new Error("auditRequired는 true 또는 false여야 합니다.");

  return {
    object: raw.object,
    targetOrg: raw.targetOrg,
    operation: raw.operation,
    externalIdField: raw.externalIdField,
    mappings: raw.mappings,
    onLookupMiss,
    skipEmptyFields,
    auditRequired,
  };
}

// 파일 읽기/JSON 파싱/검증 실패를 사용자가 알아볼 수 있는 메시지로 변환한다.
export function loadJob(path: string): Job {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") throw new Error(`job 파일을 찾을 수 없습니다: ${path}`);
    throw new Error(`job 파일 읽기 실패(${path}): ${e?.message ?? e}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e: any) {
    throw new Error(`job 파일 JSON 형식 오류(${path}): ${e?.message ?? e}`);
  }
  return validateJob(parsed);
}
