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
});
