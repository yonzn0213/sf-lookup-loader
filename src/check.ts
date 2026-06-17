import type { Job } from "./types.js";
import type { FieldInfo } from "./describe.js";
import { parseMappings } from "./mapping.js";

export interface CheckIssue { level: "error" | "warn"; message: string; }

// job.json을 org 메타데이터에 대해 비대화형 사전 점검(CI/프리플라이트).
// objectFields: 대상 객체 필드, lookupTargetFields: { 대상객체API: 필드[] }.
export function checkJob(
  job: Job,
  objectFields: FieldInfo[],
  lookupTargetFields: Record<string, FieldInfo[]>,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const byName = new Map(objectFields.map((f) => [f.name, f]));
  const { simple, lookups } = parseMappings(job.mappings);

  // 단순 필드: 존재 + 작업별 접근성(FLS/권한은 describe의 createable/updateable에 반영됨)
  for (const [src, api] of Object.entries(simple)) {
    const f = byName.get(api);
    if (!f) { issues.push({ level: "error", message: `필드 없음: '${api}' (헤더 '${src}')` }); continue; }
    if (api === "Id") continue;
    if (job.operation === "insert" && !f.createable)
      issues.push({ level: "warn", message: `생성 불가 필드(FLS/권한?): '${api}'` });
    if (job.operation === "update" && !f.updateable)
      issues.push({ level: "warn", message: `수정 불가 필드(FLS/권한?): '${api}'` });
  }

  // lookup 필드: 존재 + reference 타입 + referenceTo가 대상 포함 + 대상에 key 필드 존재
  for (const lk of lookups) {
    const f = byName.get(lk.field);
    if (!f) { issues.push({ level: "error", message: `lookup 필드 없음: '${lk.field}'` }); continue; }
    if (f.type !== "reference") {
      issues.push({ level: "error", message: `'${lk.field}'는 관계(reference) 필드가 아님(type=${f.type})` });
    } else if (!f.referenceTo.includes(lk.object)) {
      issues.push({ level: "error", message: `'${lk.field}'는 '${lk.object}'를 가리키지 않음(referenceTo: ${f.referenceTo.join(", ") || "없음"})` });
    }
    const tf = lookupTargetFields[lk.object];
    if (tf && !tf.some((x) => x.name === lk.key))
      issues.push({ level: "error", message: `'${lk.object}'에 key 필드 없음: '${lk.key}'` });
  }

  // 작업별 필수 조건
  const mappedTargets = [...Object.values(simple), ...lookups.map((l) => l.field)];
  if (job.operation === "update" && !mappedTargets.includes("Id"))
    issues.push({ level: "error", message: "update에는 Id로 매핑되는 컬럼이 필요합니다." });
  if (job.operation === "upsert") {
    if (!job.externalIdField) {
      issues.push({ level: "error", message: "upsert에는 externalIdField가 필요합니다." });
    } else {
      const ef = byName.get(job.externalIdField);
      if (!ef) issues.push({ level: "error", message: `externalIdField 없음: '${job.externalIdField}'` });
      else if (!ef.externalId && !ef.idLookup)
        issues.push({ level: "warn", message: `externalIdField '${job.externalIdField}'가 External Id/idLookup이 아님 — upsert 키로 부적합할 수 있음` });
    }
  }

  return issues;
}
