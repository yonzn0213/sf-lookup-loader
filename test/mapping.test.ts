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
