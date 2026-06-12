# sfload CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Salesforce 데이터 삽입 마이그레이션(헤더 매핑 + lookup Id 자동 치환 + insert/update/upsert + 검증)을 처리하는 로컬 Node/TypeScript CLI를 만든다.

**Architecture:** 순수 변환 로직(config·mapping·lookup)과 IO(jsforce 조회/Bulk, sf CLI 인증, CSV 스트리밍)를 분리한다. `prepare`(매핑+치환만)와 `load`(Bulk 적재)를 나눠 적재 전에 결과를 검증할 수 있게 한다. 대용량은 CSV 스트리밍으로 처리한다.

**Tech Stack:** Node 20, TypeScript, jsforce v3, commander, csv-parse / csv-stringify, vitest. 인증은 `sf` CLI 재사용.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `src/types.ts` | 공유 타입(`Job`, `Mapping`, `Operation` 등) |
| `src/config.ts` | job.json 로드·검증 (순수) |
| `src/mapping.ts` | 매핑 분해·단순 헤더 변환 (순수) |
| `src/lookup.ts` | 청크·SOQL 이스케이프·key→Id 맵·행 치환(순수) + `queryKeys`(conn 주입) |
| `src/auth.ts` | `sf org display --json` → jsforce `Connection` |
| `src/report.ts` | CSV 작성·콘솔 요약 헬퍼 |
| `src/prepare.ts` | 스트리밍 파이프라인: 매핑+치환 → resolved/errors |
| `src/load.ts` | Bulk2 insert/update/upsert + results |
| `src/describe.ts` | 객체 describe → init 매핑 뼈대 |
| `src/cli.ts` | commander 명령 정의·디스패치 |
| `test/*.test.ts` | vitest 단위/통합 테스트 |

**인터페이스 계약 (전 태스크 공유)**
```ts
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
```

---

## Task 1: 스캐폴딩

**Files:** Create `package.json`, `tsconfig.json`, `.gitignore`, `test/smoke.test.ts`

- [ ] **Step 1: .gitignore**
```
node_modules/
dist/
*.resolved.csv
*.errors.csv
*.results.csv
.DS_Store
```

- [ ] **Step 2: package.json**
```json
{
  "name": "sfload",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "sfload": "dist/cli.js" },
  "scripts": {
    "test": "vitest run",
    "build": "tsc",
    "dev": "tsx src/cli.ts"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "csv-parse": "^5.5.6",
    "csv-stringify": "^6.5.1",
    "jsforce": "^3.6.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: test/smoke.test.ts**
```ts
import { describe, it, expect } from "vitest";
describe("toolchain", () => {
  it("works", () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 5: 설치 + 테스트**
Run: `npm install`
Run: `npm test`
Expected: `1 passed`.

- [ ] **Step 6: 커밋**
```bash
git add .gitignore package.json package-lock.json tsconfig.json test/smoke.test.ts
git commit -m "chore: sfload 스캐폴딩"
```

---

## Task 2: types + config (검증)

**Files:** Create `src/types.ts`, `src/config.ts`, `test/config.test.ts`

- [ ] **Step 1: 실패 테스트 `test/config.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { validateJob } from "../src/config";

const base = {
  object: "Contact", targetOrg: "dev", operation: "insert",
  mappings: { "이름": "LastName" }, onLookupMiss: "error",
};

describe("validateJob", () => {
  it("정상 설정 통과", () => {
    expect(validateJob(base).object).toBe("Contact");
  });
  it("기본 onLookupMiss는 error", () => {
    const { onLookupMiss, ...noMiss } = base;
    expect(validateJob(noMiss).onLookupMiss).toBe("error");
  });
  it("object 없으면 throw", () => {
    expect(() => validateJob({ ...base, object: "" })).toThrow();
  });
  it("잘못된 operation throw", () => {
    expect(() => validateJob({ ...base, operation: "delete" })).toThrow();
  });
  it("upsert인데 externalIdField 없으면 throw", () => {
    expect(() => validateJob({ ...base, operation: "upsert" })).toThrow(/externalIdField/);
  });
  it("update인데 Id 매핑 없으면 throw", () => {
    expect(() => validateJob({ ...base, operation: "update" })).toThrow(/Id/);
  });
  it("mappings 비면 throw", () => {
    expect(() => validateJob({ ...base, mappings: {} })).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**
Run: `npm test -- config`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: `src/types.ts`** — 위 "인터페이스 계약"의 타입 블록을 그대로 파일로 생성.

- [ ] **Step 4: `src/config.ts`**
```ts
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

  return {
    object: raw.object,
    targetOrg: raw.targetOrg,
    operation: raw.operation,
    externalIdField: raw.externalIdField,
    mappings: raw.mappings,
    onLookupMiss,
  };
}

export function loadJob(path: string): Job {
  return validateJob(JSON.parse(readFileSync(path, "utf8")));
}
```

- [ ] **Step 5: 통과 확인** — Run: `npm test -- config` → PASS. `npx tsc --noEmit` → 에러 없음.

- [ ] **Step 6: 커밋**
```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat: job 설정 로드/검증"
```

---

## Task 3: mapping (헤더 변환)

**Files:** Create `src/mapping.ts`, `test/mapping.test.ts`

- [ ] **Step 1: 실패 테스트 `test/mapping.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { parseMappings, applySimple } from "../src/mapping";

const mappings = {
  "이름": "LastName",
  "이메일": "Email",
  "거래처키": { field: "AccountId", lookup: { object: "Account", key: "External_Id__c" } },
};

describe("parseMappings", () => {
  it("단순/lookup 분리", () => {
    const p = parseMappings(mappings);
    expect(p.simple).toEqual({ "이름": "LastName", "이메일": "Email" });
    expect(p.lookups).toEqual([
      { src: "거래처키", field: "AccountId", object: "Account", key: "External_Id__c" },
    ]);
  });
});

describe("applySimple", () => {
  it("매핑된 컬럼만 타겟 헤더로 변환", () => {
    const row = { "이름": "홍길동", "이메일": "a@b.com", "무시": "x" };
    expect(applySimple(row, { "이름": "LastName", "이메일": "Email" }))
      .toEqual({ LastName: "홍길동", Email: "a@b.com" });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- mapping` → FAIL.

- [ ] **Step 3: `src/mapping.ts`**
```ts
import type { Mapping, ParsedMappings } from "./types.js";

export function parseMappings(mappings: Record<string, Mapping>): ParsedMappings {
  const simple: Record<string, string> = {};
  const lookups: ParsedMappings["lookups"] = [];
  for (const [src, m] of Object.entries(mappings)) {
    if (typeof m === "string") simple[src] = m;
    else lookups.push({ src, field: m.field, object: m.lookup.object, key: m.lookup.key });
  }
  return { simple, lookups };
}

export function applySimple(
  row: Record<string, string>,
  simple: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [src, target] of Object.entries(simple)) {
    if (src in row) out[target] = row[src];
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- mapping` → PASS.

- [ ] **Step 5: 커밋**
```bash
git add src/mapping.ts test/mapping.test.ts
git commit -m "feat: 헤더 매핑 변환"
```

---

## Task 4: lookup (치환 로직 + 조회)

**Files:** Create `src/lookup.ts`, `test/lookup.test.ts`

- [ ] **Step 1: 실패 테스트 `test/lookup.test.ts`**
```ts
import { describe, it, expect, vi } from "vitest";
import { chunk, soqlEscape, buildIdMap, resolveRow, queryKeys } from "../src/lookup";

describe("chunk", () => {
  it("크기대로 분할", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("soqlEscape", () => {
  it("작은따옴표·백슬래시 이스케이프", () => {
    expect(soqlEscape("a'b\\c")).toBe("a\\'b\\\\c");
  });
});

describe("buildIdMap", () => {
  it("key→Id 맵 + 중복 감지", () => {
    const r = buildIdMap(
      [{ Id: "1", K: "a" }, { Id: "2", K: "b" }, { Id: "3", K: "b" }], "K");
    expect(r.map.get("a")).toBe("1");
    expect(r.duplicates.has("b")).toBe(true);
  });
});

const lookups = [{ src: "거래처키", field: "AccountId", object: "Account", key: "External_Id__c" }];

describe("resolveRow", () => {
  const idMaps = { AccountId: { map: new Map([["K1", "001x"]]), duplicates: new Set<string>() } };

  it("매칭되면 Id 치환", () => {
    const r = resolveRow({ "거래처키": "K1" }, lookups, idMaps, "error", 1);
    expect(r.fields).toEqual({ AccountId: "001x" });
    expect(r.errors).toEqual([]);
  });
  it("미매칭 + error면 에러 기록", () => {
    const r = resolveRow({ "거래처키": "X" }, lookups, idMaps, "error", 2);
    expect(r.errors[0]).toMatchObject({ row: 2, field: "AccountId", key: "X", reason: "미매칭" });
  });
  it("미매칭 + blank면 공란 + 에러 기록", () => {
    const r = resolveRow({ "거래처키": "X" }, lookups, idMaps, "blank", 3);
    expect(r.fields).toEqual({ AccountId: "" });
    expect(r.errors.length).toBe(1);
  });
  it("중복 key는 항상 에러", () => {
    const dup = { AccountId: { map: new Map(), duplicates: new Set(["D"]) } };
    const r = resolveRow({ "거래처키": "D" }, lookups, dup, "blank", 4);
    expect(r.errors[0].reason).toBe("중복 key");
  });
});

describe("queryKeys", () => {
  it("청크별 SOQL 조회 결과 합침", async () => {
    const conn = { query: vi.fn()
      .mockResolvedValueOnce({ records: [{ Id: "1", K: "a" }] })
      .mockResolvedValueOnce({ records: [{ Id: "2", K: "b" }] }) };
    const recs = await queryKeys(conn as any, "Account", "K", ["a", "b"], 1);
    expect(recs).toHaveLength(2);
    expect(conn.query).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- lookup` → FAIL.

- [ ] **Step 3: `src/lookup.ts`**
```ts
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
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- lookup` → PASS. `npx tsc --noEmit` → 에러 없음.

- [ ] **Step 5: 커밋**
```bash
git add src/lookup.ts test/lookup.test.ts
git commit -m "feat: lookup Id 치환 + 청크 조회"
```

---

## Task 5: auth (sf CLI 인증 재사용)

**Files:** Create `src/auth.ts`, `test/auth.test.ts`

- [ ] **Step 1: 실패 테스트 `test/auth.test.ts`**
```ts
import { describe, it, expect, vi } from "vitest";
import { parseOrgDisplay } from "../src/auth";

describe("parseOrgDisplay", () => {
  it("accessToken·instanceUrl 추출", () => {
    const json = JSON.stringify({ status: 0, result: { accessToken: "TOK", instanceUrl: "https://x.my.salesforce.com" } });
    expect(parseOrgDisplay(json)).toEqual({ accessToken: "TOK", instanceUrl: "https://x.my.salesforce.com" });
  });
  it("토큰 없으면 throw", () => {
    expect(() => parseOrgDisplay(JSON.stringify({ status: 0, result: {} }))).toThrow();
  });
  it("비-JSON이면 throw", () => {
    expect(() => parseOrgDisplay("not json")).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- auth` → FAIL.

- [ ] **Step 3: `src/auth.ts`**
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import jsforce from "jsforce";

const pexec = promisify(execFile);

export function parseOrgDisplay(stdout: string): { accessToken: string; instanceUrl: string } {
  let parsed: any;
  try { parsed = JSON.parse(stdout); } catch { throw new Error("sf org display 출력 파싱 실패"); }
  const r = parsed?.result ?? {};
  if (!r.accessToken || !r.instanceUrl)
    throw new Error("org 인증 정보를 찾지 못했습니다. `sf org login` 후 다시 시도하세요.");
  return { accessToken: r.accessToken, instanceUrl: r.instanceUrl };
}

export async function getConnection(alias: string): Promise<jsforce.Connection> {
  let stdout: string;
  try {
    ({ stdout } = await pexec("sf", ["org", "display", "--target-org", alias, "--json"], { shell: true }));
  } catch {
    throw new Error(`sf CLI 실행 실패: '${alias}' 별칭이 로그인돼 있는지(\`sf org list\`) 확인하세요.`);
  }
  const { accessToken, instanceUrl } = parseOrgDisplay(stdout);
  return new jsforce.Connection({ accessToken, instanceUrl });
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- auth` → PASS.

- [ ] **Step 5: 커밋**
```bash
git add src/auth.ts test/auth.test.ts
git commit -m "feat: sf CLI 인증 재사용 연결"
```

---

## Task 6: report + prepare (스트리밍 파이프라인)

**Files:** Create `src/report.ts`, `src/prepare.ts`, `test/prepare.test.ts`

- [ ] **Step 1: 실패 테스트 `test/prepare.test.ts`** (임시 CSV + mock conn)
```ts
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare } from "../src/prepare";
import type { Job } from "../src/types";

const dir = tmpdir();
const input = join(dir, "sfload_in.csv");
const created: string[] = [input];
afterEach(() => { for (const f of created) if (existsSync(f)) rmSync(f); });

const job: Job = {
  object: "Contact", targetOrg: "dev", operation: "insert",
  mappings: { "이름": "LastName", "거래처키": { field: "AccountId", lookup: { object: "Account", key: "K__c" } } },
  onLookupMiss: "error",
};

const fakeConn = {
  query: async (soql: string) => ({ records: [{ Id: "001A", K__c: "alpha" }] }),
} as any;

describe("prepare", () => {
  it("매핑+lookup 치환 → resolved.csv, 미매칭은 errors.csv", async () => {
    writeFileSync(input, "이름,거래처키\n홍길동,alpha\n김철수,none\n", "utf8");
    const res = await prepare(fakeConn, job, input);
    created.push(res.resolvedPath, res.errorsPath);

    const resolved = readFileSync(res.resolvedPath, "utf8");
    expect(resolved).toContain("LastName,AccountId");
    expect(resolved).toContain("홍길동,001A");
    expect(res.resolvedCount).toBe(1);   // 홍길동만 통과
    expect(res.errorCount).toBe(1);      // 김철수(none) 미매칭

    const errors = readFileSync(res.errorsPath, "utf8");
    expect(errors).toContain("none");
    expect(errors).toContain("미매칭");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- prepare` → FAIL.

- [ ] **Step 3: `src/report.ts`**
```ts
import { stringify } from "csv-stringify/sync";
import { writeFileSync } from "node:fs";
import type { RowError } from "./types.js";

export function writeRows(path: string, rows: Array<Record<string, string>>, headers: string[]): void {
  writeFileSync(path, stringify(rows, { header: true, columns: headers }), "utf8");
}

export function writeErrors(path: string, errors: RowError[]): void {
  writeFileSync(path, stringify(errors, { header: true, columns: ["row", "field", "key", "reason"] }), "utf8");
}

export function summarize(label: string, nums: Record<string, number>): void {
  const parts = Object.entries(nums).map(([k, v]) => `${k} ${v}`).join(" / ");
  console.log(`[${label}] ${parts}`);
}
```

- [ ] **Step 4: `src/prepare.ts`**
```ts
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import jsforce from "jsforce";
import type { Job, IdMap, RowError } from "./types.js";
import { parseMappings, applySimple } from "./mapping.js";
import { queryKeys, buildIdMap, resolveRow } from "./lookup.js";
import { writeRows, writeErrors, summarize } from "./report.js";

async function readRows(path: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const parser = createReadStream(path).pipe(parse({ columns: true, bom: true, trim: true }));
  for await (const rec of parser) rows.push(rec as Record<string, string>);
  return rows;
}

export async function prepare(conn: jsforce.Connection, job: Job, inputPath: string): Promise<{
  resolvedPath: string; errorsPath: string; resolvedCount: number; errorCount: number;
}> {
  const { simple, lookups } = parseMappings(job.mappings);
  const rows = await readRows(inputPath);

  // lookup별 key→Id 맵 구성
  const idMaps: Record<string, IdMap> = {};
  for (const lk of lookups) {
    const keys = rows.map((r) => r[lk.src]).filter((v): v is string => !!v);
    const recs = await queryKeys(conn as any, lk.object, lk.key, keys);
    idMaps[lk.field] = buildIdMap(recs, lk.key);
  }

  const headers = [...Object.values(simple), ...lookups.map((l) => l.field)];
  const outRows: Record<string, string>[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, i) => {
    const rowNum = i + 2; // 헤더 다음 1-based
    const base = applySimple(row, simple);
    const { fields, errors: rowErrors } = resolveRow(row, lookups, idMaps, job.onLookupMiss, rowNum);
    errors.push(...rowErrors);
    if (job.onLookupMiss === "error" && rowErrors.length > 0) return; // 행 제외
    outRows.push({ ...base, ...fields });
  });

  const resolvedPath = inputPath.replace(/\.csv$/i, "") + ".resolved.csv";
  const errorsPath = inputPath.replace(/\.csv$/i, "") + ".errors.csv";
  writeRows(resolvedPath, outRows, headers);
  writeErrors(errorsPath, errors);
  summarize("prepare", { 입력: rows.length, 변환: outRows.length, 에러: errors.length });
  return { resolvedPath, errorsPath, resolvedCount: outRows.length, errorCount: errors.length };
}
```
> 메모: 현재 구현은 행을 메모리로 읽되 CSV 파서는 스트림(`createReadStream().pipe(parse)`)을 사용한다. 수십만 행 이상에서 메모리가 문제되면 후속으로 2-pass 순수 스트리밍으로 전환(키 수집 패스 → 조회 → 변환·기록 패스). MVP는 현 방식으로 충분하며 한계를 README에 명시한다.

- [ ] **Step 5: 통과 확인** — Run: `npm test -- prepare` → PASS. `npx tsc --noEmit` → 에러 없음.

- [ ] **Step 6: 커밋**
```bash
git add src/report.ts src/prepare.ts test/prepare.test.ts
git commit -m "feat: prepare 파이프라인(매핑+lookup 치환+리포트)"
```

---

## Task 7: load (Bulk2 적재 + 결과)

**Files:** Create `src/load.ts`, `test/load.test.ts`

- [ ] **Step 1: 실패 테스트 `test/load.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { buildBulkOptions, summarizeResults } from "../src/load";
import type { Job } from "../src/types";

const insertJob: Job = { object: "Contact", targetOrg: "dev", operation: "insert", mappings: { a: "B" }, onLookupMiss: "error" };
const upsertJob: Job = { ...insertJob, operation: "upsert", externalIdField: "Ext__c" };

describe("buildBulkOptions", () => {
  it("insert 옵션", () => {
    expect(buildBulkOptions(insertJob)).toEqual({ object: "Contact", operation: "insert" });
  });
  it("upsert는 externalIdFieldName 포함", () => {
    expect(buildBulkOptions(upsertJob)).toEqual({ object: "Contact", operation: "upsert", externalIdFieldName: "Ext__c" });
  });
});

describe("summarizeResults", () => {
  it("성공/실패 건수와 행 산출", () => {
    const s = summarizeResults(
      [{ sf__Id: "1" }, { sf__Id: "2" }],
      [{ sf__Error: "REQUIRED", LastName: "x" }],
    );
    expect(s.success).toBe(2);
    expect(s.fail).toBe(1);
    expect(s.rows[2]).toMatchObject({ status: "fail", error: "REQUIRED" });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- load` → FAIL.

- [ ] **Step 3: `src/load.ts`**
```ts
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import jsforce from "jsforce";
import type { Job } from "./types.js";
import { writeRows, summarize } from "./report.js";

export function buildBulkOptions(job: Job): Record<string, string> {
  const opts: Record<string, string> = { object: job.object, operation: job.operation };
  if (job.operation === "upsert") opts.externalIdFieldName = job.externalIdField!;
  return opts;
}

export function summarizeResults(
  successful: Array<Record<string, any>>,
  failed: Array<Record<string, any>>,
): { success: number; fail: number; rows: Array<Record<string, string>> } {
  const rows: Array<Record<string, string>> = [];
  for (const s of successful) rows.push({ status: "success", id: String(s.sf__Id ?? ""), error: "" });
  for (const f of failed) rows.push({ status: "fail", id: "", error: String(f.sf__Error ?? "") });
  return { success: successful.length, fail: failed.length, rows };
}

async function readRows(path: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const parser = createReadStream(path).pipe(parse({ columns: true, bom: true, trim: true }));
  for await (const rec of parser) rows.push(rec as Record<string, string>);
  return rows;
}

export async function load(conn: jsforce.Connection, job: Job, inputPath: string): Promise<{
  success: number; fail: number; resultsPath: string;
}> {
  const records = await readRows(inputPath);
  const res = await conn.bulk2.loadAndWaitForResults({ ...buildBulkOptions(job), input: records } as any);
  const summary = summarizeResults(res.successfulResults ?? [], res.failedResults ?? []);
  const resultsPath = inputPath.replace(/\.csv$/i, "") + ".results.csv";
  writeRows(resultsPath, summary.rows, ["status", "id", "error"]);
  summarize("load", { 입력: records.length, 성공: summary.success, 실패: summary.fail });
  return { success: summary.success, fail: summary.fail, resultsPath };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- load` → PASS. `npx tsc --noEmit` → 에러 없음.

- [ ] **Step 5: 커밋**
```bash
git add src/load.ts test/load.test.ts
git commit -m "feat: Bulk2 적재 + 결과 리포트"
```

---

## Task 8: describe + init + CLI 연결 + README

**Files:** Create `src/describe.ts`, `src/cli.ts`, `README.md`, `test/describe.test.ts`

- [ ] **Step 1: 실패 테스트 `test/describe.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { suggestMappings } from "../src/describe";

describe("suggestMappings", () => {
  it("소스 헤더를 라벨/이름으로 매칭, 못 찾으면 빈 문자열", () => {
    const fields = [
      { name: "LastName", label: "성" },
      { name: "Email", label: "이메일" },
    ];
    const out = suggestMappings(["이메일", "성", "미상"], fields as any);
    expect(out).toEqual({ "이메일": "Email", "성": "LastName", "미상": "" });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- describe` → FAIL.

- [ ] **Step 3: `src/describe.ts`**
```ts
import jsforce from "jsforce";

export interface FieldInfo { name: string; label: string; }

export function suggestMappings(headers: string[], fields: FieldInfo[]): Record<string, string> {
  const byLabel = new Map(fields.map((f) => [f.label, f.name]));
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f.name]));
  const out: Record<string, string> = {};
  for (const h of headers) {
    out[h] = byLabel.get(h) ?? byName.get(h.toLowerCase()) ?? "";
  }
  return out;
}

export async function describeFields(conn: jsforce.Connection, object: string): Promise<FieldInfo[]> {
  const meta = await conn.describe(object);
  return meta.fields.map((f: any) => ({ name: f.name, label: f.label }));
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- describe` → PASS.

- [ ] **Step 5: `src/cli.ts`** (commander 연결)
```ts
#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { loadJob } from "./config.js";
import { getConnection } from "./auth.js";
import { prepare } from "./prepare.js";
import { load } from "./load.js";
import { describeFields, suggestMappings } from "./describe.js";

const program = new Command();
program.name("sfload").description("Salesforce 데이터 삽입 마이그레이션 CLI");

program.command("init")
  .requiredOption("-o, --object <name>")
  .requiredOption("--org <alias>")
  .option("-i, --input <csv>", "헤더 자동 제안용 샘플 CSV")
  .option("--out <path>", "출력 job 파일", "job.json")
  .action(async (opts) => {
    const conn = await getConnection(opts.org);
    const fields = await describeFields(conn, opts.object);
    let mappings: Record<string, string> = {};
    if (opts.input) {
      const header = await firstHeader(opts.input);
      mappings = suggestMappings(header, fields);
    }
    const job = { object: opts.object, targetOrg: opts.org, operation: "insert", mappings, onLookupMiss: "error" };
    writeFileSync(opts.out, JSON.stringify(job, null, 2) + "\n", "utf8");
    console.log(`job 파일 생성: ${opts.out} (필드 ${fields.length}개 기준)`);
  });

program.command("prepare")
  .requiredOption("-c, --config <job.json>")
  .requiredOption("-i, --input <csv>")
  .action(async (opts) => {
    const job = loadJob(opts.config);
    const conn = await getConnection(job.targetOrg);
    const r = await prepare(conn, job, opts.input);
    if (r.errorCount > 0) process.exitCode = 1;
  });

program.command("load")
  .requiredOption("-c, --config <job.json>")
  .requiredOption("-i, --input <csv>")
  .action(async (opts) => {
    const job = loadJob(opts.config);
    const conn = await getConnection(job.targetOrg);
    const r = await load(conn, job, opts.input);
    if (r.fail > 0) process.exitCode = 1;
  });

program.command("run")
  .requiredOption("-c, --config <job.json>")
  .requiredOption("-i, --input <csv>")
  .action(async (opts) => {
    const job = loadJob(opts.config);
    const conn = await getConnection(job.targetOrg);
    const p = await prepare(conn, job, opts.input);
    if (p.errorCount > 0 && job.onLookupMiss === "error") {
      console.error("prepare 단계 에러가 있어 load를 중단합니다. errors.csv 확인.");
      process.exitCode = 1; return;
    }
    const r = await load(conn, job, p.resolvedPath);
    if (r.fail > 0) process.exitCode = 1;
  });

async function firstHeader(path: string): Promise<string[]> {
  const parser = createReadStream(path).pipe(parse({ toLine: 1, bom: true, trim: true }));
  for await (const rec of parser) return rec as string[];
  return [];
}

program.parseAsync();
```

- [ ] **Step 6: README.md** — 아래 내용으로 생성:
```markdown
# sfload — Salesforce 데이터 마이그레이션 CLI

엑셀/CSV 데이터를 Salesforce에 삽입(insert/update/upsert)할 때, **헤더 매핑·lookup Id 자동 치환·검증**을 처리하는 로컬 CLI.

## 설치
\`\`\`bash
npm install && npm run build
\`\`\`

## 인증
Salesforce CLI(`sf`)에 로그인된 org 별칭을 그대로 씁니다 (자격증명 저장 안 함).
\`\`\`bash
sf org login web --alias dev
\`\`\`

## 사용
\`\`\`bash
# 1) 매핑 설정 뼈대 생성 (org 필드로 헤더 자동 제안)
sfload init -o Contact --org dev -i data.csv

# 2) 헤더 매핑 + lookup Id 치환 (적재 안 함, 안전)
sfload prepare -c job.json -i data.csv     # → data.resolved.csv + data.errors.csv

# 3) Bulk 적재 + 결과 리포트
sfload load -c job.json -i data.resolved.csv   # → data.results.csv

# (prepare + load 한 번에)
sfload run -c job.json -i data.csv
\`\`\`

job.json 예시는 `docs/superpowers/specs`의 설계 문서를 참고하세요.

## 한계
- 입력은 **CSV 권장**(엑셀은 CSV로 내보내면 대용량 렉이 사라짐).
- 현재 행을 메모리로 읽습니다. 수십만 행 초과 시 2-pass 스트리밍으로 확장 예정.

## License
MIT
```

- [ ] **Step 7: 전체 테스트 + 빌드 + 커밋**
Run: `npm test` (전체 PASS), `npx tsc --noEmit` (에러 없음)
```bash
git add src/describe.ts src/cli.ts README.md test/describe.test.ts
git commit -m "feat: describe/init + CLI 명령 연결 + README"
```

---

## Task 9: 수동 종단 테스트 (sandbox)

> 실제 org가 필요해 자동화 불가. 코드 완료 후 사용자와 함께 진행.

- [ ] **Step 1**: `sf org login web --alias <sandbox>`로 테스트 org 로그인.
- [ ] **Step 2**: 소량 샘플 CSV(예: Account External_Id + Contact) 준비 → `sfload init` → job.json 매핑 손보기.
- [ ] **Step 3**: `sfload prepare` → resolved.csv/errors.csv 육안 확인(미매칭 lookup이 리포트되는지).
- [ ] **Step 4**: `sfload load`(또는 기존 Data Loader) → org에서 레코드·lookup 관계 확인, results.csv 확인.
- [ ] **Step 5**: upsert 경로도 1회 검증(externalIdField).

---

## Self-Review 결과
- **Spec 커버리지**: 인증(T5), 헤더 매핑(T3), lookup 해소(T4·T6), insert/update/upsert(T2 검증·T7), prepare/load 분리(T6·T7), 검증 리포트(T6·T7), 대용량 스트리밍(T6 메모 + 한계 명시), init/describe(T8), CLI(T8) — 전부 태스크 존재.
- **Placeholder 스캔**: 모든 코드 단계 실제 코드 포함. "한계" 메모는 의도된 범위 표기(스트리밍 확장은 비목표).
- **타입/시그니처 일관성**: `Job`/`ParsedMappings`/`IdMap`/`RowError`, `parseMappings`/`applySimple`/`resolveRow`/`queryKeys`/`buildIdMap`/`prepare`/`load`/`buildBulkOptions`/`summarizeResults`/`suggestMappings` 시그니처가 계약과 태스크 간 일치.
- **알려진 한계**: 현재 prepare/load가 행을 메모리 적재(스트림 파싱이나 전량 보관) — MVP 적정, 초대용량은 후속 2-pass. README/spec에 명시.
