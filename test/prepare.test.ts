import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare } from "../src/prepare";
import type { Job } from "../src/types";

const dir = tmpdir();
const input = join(dir, "sfload_in.csv");
const created: string[] = [input];
afterEach(() => { for (const f of created) if (existsSync(f)) rmSync(f); });

const job: Job = {
  object: "Contact", targetOrg: "dev", operation: "insert",
  mappings: { "이름": "LastName", "거래처키": { field: "AccountId", lookup: { object: "Account", key: "K__c" } } },
  onLookupMiss: "error",
};

const fakeConn = {
  query: async (_soql: string) => ({ records: [{ Id: "001A", K__c: "alpha" }] }),
} as any;

describe("prepare", () => {
  it("매핑+lookup 치환 → resolved.csv, 미매칭은 errors.csv", async () => {
    writeFileSync(input, "이름,거래처키\n홍길동,alpha\n김철수,none\n", "utf8");
    const res = await prepare(fakeConn, job, input);
    created.push(res.resolvedPath, res.errorsPath);

    const resolved = readFileSync(res.resolvedPath, "utf8");
    expect(resolved).toContain("LastName,AccountId");
    expect(resolved).toContain("홍길동,001A");
    expect(res.resolvedCount).toBe(1);
    expect(res.errorCount).toBe(1);

    const errors = readFileSync(res.errorsPath, "utf8");
    expect(errors).toContain("none");
    expect(errors).toContain("미매칭");
  });

  it("한 job에서 여러 lookup을 각각 다른 객체로 동시 해소", async () => {
    const conn = {
      query: async (soql: string) => {
        if (soql.includes("FROM Account")) return { records: [{ Id: "001A", AKey__c: "a1" }] };
        if (soql.includes("FROM Product__c")) return { records: [{ Id: "01tP", PKey__c: "p1" }] };
        return { records: [] };
      },
    } as any;
    const job2: Job = {
      object: "Order", targetOrg: "dev", operation: "insert", onLookupMiss: "error",
      mappings: {
        "거래처키": { field: "AccountId", lookup: { object: "Account", key: "AKey__c" } },
        "상품키": { field: "Product__c", lookup: { object: "Product__c", key: "PKey__c" } },
      },
    };
    writeFileSync(input, "거래처키,상품키\na1,p1\n", "utf8");
    const res = await prepare(conn, job2, input);
    created.push(res.resolvedPath, res.errorsPath);
    const resolved = readFileSync(res.resolvedPath, "utf8");
    expect(resolved).toContain("AccountId,Product__c");
    expect(resolved).toContain("001A,01tP");
    expect(res.resolvedCount).toBe(1);
    expect(res.errorCount).toBe(0);
  });

  it("여러 행 스트리밍: 빈 lookup은 통과(AccountId 공란), 대소문자/공백 무시 매칭", async () => {
    writeFileSync(input, "이름,거래처키\n행1, ALPHA \n행2,\n행3,none\n", "utf8");
    const res = await prepare(fakeConn, job, input);
    created.push(res.resolvedPath, res.errorsPath);

    const resolved = readFileSync(res.resolvedPath, "utf8");
    // 행1: " ALPHA " → 정규화 매칭 001A, 행2: 빈 lookup → 통과(AccountId 공란)
    expect(resolved).toContain("행1,001A");
    expect(resolved).toContain("행2,");
    expect(res.resolvedCount).toBe(2);   // 행1, 행2 통과
    expect(res.errorCount).toBe(1);      // 행3(none) 미매칭
  });
});
