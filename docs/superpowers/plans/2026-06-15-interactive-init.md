# 대화형 init 마법사 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sfload init`을 org 메타데이터 기반 대화형 마법사로 만들어 객체·필드·lookup 매핑을 목록에서 선택·검증하고, 저장 후 자동 dry-run으로 적재 전 정확성을 확인한다.

**Architecture:** 판단·구성 로직은 순수 함수(`init-logic.ts`)로 분리해 단위 테스트하고, `@inquirer/prompts` I/O는 얇은 `wizard.ts`에 둔다. 선택지는 전부 org describe에서 와서 오타·미존재 선택이 불가능하다. lookup 대상 객체는 필드 `referenceTo`로 자동 확정한다.

**Tech Stack:** Node 20, TypeScript, jsforce v3, `@inquirer/prompts`, vitest.

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `src/describe.ts` | `FieldInfo` 확장 + `toFieldInfo` + `listObjects` (+기존 suggestMappings 유지) | 수정 |
| `src/init-logic.ts` | 순수: `requiredFieldsMissing`·`keyFieldRisk`·`buildJob`·`mappedApiNames`·`summaryRows`·`MappingChoice` | 신규 |
| `src/wizard.ts` | `@inquirer/prompts` 대화 흐름 → `Job` 반환 | 신규 |
| `src/cli.ts` | `init`이 wizard 호출 → 저장 → dry-run | 수정 |
| `test/init-logic.test.ts`, `test/describe.test.ts`, `test/wizard.test.ts` | 테스트 | 신규/수정 |
| `README.md`, `USAGE.md` | init 대화형으로 안내 갱신 | 수정 |

**인터페이스 계약 (공유)**
```ts
// describe.ts
export interface FieldInfo {
  name: string; label: string; type: string; referenceTo: string[];
  createable: boolean; updateable: boolean; nillable: boolean;
  defaultedOnCreate: boolean; externalId: boolean; idLookup: boolean;
}
export interface ObjectInfo { name: string; label: string; }
// init-logic.ts
export interface MappingChoice {
  header: string; kind: "field" | "lookup" | "skip";
  field?: string; lookup?: { object: string; key: string };
}
```

---

## Task 1: 의존성 + describe 확장

**Files:** Modify `package.json`, `src/describe.ts`; Modify `test/describe.test.ts`

- [ ] **Step 1: @inquirer/prompts 설치**
Run: `npm install @inquirer/prompts@^7.2.0`
Expected: 설치 완료. `package.json` dependencies에 추가됨.

- [ ] **Step 2: 실패 테스트 추가** — `test/describe.test.ts`에 아래 describe 블록 추가(기존 suggestMappings 테스트는 유지):
```ts
import { toFieldInfo } from "../src/describe";

describe("toFieldInfo", () => {
  it("describe 필드를 FieldInfo로 정규화", () => {
    const f = toFieldInfo({
      name: "AccountId", label: "거래처", type: "reference",
      referenceTo: ["Account"], createable: true, updateable: true,
      nillable: false, defaultedOnCreate: false, externalId: false, idLookup: false,
    });
    expect(f).toEqual({
      name: "AccountId", label: "거래처", type: "reference", referenceTo: ["Account"],
      createable: true, updateable: true, nillable: false,
      defaultedOnCreate: false, externalId: false, idLookup: false,
    });
  });
  it("누락 필드는 안전한 기본값", () => {
    const f = toFieldInfo({ name: "X" });
    expect(f.label).toBe("X");
    expect(f.referenceTo).toEqual([]);
    expect(f.createable).toBe(false);
  });
});
```
Run: `npm test -- describe` → 새 테스트 FAIL(`toFieldInfo` 없음).

- [ ] **Step 3: `src/describe.ts` 교체**
```ts
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
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- describe` → PASS. `npx tsc --noEmit` → 에러 없음.

- [ ] **Step 5: 커밋**
```bash
git add package.json package-lock.json src/describe.ts test/describe.test.ts
git commit -m "feat: describe 확장(FieldInfo 메타·listObjects) + @inquirer/prompts"
```

---

## Task 2: init-logic (순수 로직)

**Files:** Create `src/init-logic.ts`, `test/init-logic.test.ts`

- [ ] **Step 1: 실패 테스트 `test/init-logic.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import {
  requiredFieldsMissing, keyFieldRisk, buildJob, mappedApiNames, summaryRows,
} from "../src/init-logic";
import type { FieldInfo } from "../src/describe";

function field(p: Partial<FieldInfo> & { name: string }): FieldInfo {
  return {
    name: p.name, label: p.label ?? p.name, type: p.type ?? "string", referenceTo: p.referenceTo ?? [],
    createable: p.createable ?? true, updateable: p.updateable ?? true, nillable: p.nillable ?? true,
    defaultedOnCreate: p.defaultedOnCreate ?? false, externalId: p.externalId ?? false, idLookup: p.idLookup ?? false,
  };
}

describe("requiredFieldsMissing", () => {
  it("생성필수(생성가능·non-nillable·기본값없음)이고 미매핑인 것만", () => {
    const fields = [
      field({ name: "LastName", nillable: false }),
      field({ name: "Email" }),                                  // nillable → 필수 아님
      field({ name: "X", nillable: false, defaultedOnCreate: true }), // 기본값 → 제외
    ];
    const miss = requiredFieldsMissing(fields, ["Email"]);
    expect(miss.map((f) => f.name)).toEqual(["LastName"]);
  });
});

describe("keyFieldRisk", () => {
  it("externalId/idLookup이면 위험 없음, 아니면 위험", () => {
    expect(keyFieldRisk(field({ name: "K", externalId: true }))).toBe(false);
    expect(keyFieldRisk(field({ name: "K", idLookup: true }))).toBe(false);
    expect(keyFieldRisk(field({ name: "K" }))).toBe(true);
  });
});

describe("buildJob / mappedApiNames / summaryRows", () => {
  const choices = [
    { header: "이름", kind: "field" as const, field: "LastName" },
    { header: "거래처키", kind: "lookup" as const, field: "AccountId", lookup: { object: "Account", key: "Ext__c" } },
    { header: "메모", kind: "skip" as const },
  ];
  it("buildJob: 매핑/operation/옵션 반영, skip 제외", () => {
    const job = buildJob({ object: "Contact", targetOrg: "dev", operation: "insert", onLookupMiss: "error", skipEmptyFields: true, choices });
    expect(job.object).toBe("Contact");
    expect(job.skipEmptyFields).toBe(true);
    expect(job.mappings).toEqual({
      "이름": "LastName",
      "거래처키": { field: "AccountId", lookup: { object: "Account", key: "Ext__c" } },
    });
    expect(job.externalIdField).toBeUndefined();
  });
  it("buildJob: upsert면 externalIdField 포함", () => {
    const job = buildJob({ object: "Contact", targetOrg: "dev", operation: "upsert", externalIdField: "Ext__c", onLookupMiss: "error", skipEmptyFields: false, choices });
    expect(job.externalIdField).toBe("Ext__c");
  });
  it("mappedApiNames: 매핑된 타겟 필드만", () => {
    expect(mappedApiNames(choices)).toEqual(["LastName", "AccountId"]);
  });
  it("summaryRows: 사람이 읽는 요약", () => {
    expect(summaryRows(choices)).toEqual([
      { header: "이름", target: "LastName" },
      { header: "거래처키", target: "AccountId ← Account.Ext__c" },
      { header: "메모", target: "(건너뜀)" },
    ]);
  });
});
```
Run: `npm test -- init-logic` → FAIL(모듈 없음).

- [ ] **Step 2: `src/init-logic.ts`**
```ts
import type { Job, Mapping } from "./types.js";
import type { FieldInfo } from "./describe.js";

export interface MappingChoice {
  header: string;
  kind: "field" | "lookup" | "skip";
  field?: string;
  lookup?: { object: string; key: string };
}

// insert 시 채워야 하는 필드: 생성가능 + non-nillable + 기본값없음 + 미매핑
export function requiredFieldsMissing(fields: FieldInfo[], mapped: string[]): FieldInfo[] {
  const set = new Set(mapped);
  return fields.filter(
    (f) => f.createable && !f.nillable && !f.defaultedOnCreate && !set.has(f.name),
  );
}

// key 필드 중복 위험: externalId/idLookup이면 안전(false), 아니면 위험(true)
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
```

- [ ] **Step 3: 통과 확인** — Run: `npm test -- init-logic` → PASS. `npx tsc --noEmit` → 에러 없음.

- [ ] **Step 4: 커밋**
```bash
git add src/init-logic.ts test/init-logic.test.ts
git commit -m "feat: init 순수 로직(검증·job 빌드·요약)"
```

---

## Task 3: wizard (대화 흐름)

**Files:** Create `src/wizard.ts`, `test/wizard.test.ts`

- [ ] **Step 1: 실패 테스트 `test/wizard.test.ts`** (`@inquirer/prompts` mock)
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const answers: any[] = [];
vi.mock("@inquirer/prompts", () => ({
  search: vi.fn(async () => answers.shift()),
  select: vi.fn(async () => answers.shift()),
  confirm: vi.fn(async () => answers.shift()),
}));

import { runWizard } from "../src/wizard";

const fakeConn = {
  describeGlobal: async () => ({ sobjects: [{ name: "Contact", label: "연락처", queryable: true }] }),
  describe: async (obj: string) => {
    if (obj === "Contact") return { fields: [
      { name: "LastName", label: "성", type: "string", nillable: false, createable: true, updateable: true },
      { name: "AccountId", label: "거래처", type: "reference", referenceTo: ["Account"], createable: true, updateable: true, nillable: true },
    ] };
    return { fields: [
      { name: "Ext__c", label: "외부ID", type: "string", externalId: true, createable: true, updateable: true, nillable: true },
    ] };
  },
} as any;

beforeEach(() => { answers.length = 0; });

describe("runWizard", () => {
  it("단순+lookup 매핑 흐름으로 Job 생성", async () => {
    // 순서: 객체→operation→[헤더1 kind=field→필드]→[헤더2 kind=lookup→ref필드→key필드]→요약확인
    answers.push(
      "Contact",            // search: object
      "insert",             // select: operation
      "field", "LastName",  // 헤더 "성": 필드 매핑 → LastName
      "lookup", "AccountId", "Ext__c", // 헤더 "거래처키": lookup → AccountId → key Ext__c
      true,                 // 요약 confirm
    );
    const job = await runWizard(fakeConn, ["성", "거래처키"], "dev");
    expect(job.object).toBe("Contact");
    expect(job.operation).toBe("insert");
    expect(job.mappings["성"]).toBe("LastName");
    expect(job.mappings["거래처키"]).toEqual({ field: "AccountId", lookup: { object: "Account", key: "Ext__c" } });
  });
});
```
Run: `npm test -- wizard` → FAIL(모듈 없음).

- [ ] **Step 2: `src/wizard.ts`**
```ts
import { search, select, confirm } from "@inquirer/prompts";
import type { Connection } from "jsforce";
import type { Job } from "./types.js";
import { describeFields, listObjects, type FieldInfo } from "./describe.js";
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
  const inputable = fields.filter((f) => f.createable || f.updateable);
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
        choices: inputable.map((f) => ({ name: labelOf(f), value: f.name })),
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
    const target = refFields.find((f) => f.name === field)!.referenceTo[0];
    const targetFields = await describeFields(conn, target);
    const key = await select<string>({
      message: `${target}에서 비교할 key 필드`,
      choices: targetFields.map((f) => ({ name: `${labelOf(f)}${f.externalId ? " [ExtId]" : ""}`, value: f.name })),
    });
    const keyInfo = targetFields.find((f) => f.name === key)!;
    if (keyFieldRisk(keyInfo)) {
      const ok = await confirm({
        message: `'${key}'는 고유 키(External Id/idLookup)가 아니라 중복 매칭 위험이 있습니다. 그대로 쓸까요?`,
        default: false,
      });
      if (!ok) { choices.push({ header, kind: "skip" }); continue; }
    }
    choices.push({ header, kind: "lookup", field, lookup: { object: target, key } });
  }

  // 4. 검증·경고
  if (operation === "insert") {
    const missing = requiredFieldsMissing(fields, mappedApiNames(choices));
    if (missing.length > 0) {
      const ok = await confirm({
        message: `필수 입력 필드가 매핑되지 않았습니다: ${missing.map((f) => f.name).join(", ")}. 계속할까요?`,
        default: false,
      });
      if (!ok) throw new Error("취소되었습니다. 누락 필드를 CSV에 추가하고 다시 실행하세요.");
    }
  }
  if (operation === "update" && !mappedApiNames(choices).includes("Id")) {
    throw new Error("update에는 Id 컬럼 매핑이 필요합니다. 다시 실행해 Id를 매핑하세요.");
  }

  // 5. 요약 + 확정
  console.table(summaryRows(choices));
  const proceed = await confirm({ message: "이 매핑으로 job.json을 생성할까요?", default: true });
  if (!proceed) throw new Error("사용자가 취소했습니다.");

  return buildJob({ object, targetOrg, operation, externalIdField, onLookupMiss: "error", skipEmptyFields: false, choices });
}
```

- [ ] **Step 3: 통과 확인** — Run: `npm test -- wizard` → PASS. `npx tsc --noEmit` → 에러 없음.
(타입 에러 시: `@inquirer/prompts`의 `search`/`select` 제네릭 시그니처에 맞춰 `<string>` 위치만 조정. 로직·프롬프트 메시지는 유지.)

- [ ] **Step 4: 커밋**
```bash
git add src/wizard.ts test/wizard.test.ts
git commit -m "feat: 대화형 init 마법사 흐름"
```

---

## Task 4: cli init 연결 + 문서

**Files:** Modify `src/cli.ts`, `README.md`, `USAGE.md`

- [ ] **Step 1: `src/cli.ts`의 init 명령 교체**
기존 `init` 블록(설명·옵션·action)을 아래로 교체. `describeFields`/`suggestMappings` import는 `runWizard`로 대체:
```ts
import { runWizard } from "./wizard.js";
```
(상단 import에서 `import { describeFields, suggestMappings } from "./describe.js";` 줄 제거)
```ts
program.command("init")
  .description("대화형 마법사로 매핑 설정(job.json) 생성 + dry-run 검증")
  .requiredOption("--org <alias>", "sf CLI 별칭 또는 username")
  .requiredOption("-i, --input <csv>", "매핑할 마이그레이션 CSV(헤더 사용)")
  .option("--out <path>", "출력 job 파일 경로", "job.json")
  .action(async (opts) => {
    const conn = await getConnection(opts.org);
    const headers = await firstHeader(opts.input);
    if (headers.length === 0) throw new Error("CSV 헤더를 읽지 못했습니다.");
    const job = await runWizard(conn, headers, opts.org);
    writeFileSync(opts.out, JSON.stringify(job, null, 2) + "\n", "utf8");
    console.log(`\n✅ ${opts.out} 생성. dry-run으로 매핑을 검증합니다...\n`);
    const r = await prepare(conn, job, opts.input);
    console.log(`dry-run 결과: 변환 ${r.resolvedCount} / 미매칭 ${r.errorCount} (상세: ${r.errorsPath})`);
    console.log("문제 없으면 'load'로 적재하세요. (적재 전까지 org에 쓰기 없음)");
  });
```
(`prepare`는 이미 import돼 있음. `firstHeader` 헬퍼도 기존 존재.)

- [ ] **Step 2: 빌드·구동 점검**
Run: `npm run build`
Run: `node dist/cli.js init --help`
Expected: 새 설명과 `--org`, `-i`, `--out` 옵션 표시. (`-o/--object`는 제거됨)

- [ ] **Step 3: 전체 테스트 + 타입**
Run: `npm test` → 전체 PASS (기존 42 + init-logic + wizard + describe 추가분).
Run: `npx tsc --noEmit` → 에러 없음.

- [ ] **Step 4: 문서 갱신**
- `USAGE.md` "2. 매핑 설정 만들기 → 방법 A) 자동 뼈대 생성"을 **대화형 마법사**로 교체:
  ```markdown
  ### 방법 A) 대화형 마법사 (추천)
  ```bash
  node dist/cli.js init --org dev -i data.csv
  ```
  → 객체·작업 종류·각 CSV 헤더의 매핑(필드 / lookup / 건너뛰기)을 **목록에서 골라** job.json을 만듭니다.
  - 모든 선택지는 org에서 불러와 검증되므로 오타·없는 필드 선택이 불가능합니다.
  - lookup은 선택한 필드의 관계 대상이 자동 확정되고, 비교할 key 필드만 고르면 됩니다.
  - 끝나면 **자동 dry-run**으로 "변환 N / 미매칭 K"를 보여줘 적재 전에 매핑을 검증합니다.
  ```
- `README.md`의 init 예시(`사용 흐름`/시작하기)에서 `init -o Account --org dev -i data.csv` → `init --org dev -i data.csv`로 수정(객체는 대화형 선택).

- [ ] **Step 5: 커밋**
```bash
git add src/cli.ts README.md USAGE.md
git commit -m "feat: init을 대화형 마법사로 연결 + 문서 갱신"
```

---

## Task 5: 수동 확인 (실제 org, 읽기 전용)

> 대화형이라 자동화가 어려움. 코드 완료 후 실제 org 별칭으로 1회 확인. **init은 읽기 전용(describe+prepare)이라 데이터 쓰기 없음.**

- [ ] **Step 1**: `node dist/cli.js init --org "YG1 Partial" -i <샘플.csv>` 실행 → 객체/필드/lookup을 목록에서 선택.
- [ ] **Step 2**: 생성된 job.json과 dry-run 결과(변환/미매칭) 확인. errors.csv 점검.
- [ ] **Step 3**: lookup 매핑 시 referenceTo 자동 확정·key 선택·중복키 경고가 동작하는지 확인.

---

## Self-Review 결과
- **Spec 커버리지**: 객체/필드 목록 선택(T1 describe + T3 wizard), referenceTo 자동 대상(T3), 필수필드·중복키 경고(T2 로직 + T3 호출), 요약 확인(T2/T3), 자동 dry-run(T4), 읽기전용(T4: describe+prepare만) — 전부 태스크 존재.
- **Placeholder 스캔**: 모든 코드 단계 실제 코드 포함. T3 Step3의 제네릭 위치 조정 안내는 타입 정합용(로직 불변).
- **타입/시그니처 일관성**: `FieldInfo`/`ObjectInfo`/`MappingChoice`, `toFieldInfo`/`describeFields`/`listObjects`, `requiredFieldsMissing`/`keyFieldRisk`/`buildJob`/`mappedApiNames`/`summaryRows`, `runWizard(conn,headers,targetOrg)` 시그니처가 계약·태스크 간 일치.
- **안전성**: init은 describe + 읽기전용 prepare만 호출(쓰기 없음). 취소 시 부분 저장 없음(job.json은 요약 confirm 후에만 기록).
