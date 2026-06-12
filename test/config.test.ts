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
