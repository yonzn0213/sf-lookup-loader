import { search, select, confirm } from "@inquirer/prompts";
import type { Connection } from "jsforce";
import type { Job } from "./types.js";
import { describeFields, listObjects } from "./describe.js";
import { COMPARABLE_KEY_TYPES } from "./lookup.js";
import {
  buildJob, mappedApiNames, requiredFieldsMissing, keyFieldRisk, summaryRows, type MappingChoice,
} from "./init-logic.js";

function labelOf(f: { name: string; label: string }): string {
  return `${f.label} (${f.name})`;
}

export async function runWizard(conn: Connection, headers: string[], targetOrg: string): Promise<Job> {
  // 1. 대상 객체
  const objects = await listObjects(conn);
  const object = await search<string>({
    message: "대상 객체를 선택하세요",
    source: async (term) => objects
      .filter((o) => !term || o.name.toLowerCase().includes(term.toLowerCase()) || o.label.includes(term))
      .slice(0, 25)
      .map((o) => ({ name: labelOf(o), value: o.name })),
  });

  // 2. operation
  const operation = await select<Job["operation"]>({
    message: "작업 종류",
    choices: [
      { name: "insert (새 레코드 생성)", value: "insert" },
      { name: "update (기존 수정)", value: "update" },
      { name: "upsert (있으면 수정/없으면 생성)", value: "upsert" },
    ],
  });

  const fields = await describeFields(conn, object);

  // upsert → External Id 필드
  let externalIdField: string | undefined;
  if (operation === "upsert") {
    const ext = fields.filter((f) => f.externalId);
    if (ext.length === 0) throw new Error(`'${object}'에 External Id 필드가 없어 upsert를 쓸 수 없습니다.`);
    externalIdField = await select<string>({
      message: "upsert 기준 External Id 필드",
      choices: ext.map((f) => ({ name: labelOf(f), value: f.name })),
    });
  }

  // 3. 헤더별 매핑
  // insert는 생성가능, update는 수정가능 필드. update는 어느 컬럼이 레코드 Id인지 지정해야 하므로 Id 포함.
  const baseFields = operation === "update"
    ? fields.filter((f) => f.updateable)
    : fields.filter((f) => f.createable);
  const idField = fields.find((f) => f.name === "Id");
  const fieldChoices = operation === "update" && idField ? [idField, ...baseFields] : baseFields;
  const refFields = fields.filter((f) => f.type === "reference" && f.referenceTo.length > 0);
  const choices: MappingChoice[] = [];

  for (const header of headers) {
    const kind = await select<"field" | "lookup" | "skip">({
      message: `'${header}' 컬럼 처리`,
      choices: [
        { name: "필드 매핑", value: "field" },
        { name: "lookup 매핑(관계 Id 자동 채움)", value: "lookup" },
        { name: "건너뛰기", value: "skip" },
      ],
    });

    if (kind === "skip") { choices.push({ header, kind: "skip" }); continue; }

    if (kind === "field") {
      const field = await select<string>({
        message: `'${header}' → 어느 필드`,
        choices: fieldChoices.map((f) => ({ name: labelOf(f), value: f.name })),
      });
      choices.push({ header, kind: "field", field });
      continue;
    }

    // lookup
    if (refFields.length === 0) throw new Error(`'${object}'에 lookup(관계) 필드가 없습니다.`);
    const field = await select<string>({
      message: `'${header}' → 어느 lookup 필드`,
      choices: refFields.map((f) => ({ name: `${labelOf(f)} → ${f.referenceTo.join(", ")}`, value: f.name })),
    });
    const refField = refFields.find((f) => f.name === field)!;
    // 다형성 관계(referenceTo 여러 개)면 대상 객체를 명시적으로 선택받는다(C2: 무단 첫 번째 선택 방지).
    let target: string;
    if (refField.referenceTo.length > 1) {
      target = await select<string>({
        message: `'${field}'는 다형성 관계입니다. 어느 대상 객체로 매칭할까요`,
        choices: refField.referenceTo.map((o) => ({ name: o, value: o })),
      });
    } else {
      target = refField.referenceTo[0];
    }
    const targetFields = await describeFields(conn, target);
    // key 후보: 비교 가능 타입 + externalId/idLookup. 고유키를 위로 정렬.
    const keyCandidates = targetFields
      .filter((f) => f.externalId || f.idLookup || COMPARABLE_KEY_TYPES.has(f.type))
      .sort((a, b) => Number(b.externalId || b.idLookup) - Number(a.externalId || a.idLookup));
    if (keyCandidates.length === 0) throw new Error(`'${target}'에 key로 쓸 만한 필드가 없습니다.`);
    // 고유 키가 아니면 위험을 알리고, skip이 아니라 재선택을 유도(I2).
    let key: string;
    for (;;) {
      key = await select<string>({
        message: `${target}에서 비교할 key 필드`,
        choices: keyCandidates.map((f) => ({
          name: `${labelOf(f)}${f.externalId || f.idLookup ? " [고유]" : ""}`,
          value: f.name,
        })),
      });
      const keyInfo = targetFields.find((f) => f.name === key)!;
      if (!keyFieldRisk(keyInfo)) break;
      const ok = await confirm({
        message: `'${key}'는 고유 키(External Id/idLookup)가 아니라 중복 매칭 위험이 있습니다. 그대로 쓸까요? (아니오 → 다른 key 선택)`,
        default: false,
      });
      if (ok) break;
    }
    choices.push({ header, kind: "lookup", field, lookup: { object: target, key } });
  }

  // 4. 검증·경고
  if (operation === "insert") {
    const missing = requiredFieldsMissing(fields, mappedApiNames(choices));
    if (missing.length > 0) {
      const ok = await confirm({
        message: `필수 입력 필드 미매핑(시스템 필수 기준 — 검증규칙·레이아웃 필수는 감지 못 함): ${missing.map((f) => f.name).join(", ")}. 계속할까요?`,
        default: false,
      });
      if (!ok) throw new Error("취소되었습니다. 누락 필드를 CSV에 추가하고 다시 실행하세요.");
    }
  }
  if (operation === "update" && !mappedApiNames(choices).includes("Id")) {
    throw new Error("update에는 Id 컬럼 매핑이 필요합니다. 다시 실행해 Id를 매핑하세요.");
  }

  // update/upsert: 빈 셀이 기존 값을 null로 덮어쓰지 않도록 옵션 질의
  let skipEmptyFields = false;
  if (operation === "update" || operation === "upsert") {
    skipEmptyFields = await confirm({
      message: "빈 셀은 건너뛰어 기존 값을 보존할까요? (권장: 예)",
      default: true,
    });
  }

  // lookup 미매칭 행 처리 방식
  const onLookupMiss = await select<"error" | "blank">({
    message: "lookup 매칭 실패 행을 어떻게 할까요?",
    choices: [
      { name: "error: 그 행을 제외하고 errors.csv에 기록(권장)", value: "error" },
      { name: "blank: 관계를 비운 채 진행", value: "blank" },
    ],
  });

  // 5. 요약 + 확정
  console.table(summaryRows(choices));
  const proceed = await confirm({ message: "이 매핑으로 job.json을 생성할까요?", default: true });
  if (!proceed) throw new Error("사용자가 취소했습니다.");

  return buildJob({ object, targetOrg, operation, externalIdField, onLookupMiss, skipEmptyFields, choices });
}
