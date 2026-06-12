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
