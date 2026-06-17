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
      { name: "Id", label: "Id", type: "id", createable: false, updateable: false, nillable: false },
      { name: "LastName", label: "성", type: "string", nillable: false, createable: true, updateable: true },
      { name: "AccountId", label: "거래처", type: "reference", referenceTo: ["Account"], createable: true, updateable: true, nillable: true },
      { name: "OwnerId", label: "소유자", type: "reference", referenceTo: ["User", "Group"], createable: true, updateable: true, nillable: true },
    ] };
    if (obj === "Group") return { fields: [
      { name: "DeveloperName", label: "개발자명", type: "string", createable: true, updateable: true, nillable: true },
    ] };
    return { fields: [
      { name: "Ext__c", label: "외부ID", type: "string", externalId: true, createable: true, updateable: true, nillable: true },
    ] };
  },
} as any;

beforeEach(() => { answers.length = 0; });

describe("runWizard", () => {
  it("insert: 단순+lookup 매핑 흐름으로 Job 생성", async () => {
    answers.push(
      "Contact",            // object
      "insert",             // operation
      "field", "LastName",  // 헤더 "성"
      "lookup", "AccountId", "Ext__c", // 헤더 "거래처키" (Account는 단일 referenceTo)
      "error",              // onLookupMiss 선택
      true,                 // 요약 confirm
    );
    const job = await runWizard(fakeConn, ["성", "거래처키"], "dev");
    expect(job.object).toBe("Contact");
    expect(job.operation).toBe("insert");
    expect(job.onLookupMiss).toBe("error");
    expect(job.mappings["성"]).toBe("LastName");
    expect(job.mappings["거래처키"]).toEqual({ field: "AccountId", lookup: { object: "Account", key: "Ext__c" } });
  });

  it("update: Id 매핑 가능 + 빈셀 보존 옵션", async () => {
    answers.push(
      "Contact",            // object
      "update",             // operation
      "field", "Id",        // 헤더 "Id열" → Id (update에서 선택 가능해야 함 — C1)
      "field", "LastName",  // 헤더 "성"
      true,                 // skipEmptyFields confirm
      "error",              // onLookupMiss 선택
      true,                 // 요약 confirm
    );
    const job = await runWizard(fakeConn, ["Id열", "성"], "dev");
    expect(job.operation).toBe("update");
    expect(job.mappings["Id열"]).toBe("Id");
    expect(job.skipEmptyFields).toBe(true);
  });

  it("다형성 lookup: 대상 객체를 선택받고, 비고유 key는 확인 후 사용", async () => {
    answers.push(
      "Contact",            // object
      "insert",             // operation
      "lookup", "OwnerId",  // 헤더 "담당키" → lookup OwnerId(User,Group 다형성)
      "Group",              // 다형성 대상 객체 선택 (C2)
      "DeveloperName",      // key 선택(비고유)
      true,                 // 비고유 key 그대로 사용 confirm (I2)
      "field", "LastName",  // 헤더 "성"
      "error",              // onLookupMiss 선택
      true,                 // 요약 confirm
    );
    const job = await runWizard(fakeConn, ["담당키", "성"], "dev");
    expect(job.mappings["담당키"]).toEqual({ field: "OwnerId", lookup: { object: "Group", key: "DeveloperName" } });
    expect(job.mappings["성"]).toBe("LastName");
  });
});
