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
    answers.push(
      "Contact",            // search: object
      "insert",             // select: operation
      "field", "LastName",  // 헤더 "성"
      "lookup", "AccountId", "Ext__c", // 헤더 "거래처키"
      true,                 // 요약 confirm
    );
    const job = await runWizard(fakeConn, ["성", "거래처키"], "dev");
    expect(job.object).toBe("Contact");
    expect(job.operation).toBe("insert");
    expect(job.mappings["성"]).toBe("LastName");
    expect(job.mappings["거래처키"]).toEqual({ field: "AccountId", lookup: { object: "Account", key: "Ext__c" } });
  });
});
