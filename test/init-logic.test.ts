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
      field({ name: "Email" }),
      field({ name: "X", nillable: false, defaultedOnCreate: true }),
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
