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
  it("매핑 값이 배열/숫자/불완전 객체면 throw", () => {
    expect(() => validateJob({ ...base, mappings: { a: 123 } })).toThrow(/mappings/);
    expect(() => validateJob({ ...base, mappings: { a: ["Id"] } })).toThrow(/mappings/);
    expect(() => validateJob({ ...base, mappings: { a: { field: "X" } } })).toThrow(/mappings/);
    expect(() => validateJob({ ...base, mappings: { a: "" } })).toThrow(/mappings/);
  });
  it("auditRequired 기본 false / 비불리언 throw", () => {
    expect(validateJob(base).auditRequired).toBe(false);
    expect(validateJob({ ...base, auditRequired: true }).auditRequired).toBe(true);
    expect(() => validateJob({ ...base, auditRequired: "yes" })).toThrow(/auditRequired/);
  });
  it("skipEmptyFields 기본 false, 지정 시 반영", () => {
    expect(validateJob(base).skipEmptyFields).toBe(false);
    expect(validateJob({ ...base, skipEmptyFields: true }).skipEmptyFields).toBe(true);
  });
  it("skipEmptyFields 비불리언이면 throw", () => {
    expect(() => validateJob({ ...base, skipEmptyFields: "yes" })).toThrow(/skipEmptyFields/);
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
