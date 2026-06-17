import { describe, it, expect } from "vitest";
import { buildBulkOptions, summarizeResults, stripResultMeta } from "../src/load";
import type { Job } from "../src/types";

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
