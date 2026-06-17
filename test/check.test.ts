import { describe, it, expect } from "vitest";
import { checkJob } from "../src/check";
import type { FieldInfo } from "../src/describe";
import type { Job } from "../src/types";

function field(p: Partial<FieldInfo> & { name: string }): FieldInfo {
  return {
    name: p.name, label: p.label ?? p.name, type: p.type ?? "string", referenceTo: p.referenceTo ?? [],
    createable: p.createable ?? true, updateable: p.updateable ?? true, nillable: p.nillable ?? true,
    defaultedOnCreate: p.defaultedOnCreate ?? false, externalId: p.externalId ?? false, idLookup: p.idLookup ?? false,
  };
}

const contactFields = [
  field({ name: "Id" }),
  field({ name: "LastName" }),
  field({ name: "AccountId", type: "reference", referenceTo: ["Account"] }),
];
const accountFields = [field({ name: "Ext__c", externalId: true })];
const targets = { Account: accountFields };

const base: Job = {
  object: "Contact", targetOrg: "dev", operation: "insert", onLookupMiss: "error",
  mappings: { "성": "LastName", "거래처키": { field: "AccountId", lookup: { object: "Account", key: "Ext__c" } } },
};

describe("checkJob", () => {
  it("정상 job은 이슈 없음", () => {
    expect(checkJob(base, contactFields, targets)).toEqual([]);
  });
  it("없는 필드는 error", () => {
    const job = { ...base, mappings: { "x": "Nope__c" } };
    const issues = checkJob(job, contactFields, targets);
    expect(issues.some((i) => i.level === "error" && i.message.includes("Nope__c"))).toBe(true);
  });
  it("referenceTo 불일치는 error", () => {
    const job = { ...base, mappings: { "거래처키": { field: "AccountId", lookup: { object: "Lead", key: "Ext__c" } } } };
    const issues = checkJob(job, contactFields, targets);
    expect(issues.some((i) => i.level === "error" && i.message.includes("Lead"))).toBe(true);
  });
  it("lookup 대상에 key 필드 없으면 error", () => {
    const job = { ...base, mappings: { "거래처키": { field: "AccountId", lookup: { object: "Account", key: "Missing__c" } } } };
    const issues = checkJob(job, contactFields, { Account: accountFields });
    expect(issues.some((i) => i.message.includes("Missing__c"))).toBe(true);
  });
  it("update인데 Id 미매핑이면 error", () => {
    const job = { ...base, operation: "update" as const, mappings: { "성": "LastName" } };
    const issues = checkJob(job, contactFields, targets);
    expect(issues.some((i) => i.level === "error" && i.message.includes("Id"))).toBe(true);
  });
  it("insert에 생성불가 필드면 warn(FLS)", () => {
    const fields = [field({ name: "LastName", createable: false })];
    const job = { ...base, mappings: { "성": "LastName" } };
    const issues = checkJob(job, fields, {});
    expect(issues.some((i) => i.level === "warn" && i.message.includes("LastName"))).toBe(true);
  });
  it("같은 필드에 두 컬럼 매핑되면 warn(덮어쓰기)", () => {
    const job = { ...base, mappings: { "a": "LastName", "b": "LastName" } };
    const issues = checkJob(job, contactFields, {});
    expect(issues.some((i) => i.level === "warn" && i.message.includes("덮어쓰기"))).toBe(true);
  });
  it("insert 시스템 필수 필드 미매핑이면 warn", () => {
    const fields = [field({ name: "LastName", nillable: false }), field({ name: "Email" })];
    const job: Job = { object: "Contact", targetOrg: "dev", operation: "insert", onLookupMiss: "error", mappings: { "이메일": "Email" } };
    const issues = checkJob(job, fields, {});
    expect(issues.some((i) => i.level === "warn" && i.message.includes("LastName"))).toBe(true);
  });
});
