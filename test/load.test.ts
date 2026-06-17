import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBulkOptions, summarizeResults, stripResultMeta, load } from "../src/load";
import type { Job } from "../src/types";

describe("load (통합, bulk2 mock)", () => {
  const inputF = join(tmpdir(), "sfload_load_in.csv");
  const cleanup = [inputF, join(tmpdir(), "sfload_load_in.results.csv"), join(tmpdir(), "sfload_load_in.failed.csv"), "sfload-audit.log"];
  afterEach(() => { for (const f of cleanup) if (existsSync(f)) rmSync(f); });

  it("성공/실패 집계 + failed.csv 생성 + unprocessed가 string이어도 안전", async () => {
    writeFileSync(inputF, "LastName\nA\nB\n", "utf8");
    const conn = {
      bulk2: {
        loadAndWaitForResults: async () => ({
          successfulResults: [{ sf__Id: "001" }],
          failedResults: [{ sf__Error: "REQUIRED_FIELD", LastName: "B" }],
          unprocessedRecords: "0", // string — Array.isArray 가드로 0건 처리(문자수 오집계 방지)
        }),
      },
    } as any;
    const job: Job = { object: "Contact", targetOrg: "dev", operation: "insert", onLookupMiss: "error", mappings: { a: "LastName" } };
    const r = await load(conn, job, inputF);
    expect(r.success).toBe(1);
    expect(r.fail).toBe(1);
    expect(r.failedPath).toBeTruthy();
    const failed = readFileSync(r.failedPath!, "utf8");
    expect(failed).toContain("LastName");
    expect(failed).toContain("B");
  });
});

describe("stripResultMeta", () => {
  it("sf__ 메타 컬럼 제거, 원본 필드만 문자열로(재적재용)", () => {
    expect(stripResultMeta({ sf__Id: "1", sf__Error: "REQUIRED", LastName: "홍", AccountId: "001" }))
      .toEqual({ LastName: "홍", AccountId: "001" });
  });
  it("null/undefined 값은 빈 문자열", () => {
    expect(stripResultMeta({ sf__Error: "X", Name: null, Code: undefined }))
      .toEqual({ Name: "", Code: "" });
  });
});

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
