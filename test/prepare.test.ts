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

  it("여러 lookup 동시 해소 — 같은 key 값이라도 객체별 맵이 섞이지 않음(교차오염 방지)", async () => {
    // 두 객체가 동일한 key 문자열 "x1"을 갖지만 서로 다른 Id를 반환 → 각 컬럼은 자기 객체의 Id를 받아야 함
    const conn = {
      query: async (soql: string) => {
        if (soql.includes("FROM Account")) return { records: [{ Id: "001A", AKey__c: "x1" }] };
        if (soql.includes("FROM Product__c")) return { records: [{ Id: "01tP", PKey__c: "x1" }] };
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
    writeFileSync(input, "거래처키,상품키\nx1,x1\n", "utf8");
    const res = await prepare(conn, job2, input);
    created.push(res.resolvedPath, res.errorsPath);
    const resolved = readFileSync(res.resolvedPath, "utf8");
    expect(resolved).toContain("AccountId,Product__c");
    expect(resolved).toContain("001A,01tP"); // AccountId=001A(Account), Product__c=01tP(Product__c) — 섞이지 않음
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
